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

type WsData = { peerId: string };

export interface ConnectionServer {
	info: ConnectionInfo;
	/** Whether the WebSocket server is currently listening. */
	running(): boolean;
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

export function createConnectionServer(cb: ConnectionCallbacks): ConnectionServer {
	const host = getLanIPv4();
	const url = `ws://${host}:${CONNECTION_PORT}`;
	let peerCounter = 0;
	// Single connection only: at most one entry. Kept as a map so `sendCommand`
	// resolves the active socket uniformly.
	const peers = new Map<string, ServerWebSocket<WsData>>();
	let activeId: string | null = null;

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

		try {
			server = startServer();
		} catch (err) {
			// Most commonly EADDRINUSE (another instance already listening). Surface it in
			// the connection log instead of failing silently, so the QR panel isn't dead.
			server = null;
			const reason = err instanceof Error ? err.message : String(err);
			cb.onConnectionEvent({
				type: "log",
				message: `could not start server on port ${CONNECTION_PORT}: ${reason} — is it already in use?`,
			});
			return;
		}

		// mDNS advertise (`_logicgatt._tcp`) so the phone can auto-discover.
		bonjour = new Bonjour();
		service = bonjour.publish({
			name: LOCAL_NAME,
			type: MDNS_SERVICE_TYPE,
			protocol: "tcp",
			host: MDNS_HOST,
			port: CONNECTION_PORT,
			txt: { url },
		});

		cb.onConnectionEvent({ type: "server-listening", url, host, port: CONNECTION_PORT });
	}

	function startServer(): Server<WsData> {
		return Bun.serve<WsData>({
			port: CONNECTION_PORT,
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
				const peerId = `peer-${++peerCounter}`;
				if (srv.upgrade(req, { data: { peerId } })) return undefined;
				return new Response("logic-gatt connection server", { status: 200 });
			},
			websocket: {
				open(ws) {
					// Guard against a race where two upgrades slip past the fetch check.
					if (activeId !== null && activeId !== ws.data.peerId) {
						ws.close(1013, "busy: a device is already connected");
						return;
					}
					peers.set(ws.data.peerId, ws);
					activeId = ws.data.peerId;
					lastSeenAt = Date.now();
					startWatchdog();
					cb.onConnectionEvent({ type: "peer-connected", peerId: ws.data.peerId });
				},
				message(ws, raw) {
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
			return { url, host, port: CONNECTION_PORT, localName: LOCAL_NAME, peerId: activeId };
		},
		running: () => server !== null,
		start,
		stop,
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
