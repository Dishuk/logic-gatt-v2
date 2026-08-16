/**
 * Module loader — talks to the Bun main process over RPC.
 *
 * Formerly fetched modules ("plugins") from a backend REST API; now RPC. The exported
 * surface is unchanged so `BackendTransportModal` needs no edits.
 */

import type { BackendPluginInfo } from "./types";
import { rpc } from "@/lib/rpc";

/** Fetch the list of available modules. */
export async function fetchBackendPlugins(): Promise<BackendPluginInfo[]> {
	try {
		return await rpc.request.listModules();
	} catch (err) {
		console.error("Failed to fetch modules:", err);
		return [];
	}
}

/** Select the active module. */
export async function selectPlugin(pluginId: string): Promise<BackendPluginInfo | null> {
	try {
		return await rpc.request.selectModule({ moduleId: pluginId });
	} catch (err) {
		console.error("Failed to select module:", err);
		return null;
	}
}

/** Call a module's custom action. */
export async function callPluginAction(
	pluginId: string,
	method: string,
	path: string,
	body?: unknown,
): Promise<unknown> {
	return rpc.request.callModuleAction({ moduleId: pluginId, method, path, body });
}
