/**
 * Mobile Executor — the built-in reference `DesktopModule`.
 *
 * Wraps the Wi-Fi `ConnectionServer` (QR + mDNS + WebSocket to the phone) behind the
 * uniform module interface so the registry routes commands to it exactly like any
 * plugin. It is an `await-peer` module: `connect()` is a no-op because the phone dials
 * in and is auto-adopted; the QR/peer telemetry keeps its own ConnectionEvent channel
 * (wired in the host), which is genuinely mobile-specific.
 *
 * New module authors should read this as the canonical example of the contract.
 */

import type { ConnectionServer } from "../connection-server";
import type { DesktopModule, PluginInfo } from "./sdk";

export const MOBILE_MODULE_INFO: PluginInfo = {
	id: "mobile-executor",
	name: "Mobile Executor",
	version: "1.0.0",
	description: "BLE GATT server running on the connected phone (over Wi-Fi).",
	icon: "bluetooth",
	color: "#34d399",
	actions: [],
	isAvailable: true,
	isDefault: true,
	connectKind: "await-peer",
};

/** Build the mobile module around an already-created connection server. */
export function createMobileModule(connection: ConnectionServer): DesktopModule {
	return {
		info: MOBILE_MODULE_INFO,
		isAvailable: () => true,
		// Selecting starts the Wi-Fi server + QR/mDNS; deselecting tears it down.
		select: () => connection.start(),
		deselect: () => connection.stop(),
		// await-peer: the phone initiates; there is nothing for the desktop to connect.
		connect: () => {},
		handleAction: () => ({}),
		async uploadSchema(schema, settings) {
			connection.sendCommand({ type: "upload-schema", schema, settings });
		},
		async notify(serviceUuid, charUuid, data) {
			connection.sendCommand({ type: "notify", serviceUuid, charUuid, data });
		},
		async respondToRead(serviceUuid, charUuid, data) {
			connection.sendCommand({ type: "respond-to-read", serviceUuid, charUuid, data });
		},
		// Stop advertising on the phone but keep the link + server up (Stop button).
		async stopDevice() {
			connection.sendCommand({ type: "disconnect" });
		},
		// Full teardown: stop advertising, then stop the Wi-Fi server (Disconnect button).
		async disconnect() {
			connection.sendCommand({ type: "disconnect" });
			connection.stop();
		},
	};
}
