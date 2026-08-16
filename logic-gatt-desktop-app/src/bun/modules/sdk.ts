/**
 * Module SDK — the ONLY host surface a module depends on.
 *
 * Ported from the old app's `@logic-gatt/shared` (`PluginBase` + `PluginContext`).
 * A module imports types + `PluginBase` from here and receives everything else (event
 * emit, logging, its own dir) via the injected `ModuleContext`. That keeps modules
 * self-contained so they can be loaded uniformly — the mobile module is the reference.
 */

import type {
	PluginEvent,
	PluginInfo,
	PluginAction,
	PluginActionUI,
	Schema,
	DeviceSettings,
} from "../../shared/wire";

export type { PluginEvent, PluginInfo, PluginAction, PluginActionUI, Schema, DeviceSettings };

/** Metadata a module folder declares in its `manifest.json`. */
export interface PluginManifest {
	id: string;
	name: string;
	version: string;
	description: string;
	icon?: string;
	color?: string;
	/** Bumped when the module contract changes; the loader rejects incompatible modules. */
	apiVersion?: number;
	/** Reserved for future select-transport ordering; the mobile module is the default. */
	isDefault?: boolean;
}

/** Current module contract version. Manifests should declare this. */
export const MODULE_API_VERSION = 1;

/** Injected into every module — how it talks back to the host/UI. */
export interface ModuleContext {
	/** This module's id. */
	moduleId: string;
	/** Absolute path to this module's own directory (for bundled assets, e.g. `python/`). */
	moduleDir: string;
	/** Push a device event up to the webview (char-write/read, connected, log, error, …). */
	broadcast(event: PluginEvent): void;
	/** Log to the console AND surface it in the webview as a `log` event. */
	log(msg: string): void;
}

/**
 * A connectable transport/executor. The registry routes the webview's transport RPCs
 * and connect-form actions to the ACTIVE module. Mobile, ble-uart and usb-ble all
 * satisfy this (legacy plugins via `pluginToModule`).
 */
export interface DesktopModule {
	/** Static metadata for the Select Transport menu (+ `actions` for the connect form). */
	readonly info: PluginInfo;
	/** Whether this module can run in the current environment. */
	isAvailable(): boolean | Promise<boolean>;
	/** Become the active transport (start listening / prepare). */
	select(): void | Promise<void>;
	/** Stop being active (tear down links/servers). Idempotent. */
	deselect(): void | Promise<void>;
	/** Establish the device link (old `onConnect`). No-op for await-peer (mobile). */
	connect(): void | Promise<void>;
	/** Handle a connect-form action (old `getRoutes` handler), keyed by method+path. */
	handleAction(method: string, path: string, body?: unknown): unknown | Promise<unknown>;
	/** Upload the GATT schema + device settings to the executor. */
	uploadSchema(schema: Schema, settings: DeviceSettings): Promise<void>;
	/** Send a BLE notification. */
	notify(serviceUuid: string, charUuid: string, data: number[]): Promise<void>;
	/** Respond to a pending BLE read. */
	respondToRead(serviceUuid: string, charUuid: string, data: number[]): Promise<void>;
	/** Stop the emulated device but keep the link (Stop button). */
	stopDevice(): Promise<void>;
	/** Full teardown of the device link (Disconnect button). */
	disconnect(): Promise<void>;
}

/** A module file default-exports a factory taking its context + parsed manifest. */
export type ModuleFactory = (
	ctx: ModuleContext,
	manifest: PluginManifest,
) => DesktopModule | Promise<DesktopModule>;

// ---------------------------------------------------------------------------
// Legacy plugin base + adapter — so old plugin classes port with minimal edits.
// ---------------------------------------------------------------------------

/** A connect-form action. Handler is `(body) => result` (was Express `(req,res)`). */
export interface PluginRoute {
	method: "GET" | "POST" | "PUT" | "DELETE";
	path: string;
	label: string;
	description?: string;
	ui?: PluginActionUI;
	handler: (body?: unknown) => unknown | Promise<unknown>;
}

/**
 * Base class matching the old `@logic-gatt/shared` PluginBase. Legacy plugins extend
 * this unchanged except for the import path and the route handler signature.
 */
export abstract class PluginBase {
	protected ctx: ModuleContext;

	constructor(context: ModuleContext) {
		this.ctx = context;
	}

	// Required operational callbacks (identical to the old contract).
	abstract onUploadSchema(schema: Schema, settings: DeviceSettings): Promise<void>;
	abstract onConnect(): Promise<void>;
	abstract onDisconnect(): Promise<void>;
	abstract onNotify(serviceUuid: string, charUuid: string, data: Uint8Array): Promise<void>;
	abstract onRespondToRead(serviceUuid: string, charUuid: string, data: Uint8Array): Promise<void>;

	// Optional lifecycle + capability hooks.
	async onLoad(): Promise<void> {}
	async onUnload(): Promise<void> {}
	getRoutes(): PluginRoute[] {
		return [];
	}
	isAvailable(): boolean {
		return true;
	}
}

/** Adapt a `PluginBase` instance + its manifest into a `DesktopModule`. */
export function pluginToModule(instance: PluginBase, manifest: PluginManifest): DesktopModule {
	const routes = instance.getRoutes();
	const info: PluginInfo = {
		id: manifest.id,
		name: manifest.name,
		version: manifest.version,
		description: manifest.description,
		icon: manifest.icon,
		color: manifest.color,
		isDefault: manifest.isDefault,
		// Legacy plugins are all desktop-initiated (serial port / local backend).
		connectKind: "initiate",
		isAvailable: instance.isAvailable(),
		actions: routes.map((r) => ({
			method: r.method,
			path: r.path,
			label: r.label,
			description: r.description,
			ui: r.ui,
		})),
	};

	return {
		info,
		isAvailable: () => instance.isAvailable(),
		select: () => instance.onLoad(),
		deselect: () => instance.onUnload(),
		connect: () => instance.onConnect(),
		handleAction: (method, path, body) => {
			const route = routes.find((r) => r.method === method && r.path === path);
			if (!route) throw new Error(`No action ${method} ${path} on ${manifest.id}`);
			return route.handler(body);
		},
		uploadSchema: (schema, settings) => instance.onUploadSchema(schema, settings),
		notify: (s, c, data) => instance.onNotify(s, c, new Uint8Array(data)),
		respondToRead: (s, c, data) => instance.onRespondToRead(s, c, new Uint8Array(data)),
		stopDevice: () => instance.onDisconnect(),
		disconnect: () => instance.onDisconnect(),
	};
}
