/**
 * Electrobun transport connection.
 *
 * Implements `TransportConnection` over RPC to the Bun main process (which owns the
 * Wi-Fi link to the phone). Replaces the old WebSocket `BackendConnection`; the UI
 * and runtime above the interface are unchanged.
 */

import type { Schema, DeviceSettings } from "@/types";
import type { TransportConnection, TransportEvent, TransportEventHandler } from "./types";
import type {
	PluginEvent,
	Schema as WireSchema,
	DeviceSettings as WireDeviceSettings,
} from "@logic-gatt/shared";
import { rpc, onDeviceEvent } from "@/lib/rpc";

export class ElectrobunConnection implements TransportConnection {
	private eventHandlers = new Set<TransportEventHandler>();
	private off?: () => void;

	/**
	 * Begin listening for device events pushed from the Bun main process. For the
	 * mobile (`await-peer`) module the WebSocket link already exists — the phone
	 * dialed in and the Bun host adopted it — so there is nothing to "connect": this
	 * only starts forwarding the phone's events into the UI/runtime.
	 */
	async connect(): Promise<void> {
		this.off = onDeviceEvent((e) => this.handle(e));
	}

	private handle(e: PluginEvent): void {
		// Only char-write carries binary; convert number[] -> Uint8Array. The rest of
		// the event union is structurally identical to TransportEvent.
		if (e.type === "char-write") {
			this.emit({
				type: "char-write",
				serviceUuid: e.serviceUuid,
				charUuid: e.charUuid,
				data: new Uint8Array(e.data),
			});
		} else {
			this.emit(e as TransportEvent);
		}
	}

	private emit(event: TransportEvent): void {
		for (const handler of this.eventHandlers) handler(event);
	}

	async uploadSchema(
		schema: Schema,
		settings: DeviceSettings,
		log: (msg: string) => void,
	): Promise<void> {
		log("Uploading schema...");
		await rpc.request.uploadSchema({
			schema: toWireSchema(schema),
			settings: toWireSettings(settings),
		});
	}

	async notify(serviceUuid: string, charUuid: string, data: Uint8Array): Promise<void> {
		await rpc.request.notify({ serviceUuid, charUuid, data: Array.from(data) });
	}

	async respondToRead(serviceUuid: string, charUuid: string, data: Uint8Array): Promise<void> {
		await rpc.request.respondToRead({ serviceUuid, charUuid, data: Array.from(data) });
	}

	onEvent(handler: TransportEventHandler): () => void {
		this.eventHandlers.add(handler);
		return () => {
			this.eventHandlers.delete(handler);
		};
	}

	async stopDevice(): Promise<void> {
		// Stop advertising / tear down the phone's GATT server, but keep the WebSocket
		// link and the desktop's Wi-Fi server up so we can Upload & Run again.
		await rpc.request.stopDevice();
	}

	async disconnect(): Promise<void> {
		this.off?.();
		this.off = undefined;
		await rpc.request.disconnect();
	}
}

// --- wire conversions (ported from the old BackendConnection.uploadSchema) ---

function toWireSchema(schema: Schema): WireSchema {
	return {
		services: schema.map((svc) => ({
			uuid: svc.uuid,
			name: svc.tag || svc.uuid,
			characteristics: svc.characteristics.map((chr) => ({
				uuid: chr.uuid,
				name: chr.tag || chr.uuid,
				properties: chr.properties,
				defaultValue: chr.defaultValue
					? Array.from(hexStringToBytes(chr.defaultValue))
					: undefined,
			})),
		})),
	};
}

function toWireSettings(settings: DeviceSettings): WireDeviceSettings {
	return {
		deviceName: settings.deviceName,
		appearance: settings.appearance,
		manufacturerData: settings.manufacturerData
			? Array.from(hexStringToBytes(settings.manufacturerData))
			: [],
		serviceUuids16Bit: [],
	};
}

/** Parse a hex string (space-separated bytes) into a Uint8Array. */
function hexStringToBytes(hex: string): Uint8Array {
	const trimmed = hex.trim();
	if (!trimmed) return new Uint8Array();
	const tokens = trimmed.split(/\s+/).filter(Boolean);
	return new Uint8Array(
		tokens.map((t) => {
			const val = parseInt(t, 16);
			if (Number.isNaN(val)) {
				console.warn(`[hexStringToBytes] Invalid hex token: "${t}"`);
				return 0;
			}
			return val & 0xff;
		}),
	);
}
