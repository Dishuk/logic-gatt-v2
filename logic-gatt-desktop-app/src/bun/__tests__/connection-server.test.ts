/**
 * Admission tests for the Wi-Fi transport server.
 *
 * Run under `bun test` rather than Vitest: this is Bun-side code and needs the real
 * `Bun.serve` and real WebSocket clients, which the jsdom suite cannot provide.
 *
 * Each test binds a spare port and leaves mDNS off, so a run neither collides with a
 * running desktop app nor advertises anything on the network.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
	createConnectionServer,
	WS_NOT_APPROVED,
	type ConnectionServer,
} from "../connection-server";
import type { ConnectionEvent } from "../../shared/rpc";
import type { PluginEvent } from "../../shared/wire";

let nextPort = 47_650;
const started: ConnectionServer[] = [];
const opened: WebSocket[] = [];

interface Harness {
	server: ConnectionServer;
	events: ConnectionEvent[];
	deviceEvents: PluginEvent[];
	/** Wait for the first connection event of `type`, or reject after `ms`. */
	waitFor: (type: ConnectionEvent["type"], ms?: number) => Promise<ConnectionEvent>;
}

function startHarness(): Harness {
	const events: ConnectionEvent[] = [];
	const deviceEvents: PluginEvent[] = [];
	const waiters: { type: string; resolve: (e: ConnectionEvent) => void }[] = [];

	const server = createConnectionServer(
		{
			onConnectionEvent: (e) => {
				events.push(e);
				for (let i = waiters.length - 1; i >= 0; i--) {
					if (waiters[i].type === e.type) {
						waiters[i].resolve(e);
						waiters.splice(i, 1);
					}
				}
			},
			onDeviceEvent: (e) => deviceEvents.push(e),
		},
		{ port: nextPort++, advertise: false },
	);
	server.start();
	started.push(server);

	return {
		server,
		events,
		deviceEvents,
		waitFor(type, ms = 2000) {
			const already = events.find((e) => e.type === type);
			if (already) return Promise.resolve(already);
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error(`no "${type}" within ${ms}ms`)), ms);
				waiters.push({
					type,
					resolve: (e) => {
						clearTimeout(timer);
						resolve(e);
					},
				});
			});
		},
	};
}

/** Open a client socket and resolve once it is open (or reject if it closes first). */
function connect(url: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url);
		opened.push(ws);
		const timer = setTimeout(() => reject(new Error(`socket to ${url} never opened`)), 2000);
		ws.onopen = () => {
			clearTimeout(timer);
			resolve(ws);
		};
		ws.onclose = (e) => {
			clearTimeout(timer);
			reject(new Error(`closed before open (${e.code})`));
		};
	});
}

/** Next message on an already-open socket. */
function nextMessage(ws: WebSocket, ms = 2000): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`no message within ${ms}ms`)), ms);
		ws.onmessage = (e) => {
			clearTimeout(timer);
			resolve(JSON.parse(String(e.data)) as Record<string, unknown>);
		};
	});
}

const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
	for (const ws of opened.splice(0)) {
		ws.onclose = null;
		ws.onmessage = null;
		try {
			ws.close();
		} catch {
			/* ignore */
		}
	}
	for (const s of started.splice(0)) s.stop();
});

describe("session token", () => {
	test("the QR url carries a token and the printed url does not", () => {
		const { server } = startHarness();
		const { url, displayUrl } = server.info;

		expect(url).toContain("token=");
		expect(displayUrl).not.toContain("token=");
		expect(url.startsWith(displayUrl)).toBe(true);
		// 128 bits of hex, so it cannot be guessed by a peer on the same network.
		expect(new URL(url).searchParams.get("token")).toMatch(/^[0-9a-f]{32}$/);
	});

	test("a new run mints a new token, so an old QR stops working", () => {
		const { server } = startHarness();
		const first = server.info.url;
		server.stop();
		server.start();

		expect(server.info.url).not.toBe(first);
	});

	test("the token is withheld while the server is stopped", () => {
		const { server } = startHarness();
		server.stop();

		expect(server.info.url).not.toContain("token=");
	});
});

describe("admission", () => {
	test("a peer presenting the token is adopted straight away", async () => {
		const h = startHarness();
		await connect(h.server.info.url);
		await h.waitFor("peer-connected");

		expect(h.server.hasPeer()).toBe(true);
		expect(h.server.info.pendingPeer).toBeNull();
	});

	test("a peer with no token waits instead of being adopted", async () => {
		const h = startHarness();
		const ws = await connect(h.server.info.displayUrl);

		const pending = await h.waitFor("peer-pending");
		expect(pending.type).toBe("peer-pending");
		expect(h.server.hasPeer()).toBe(false);
		expect(h.server.info.pendingPeer).not.toBeNull();
		// The phone is told, so it can say so rather than claiming a working link.
		await expect(nextMessage(ws)).resolves.toMatchObject({ type: "awaiting-approval" });
	});

	test("a peer with the wrong token waits too", async () => {
		const h = startHarness();
		await connect(`${h.server.info.displayUrl}/?token=not-the-real-one`);

		await h.waitFor("peer-pending");
		expect(h.server.hasPeer()).toBe(false);
	});

	test("a waiting peer's device events are ignored", async () => {
		const h = startHarness();
		const ws = await connect(h.server.info.displayUrl);
		await h.waitFor("peer-pending");

		// The exact injection the token is there to prevent.
		ws.send(JSON.stringify({ type: "char-write", serviceUuid: "s", charUuid: "c", data: [1] }));
		await settle();

		expect(h.deviceEvents).toHaveLength(0);
	});

	test("a waiting peer still gets pong replies, so it stays put", async () => {
		const h = startHarness();
		const ws = await connect(h.server.info.displayUrl);
		await h.waitFor("peer-pending");
		await nextMessage(ws); // the awaiting-approval notice

		ws.send(JSON.stringify({ type: "ping", seq: 7, t: 1 }));

		await expect(nextMessage(ws)).resolves.toMatchObject({ type: "pong", seq: 7 });
	});

	test("no command reaches a waiting peer", async () => {
		const h = startHarness();
		await connect(h.server.info.displayUrl);
		await h.waitFor("peer-pending");

		expect(h.server.sendCommand({ type: "connect" })).toBe(false);
	});
});

describe("approval", () => {
	test("approving a waiting peer adopts it and tells the phone", async () => {
		const h = startHarness();
		const ws = await connect(h.server.info.displayUrl);
		const pending = await h.waitFor("peer-pending");
		await nextMessage(ws); // awaiting-approval

		const approved = nextMessage(ws);
		h.server.approvePeer((pending as { peerId: string }).peerId);

		await expect(approved).resolves.toMatchObject({ type: "approved" });
		await h.waitFor("peer-connected");
		expect(h.server.hasPeer()).toBe(true);
		expect(h.server.info.pendingPeer).toBeNull();
	});

	test("an adopted peer's device events flow through", async () => {
		const h = startHarness();
		const ws = await connect(h.server.info.displayUrl);
		const pending = await h.waitFor("peer-pending");
		h.server.approvePeer((pending as { peerId: string }).peerId);
		await h.waitFor("peer-connected");

		ws.send(JSON.stringify({ type: "char-write", serviceUuid: "s", charUuid: "c", data: [1] }));
		await settle();

		expect(h.deviceEvents).toHaveLength(1);
		expect(h.deviceEvents[0]).toMatchObject({ type: "char-write" });
	});

	test("denying a waiting peer closes it with the not-approved code", async () => {
		const h = startHarness();
		const ws = await connect(h.server.info.displayUrl);
		const pending = await h.waitFor("peer-pending");

		const closed = new Promise<number>((resolve) => {
			ws.onclose = (e) => resolve(e.code);
		});
		h.server.denyPeer((pending as { peerId: string }).peerId);

		expect(await closed).toBe(WS_NOT_APPROVED);
		await h.waitFor("peer-denied");
		expect(h.server.info.pendingPeer).toBeNull();
		expect(h.server.hasPeer()).toBe(false);
	});

	test("approving an id that is not waiting does nothing", async () => {
		const h = startHarness();
		await connect(h.server.info.displayUrl);
		await h.waitFor("peer-pending");

		h.server.approvePeer("peer-does-not-exist");

		expect(h.server.hasPeer()).toBe(false);
		expect(h.server.info.pendingPeer).not.toBeNull();
	});

	test("a peer that gives up while waiting clears the prompt", async () => {
		const h = startHarness();
		const ws = await connect(h.server.info.displayUrl);
		await h.waitFor("peer-pending");

		ws.close();
		await h.waitFor("peer-denied");

		expect(h.server.info.pendingPeer).toBeNull();
	});
});

describe("single occupancy", () => {
	test("a second peer is turned away while one is connected", async () => {
		const h = startHarness();
		await connect(h.server.info.url);
		await h.waitFor("peer-connected");

		await expect(connect(h.server.info.url)).rejects.toThrow();
		expect(h.server.hasPeer()).toBe(true);
	});

	test("a second tokenless peer is turned away while one is waiting", async () => {
		const h = startHarness();
		await connect(h.server.info.displayUrl);
		await h.waitFor("peer-pending");

		await expect(connect(h.server.info.displayUrl)).rejects.toThrow();
	});

	test("stopping the server drops a waiting peer", async () => {
		const h = startHarness();
		const ws = await connect(h.server.info.displayUrl);
		await h.waitFor("peer-pending");

		const closed = new Promise<number>((resolve) => {
			ws.onclose = (e) => resolve(e.code);
		});
		h.server.stop();

		expect(await closed).toBe(WS_NOT_APPROVED);
	});
});
