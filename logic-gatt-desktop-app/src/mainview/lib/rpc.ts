/**
 * RPC bridge to the Bun main process (real Electrobun wiring — step 4).
 *
 * Exposes the same surface the rest of the app was written against:
 *   - `rpc.request.*`  — call a Bun request handler, returns a Promise
 *   - `onDeviceEvent`  — subscribe to device events pushed from Bun
 *   - `emitDeviceEvent`— fan out an event (called by the `deviceEvent` handler)
 *
 * The native transport is only attached when running inside the Electrobun webview
 * (where `window.__electrobun` is provided by the preload). In a plain browser the
 * `rpc` object still exists but has no transport, so requests reject rather than
 * crash — the UI still renders.
 */

import { Electroview } from "electrobun/view";
import type { DesktopRPCSchema, DeviceEvent, ConnectionEvent } from "@shared/rpc";

const deviceEventListeners = new Set<(e: DeviceEvent) => void>();

/** Subscribe to device events pushed from the Bun main process. Returns unsubscribe. */
export function onDeviceEvent(fn: (e: DeviceEvent) => void): () => void {
	deviceEventListeners.add(fn);
	return () => {
		deviceEventListeners.delete(fn);
	};
}

/** Fan an event out to all subscribers (called by the `deviceEvent` message handler). */
export function emitDeviceEvent(e: DeviceEvent): void {
	for (const fn of deviceEventListeners) fn(e);
}

const connectionEventListeners = new Set<(e: ConnectionEvent) => void>();

/** Subscribe to connection-flow events (ping/pong milestone). Returns unsubscribe. */
export function onConnectionEvent(fn: (e: ConnectionEvent) => void): () => void {
	connectionEventListeners.add(fn);
	return () => {
		connectionEventListeners.delete(fn);
	};
}

const electroRpc = Electroview.defineRPC<DesktopRPCSchema>({
	handlers: {
		requests: {},
		messages: {
			deviceEvent: (payload) => emitDeviceEvent(payload),
			connectionEvent: (payload) => {
				for (const fn of connectionEventListeners) fn(payload);
			},
		},
	},
});

// Attach the native transport only inside the Electrobun webview.
if (typeof window !== "undefined" && (window as { __electrobun?: unknown }).__electrobun) {
	new Electroview({ rpc: electroRpc });
}

export const rpc = electroRpc;

/** Open a URL in the OS default browser (webview can't navigate away safely). */
export function openExternal(url: string): void {
	void rpc.request.openExternal({ url }).catch(() => {});
}
