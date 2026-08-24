/**
 * Wi-Fi transport server: the desktop's half of the desktop<->phone link.
 *
 * Runs a WebSocket server on the LAN, advertises over mDNS, and bridges the two
 * message directions:
 *   - `sendCommand(PluginCommand)` -> serialized to the active phone (executor)
 *   - incoming `PluginEvent`s      -> `onDeviceEvent` (forwarded to the webview)
 *   - `ping`/`pong`                -> liveness (surfaced as ConnectionEvents)
 *
 * The phone speaks the same plugin wire protocol the old ESP32/dongle plugin used.
 *
 * ## Admission
 *
 * The listener is open to the whole LAN, so a caller has to prove it is the phone the
 * user meant. A random token is minted per `start()` and goes into the QR URL only —
 * never into the mDNS TXT record, which anyone on the network can read. From there:
 *
 *   - right token  -> adopted immediately (scanning the QR is the zero-friction path)
 *   - no/bad token -> held as PENDING until the user allows it in the connect panel,
 *     so mDNS discovery still works but cannot silently take the session
 *
 * A pending peer's messages are dropped (bar its pings), and no command is ever sent to
 * it. Without this, anyone on the same Wi-Fi could occupy the single peer slot or feed
 * fabricated `char-write` events into the scenario engine.
 */

import os from "node:os";
import type { Server, ServerWebSocket } from "bun";
import { Bonjour } from "bonjour-service";
import type { ConnectionEvent, ConnectionInfo } from "../shared/rpc";
import type { PluginCommand, PluginEvent } from "../shared/wire";

export const CONNECTION_PORT = 8765;
/** Advertised as `_logicgatt._tcp`. */
export const MDNS_SERVICE_TYPE = "logicgatt";
export const LOCAL_NAME = "LogicGATT Desktop";
/**
 * SRV/A-record target for the advertisement. Pinned so the app doesn't leak the
 * machine's OS hostname (bonjour-service defaults `host` to `os.hostname()`).
 */
export const MDNS_HOST = "logicgatt.local";

/**
 * Liveness watchdog. The phone pings every ~2s (see mobile `useExecutor`). If we hear
 * nothing at all from the active peer for this long we treat it as dead (crashed,
 * backgrounded, or off-network with a half-open socket) and drop it, so a new phone
 * can connect instead of being rejected by the single-connection guard forever.
 */
export const LIVENESS_TIMEOUT_MS = 6000;
/** How often the watchdog checks the last-seen timestamp. */
const LIVENESS_CHECK_MS = 2000;

/** How long a tokenless peer waits for the user to allow it before being dropped. */
export const PENDING_APPROVAL_TIMEOUT_MS = 60_000;

/** Close code for a peer the user denied (or never got round to allowing). */
export const WS_NOT_APPROVED = 4003;

/** Query parameter carrying the session token. */
const TOKEN_PARAM = "token";

/** Fresh admission secret for one server run. */
function mintToken(): string {
	return crypto.randomUUID().replace(/-/g, "");
}

const PLUGIN_EVENT_TYPES = new Set<string>([
	"char-write",
	"char-read",
	"connected",
	"disconnected",
	"error",
	"schema-mismatch",
	"adv-started",
	"adv-failed",
	"log",
]);

/** First non-internal IPv4 address (the LAN address the phone dials). */
export function getLanIPv4(): string {
	const ifaces = os.networkInterfaces();
	for (const addrs of Object.values(ifaces)) {
		for (const net of addrs ?? []) {
			if (net.family === "IPv4" && !net.internal) return net.address;
		}
	}
	return "127.0.0.1";
}

type WsData = { peerId: string; approved: boolean; address: string };

export interface ConnectionServer {
	info: ConnectionInfo;
	/** Whether the WebSocket server is currently listening. */
	running(): boolean;
	/** Adopt a peer that is waiting for approval. No-op for any other id. */
	approvePeer(peerId: string): void;
	/** Refuse a peer that is waiting for approval and close its socket. */
	denyPeer(peerId: string): void;
	/**
	 * Begin listening + advertising over mDNS. Idempotent. Only called when the
	 * user selects the mobile executor as the active module — so the QR/link is
	 * dead (nothing to connect to) whenever a different module is chosen.
	 */
	start(): void;
	/** Stop listening, drop any peer, and withdraw the mDNS advertisement. Idempotent. */
	stop(): void;
	hasPeer(): boolean;
	activePeerId(): string | null;
	/** Send a command to the active phone. Returns false if no phone is connected. */
	sendCommand(cmd: PluginCommand): boolean;
}

export interface ConnectionCallbacks {
	/** Connection-flow events (peer connect/disconnect, ping/pong, logs) for the UI. */
	onConnectionEvent: (e: ConnectionEvent) => void;
	/** Device events from the phone, forwarded to the webview transport. */
	onDeviceEvent: (e: PluginEvent) => void;
}

/** Overrides for the admission tests, which need a spare port and no LAN chatter. */
export interface ConnectionServerOptions {
	port?: number;
	/** Publish over mDNS. Off in tests so runs don't advertise on the real network. */
	advertise?: boolean;
}

export function createConnectionServer(
	cb: ConnectionCallbacks,
	options: ConnectionServerOptions = {},
): ConnectionServer {
	const port = options.port ?? CONNECTION_PORT;
	const advertise = options.advertise ?? true;
	const host = getLanIPv4();
	/** Address only — what mDNS advertises and what the UI shows. Carries no secret. */
	const baseUrl = `ws://${host}:${port}`;
	let peerCounter = 0;
	// Single connection only: at most one entry. Kept as a map so `sendCommand`
	// resolves the active socket uniformly.
	const peers = new Map<string, ServerWebSocket<WsData>>();
	let activeId: string | null = null;

	// Admission secret for the current run; null while the server is stopped.
	let token: string | null = null;
	/** The one tokenless peer waiting on the user's decision, if any. */
	let pending: {
		id: string;
		ws: ServerWebSocket<WsData>;
		address: string;
		timer: ReturnType<typeof setTimeout>;
	} | null = null;

	/** The QR URL: the address plus this run's token. */
	function tokenUrl(): string {
		return token ? `${baseUrl}/?${TOKEN_PARAM}=${token}` : baseUrl;
	}

	function clearPending(): void {
		if (!pending) return;
		clearTimeout(pending.timer);
		pending = null;
	}

	/** Drop a waiting peer, telling it why. */
	function rejectPending(reason: string): void {
		if (!pending) return;
		const { id, ws } = pending;
		clearPending();
		try {
			ws.close(WS_NOT_APPROVED, reason);
		} catch {
			/* ignore */
		}
		cb.onConnectionEvent({ type: "peer-denied", peerId: id });
	}

	/** Promote a socket to the active peer and start its liveness watchdog. */
	function adopt(ws: ServerWebSocket<WsData>): void {
		ws.data.approved = true;
		peers.set(ws.data.peerId, ws);
		activeId = ws.data.peerId;
		lastSeenAt = Date.now();
		startWatchdog();
		try {
			ws.send(JSON.stringify({ type: "approved" }));
		} catch {
			/* the peer-connected event still stands; the phone re-syncs on upload */
		}
		cb.onConnectionEvent({ type: "peer-connected", peerId: ws.data.peerId });
	}

	// Created on start(), torn down on stop() — so the server (and the QR it backs)
	// only exists while the mobile executor is the selected module.
	let server: Server<WsData> | null = null;
	let bonjour: InstanceType<typeof Bonjour> | null = null;
	let service: ReturnType<InstanceType<typeof Bonjour>["publish"]> | null = null;

	// Liveness watchdog for the active peer.
	let lastSeenAt = 0;
	let watchdog: ReturnType<typeof setInterval> | null = null;

	function stopWatchdog(): void {
		if (watchdog) {
			clearInterval(watchdog);
			watchdog = null;
		}
	}

	function startWatchdog(): void {
		if (watchdog) return;
		watchdog = setInterval(() => {
			if (activeId === null) return;
			if (Date.now() - lastSeenAt <= LIVENESS_TIMEOUT_MS) return;
			// Peer went quiet: drop it. Do the teardown here (the socket may be a
			// half-open TCP that never fires `close`), and close it best-effort. The
			// `close` handler is idempotent, so it won't double-emit.
			const goneId = activeId;
			const ws = peers.get(goneId);
			peers.delete(goneId);
			activeId = null;
			stopWatchdog();
			cb.onConnectionEvent({
				type: "log",
				message: `no ping from ${goneId} for ${LIVENESS_TIMEOUT_MS}ms — dropping dead peer`,
			});
			try {
				ws?.close(4000, "liveness timeout");
			} catch {
				/* ignore */
			}
			cb.onConnectionEvent({ type: "peer-disconnected", peerId: goneId });
		}, LIVENESS_CHECK_MS);
	}

	function start(): void {
		if (server) return; // already listening — idempotent

		// New run, new secret: a QR from a previous session stops working.
		token = mintToken();

		try {
			server = startServer();
		} catch (err) {
			// Most commonly EADDRINUSE (another instance already listening). Surface it in
			// the connection log instead of failing silently, so the QR panel isn't dead.
			server = null;
			token = null;
			const reason = err instanceof Error ? err.message : String(err);
			cb.onConnectionEvent({
				type: "log",
				message: `could not start server on port ${port}: ${reason} — is it already in use?`,
			});
			return;
		}

		// mDNS advertise (`_logicgatt._tcp`) so the phone can auto-discover. The TXT
		// record is readable by anyone on the LAN, so it carries the address only —
		// a peer arriving this way has no token and needs the user to allow it.
		if (advertise) {
			bonjour = new Bonjour();
			service = bonjour.publish({
				name: LOCAL_NAME,
				type: MDNS_SERVICE_TYPE,
				protocol: "tcp",
				host: MDNS_HOST,
				port,
				txt: { url: baseUrl },
			});
		}

		cb.onConnectionEvent({ type: "server-listening", url: baseUrl, host, port });
	}

	function startServer(): Server<WsData> {
		return Bun.serve<WsData>({
			port,
			hostname: "0.0.0.0",
			fetch(req, srv) {
				// Enforce a single connection: reject a second phone while one is
				// already connected, instead of silently swapping the active peer.
				if (activeId !== null) {
					cb.onConnectionEvent({
						type: "log",
						message: "rejected extra connection — a device is already connected",
					});
					return new Response("busy: a device is already connected", { status: 409 });
				}

				// The token decides adoption vs. the approval queue, never admission
				// itself — a tokenless peer is still upgraded so it can be shown to the
				// user and allowed by name.
				let supplied: string | null = null;
				try {
					supplied = new URL(req.url).searchParams.get(TOKEN_PARAM);
				} catch {
					/* malformed request line — treat as tokenless */
				}
				const approved = token !== null && supplied === token;

				if (!approved && pending !== null) {
					cb.onConnectionEvent({
						type: "log",
						message: "rejected extra connection — another device is awaiting approval",
					});
					return new Response("busy: another device is awaiting approval", { status: 409 });
				}

				const peerId = `peer-${++peerCounter}`;
				const address = srv.requestIP(req)?.address ?? "unknown";
				if (srv.upgrade(req, { data: { peerId, approved, address } })) return undefined;
				return new Response("logic-gatt connection server", { status: 200 });
			},
			websocket: {
				open(ws) {
					// Guard against a race where two upgrades slip past the fetch check.
					if (activeId !== null && activeId !== ws.data.peerId) {
						ws.close(1013, "busy: a device is already connected");
						return;
					}
					if (ws.data.approved) {
						adopt(ws);
						return;
					}
					// Tokenless (mDNS, or a QR from an earlier run): park it until the
					// user decides, and drop it if they never do.
					if (pending !== null) {
						ws.close(WS_NOT_APPROVED, "another device is awaiting approval");
						return;
					}
					pending = {
						id: ws.data.peerId,
						ws,
						address: ws.data.address,
						timer: setTimeout(() => rejectPending("approval timed out"), PENDING_APPROVAL_TIMEOUT_MS),
					};
					try {
						ws.send(JSON.stringify({ type: "awaiting-approval" }));
					} catch {
						/* ignore — the phone shows "connected" until it hears otherwise */
					}
					cb.onConnectionEvent({
						type: "peer-pending",
						peerId: ws.data.peerId,
						address: ws.data.address,
					});
					cb.onConnectionEvent({
						type: "log",
						message: `${ws.data.peerId} (${ws.data.address}) connected without a token — waiting for approval`,
					});
				},
				message(ws, raw) {
					// A peer awaiting approval is not the device yet: answer its pings so it
					// stays put, and ignore everything else it says.
					if (ws.data.peerId !== activeId) {
						if (pending?.id !== ws.data.peerId) return;
						try {
							const probe = JSON.parse(typeof raw === "string" ? raw : raw.toString()) as {
								type?: unknown;
								seq?: number;
								t?: number;
							};
							if (probe?.type === "ping") {
								ws.send(JSON.stringify({ type: "pong", seq: probe.seq ?? 0, t: probe.t }));
							}
						} catch {
							/* ignore */
						}
						return;
					}

					// Any frame from the peer proves it's alive — feed the watchdog.
					lastSeenAt = Date.now();
					let msg: { type?: unknown; seq?: number; t?: number };
					try {
						msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
					} catch {
						return;
					}
					if (!msg || typeof msg.type !== "string") return;

					if (msg.type === "ping") {
						const seq = msg.seq ?? 0;
						cb.onConnectionEvent({ type: "ping", peerId: ws.data.peerId, seq });
						ws.send(JSON.stringify({ type: "pong", seq, t: msg.t }));
						cb.onConnectionEvent({ type: "pong", peerId: ws.data.peerId, seq });
						return;
					}
					if (msg.type === "pong") return;

					if (PLUGIN_EVENT_TYPES.has(msg.type)) {
						cb.onDeviceEvent(msg as unknown as PluginEvent);
						return;
					}
					cb.onConnectionEvent({
						type: "log",
						message: `unknown msg from ${ws.data.peerId}: ${msg.type}`,
					});
				},
				close(ws) {
					// A peer that gave up while waiting never became the device, so it has
					// no disconnect to report — just clear the prompt.
					if (pending?.id === ws.data.peerId) {
						clearPending();
						cb.onConnectionEvent({ type: "peer-denied", peerId: ws.data.peerId });
						return;
					}
					// Idempotent: the watchdog may have already removed this peer. Only
					// emit peer-disconnected if we were still tracking it, so a
					// watchdog-drop followed by the real close doesn't double-fire.
					const wasTracked = peers.delete(ws.data.peerId);
					// Single peer: clear the active id when it drops (no "next" peer).
					if (activeId === ws.data.peerId) activeId = null;
					stopWatchdog();
					if (wasTracked) {
						cb.onConnectionEvent({ type: "peer-disconnected", peerId: ws.data.peerId });
					}
				},
			},
		});
	}

	function stop(): void {
		if (!server) return; // not running — idempotent
		stopWatchdog();
		rejectPending("server stopping");
		token = null;
		try {
			service?.stop?.();
			bonjour?.destroy();
		} catch {
			/* ignore */
		}
		service = null;
		bonjour = null;
		// Drop any live peer, then stop the listener.
		for (const ws of peers.values()) {
			try {
				ws.close(1001, "server stopping");
			} catch {
				/* ignore */
			}
		}
		peers.clear();
		activeId = null;
		server.stop(true);
		server = null;
		cb.onConnectionEvent({ type: "log", message: "connection server stopped" });
	}

	return {
		// Getter so callers (e.g. getConnectionInfo) always see the current peer.
		get info(): ConnectionInfo {
			return {
				// What the QR encodes — the address alone would be refused.
				url: tokenUrl(),
				// What the panel prints, so the token never lands on screen or in a log.
				displayUrl: baseUrl,
				host,
				port,
				localName: LOCAL_NAME,
				peerId: activeId,
				pendingPeer: pending ? { peerId: pending.id, address: pending.address } : null,
			};
		},
		running: () => server !== null,
		start,
		stop,
		approvePeer(peerId) {
			if (pending?.id !== peerId) return;
			const { ws } = pending;
			clearPending();
			cb.onConnectionEvent({
				type: "log",
				message: `${peerId} approved by the user`,
			});
			adopt(ws);
		},
		denyPeer(peerId) {
			if (pending?.id !== peerId) return;
			cb.onConnectionEvent({ type: "log", message: `${peerId} denied by the user` });
			rejectPending("denied");
		},
		hasPeer: () => activeId !== null,
		activePeerId: () => activeId,
		sendCommand(cmd) {
			const ws = activeId ? peers.get(activeId) : null;
			if (!ws) {
				cb.onConnectionEvent({ type: "log", message: `no phone connected; dropped ${cmd.type}` });
				return false;
			}
			ws.send(JSON.stringify(cmd));
			cb.onConnectionEvent({ type: "log", message: `→ ${cmd.type}` });
			return true;
		},
	};
}
