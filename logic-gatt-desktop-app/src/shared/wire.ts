/**
 * Wire types shared between the Bun main process and the webview.
 *
 * Inlined from the old `@logic-gatt/shared` package. The frontend only ever used
 * these as *types* (no runtime zod), so they are plain TypeScript here. Binary GATT
 * values are `number[]` on the wire (JSON-serializable); the webview converts to/from
 * `Uint8Array` at the transport boundary.
 */

// --- GATT schema (wire format) ---

export interface CharacteristicProperties {
	read: boolean;
	write: boolean;
	notify: boolean;
}

export interface CharacteristicDef {
	uuid: string;
	name?: string;
	properties: CharacteristicProperties;
	defaultValue?: number[];
}

export interface ServiceDef {
	uuid: string;
	name?: string;
	characteristics: CharacteristicDef[];
}

export interface Schema {
	services: ServiceDef[];
}

export interface DeviceSettings {
	deviceName: string;
	appearance?: number;
	manufacturerData?: number[];
	serviceUuids16Bit?: string[];
}

// --- device -> webview events ---

export type PluginEvent =
	| { type: "char-write"; serviceUuid: string; charUuid: string; data: number[] }
	| { type: "char-read"; serviceUuid: string; charUuid: string }
	| { type: "connected" }
	| { type: "disconnected"; reason?: string }
	| { type: "error"; message: string }
	| { type: "log"; message: string }
	| { type: "schema-mismatch" }
	| { type: "adv-started" }
	| { type: "adv-failed"; stage: string; errorCode: number };

// --- webview -> device commands ---

export type PluginCommand =
	| { type: "upload-schema"; schema: Schema; settings: DeviceSettings }
	| { type: "connect" }
	| { type: "disconnect" }
	| { type: "notify"; serviceUuid: string; charUuid: string; data: number[] }
	| { type: "respond-to-read"; serviceUuid: string; charUuid: string; data: number[] };

// --- module (ex-"plugin") metadata for the metadata-driven connect UI ---

export interface PluginActionUI {
	display:
		| "hidden"
		| "button"
		| "select-source"
		| "select-target"
		| "status"
		| "status-start"
		| "status-stop";
	fieldId?: string;
	fieldLabel?: string;
	refreshMs?: number;
	requiredForConnect?: boolean;
}

export interface PluginAction {
	method: "GET" | "POST" | "PUT" | "DELETE";
	path: string;
	label: string;
	description?: string;
	ui?: PluginActionUI;
}

export interface PluginInfo {
	id: string;
	name: string;
	version: string;
	description: string;
	icon?: string;
	color?: string;
	actions: PluginAction[];
	isAvailable: boolean;
	/**
	 * Marks the recommended default connection way. Shown first in the Select
	 * Transport list with a "Default" badge. Exactly one module should set this.
	 */
	isDefault?: boolean;
	/**
	 * How this module establishes its link, i.e. who initiates:
	 *   - "await-peer": the desktop is the server and *waits* for the executor to
	 *     dial in (the mobile app scans the QR / auto-discovers, then connects).
	 *     The connect UI shows a QR and auto-adopts the peer — there is no
	 *     "Connect" button and no outbound connect command.
	 *   - "initiate": the desktop opens the link itself (e.g. a USB dongle: pick a
	 *     port, then Connect). Uses the metadata-driven action form.
	 * Defaults to "initiate" when omitted (old plugin behaviour).
	 */
	connectKind?: "await-peer" | "initiate";
}
