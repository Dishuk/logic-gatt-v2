import { BrowserWindow, BrowserView, Updater, Utils, Screen } from "electrobun/bun";
import { fileURLToPath } from "node:url";
import type { ConnectionEvent, DesktopRPCSchema } from "../shared/rpc";
import type { PluginEvent } from "../shared/wire";
import { createConnectionServer } from "./connection-server";
import { ModuleRegistry } from "./modules/registry";
import { createMobileModule } from "./modules/mobile";
import { initLogger, getLogDir, writeLog } from "./logger";
import { applyWindowsDarkTitleBar } from "./windows-dark-titlebar";
import { applyWindowsWindowIcon } from "./windows-window-icon";
import defaultPreset from "./presets/default.json";
import heartRatePreset from "./presets/heart-rate-monitor.json";

// Built-in example projects, keyed by the id the webview sends (see PRESET_INFO in App.tsx).
// Embedded via import so they ship inside the bundled Bun binary (no runtime file reads).
const PRESETS: Record<string, unknown> = {
	default: defaultPreset,
	"heart-rate-monitor": heartRatePreset,
};

// Start file logging before anything else so early console output and any crash during
// startup are captured. This also patches console.* to tee into the session log file.
initLogger();

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

// Check if Vite dev server is running for HMR
async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
			return DEV_SERVER_URL;
		} catch {
			console.log(
				"Vite dev server not running. Run 'bun run dev:hmr' for HMR support.",
			);
		}
	}
	return "views://mainview/index.html";
}

// Create the Wi-Fi transport server (the mobile module wraps this). It only listens
// while the mobile module is the active one. Its two event streams are forwarded to
// the webview once the RPC transport is live (wiring after the window is created).
let sendConnectionEvent: (e: ConnectionEvent) => void = () => {};
let sendDeviceEvent: (e: PluginEvent) => void = () => {};
const connection = createConnectionServer({
	onConnectionEvent: (e) => sendConnectionEvent(e),
	onDeviceEvent: (e) => sendDeviceEvent(e),
});
console.log(`Connection server ready (starts when Mobile Executor is selected): ${connection.info.url}`);

// Module registry: mobile is the built-in default (the reference module); any modules
// dropped in `modules/plugins/*` are scanned and loaded. Every module's device events
// flow through the same sink to the webview's `deviceEvent` channel.
const registry = new ModuleRegistry({ broadcast: (e) => sendDeviceEvent(e) });
registry.register(createMobileModule(connection));

// Resolve the active module or fail loudly, so transport RPCs (upload/notify/…) reject
// instead of silently no-op'ing when nothing is selected (the webview would otherwise
// treat the call as a success).
function activeOrThrow() {
	const mod = registry.active();
	if (!mod) throw new Error("No active transport — select a device first.");
	return mod;
}
const pluginsDir = fileURLToPath(new URL("./modules/plugins/", import.meta.url));
await registry.loadFromDir(pluginsDir);

// RPC handlers (webview -> bun). Transport requests are serialized to the phone as
// PluginCommands; `getConnectionInfo` drives the QR/status; modules reflect the phone.
const rpc = BrowserView.defineRPC<DesktopRPCSchema>({
	handlers: {
		requests: {
			async getConnectionInfo() {
				return connection.info;
			},
			async uploadSchema({ schema, settings }) {
				await activeOrThrow().uploadSchema(schema, settings);
			},
			async notify({ serviceUuid, charUuid, data }) {
				await activeOrThrow().notify(serviceUuid, charUuid, data);
			},
			async respondToRead({ serviceUuid, charUuid, data }) {
				await activeOrThrow().respondToRead(serviceUuid, charUuid, data);
			},
			async connect() {
				// Initiate modules (serial / local backend) open their link here; the
				// mobile module is a no-op (the phone dials in and is auto-adopted).
				await activeOrThrow().connect();
			},
			async stopDevice() {
				// Stop the emulated device but keep the link (Stop button).
				await activeOrThrow().stopDevice();
			},
			async disconnect() {
				// Full teardown of the active module's link (Disconnect button).
				await activeOrThrow().disconnect();
			},
			async listModules() {
				return registry.list();
			},
			async selectModule({ moduleId }) {
				// Deselects the previous module (e.g. stops the Wi-Fi server) and selects
				// the new one. Returns its info, or null for an unknown id.
				return registry.select(moduleId);
			},
			async callModuleAction({ moduleId, method, path, body }) {
				const mod = registry.get(moduleId);
				return mod ? mod.handleAction(method, path, body) : {};
			},
			async getPresets() {
				return Object.keys(PRESETS);
			},
			async getPreset({ name }) {
				const preset = PRESETS[name];
				if (!preset) throw new Error(`Unknown preset: ${name}`);
				return preset;
			},
			async fitWindow() {
				// The webview just mounted. On Windows it's created at the OUTER window size
				// (incl. title bar/borders) and only snaps to the client area on a real resize
				// event, so its right/bottom edge overflows and clips content. Nudge the size
				// (h-1 → h, two real WM_SIZE events) now that the view exists to trigger the
				// native auto-resize down to the client area.
				const f = mainWindow.getFrame();
				mainWindow.setSize(f.width, f.height - 1);
				mainWindow.setSize(f.width, f.height);
			},
			async log({ level, source, message }) {
				// Webview-originated log line → the single Bun-side session file.
				writeLog(level, source, message);
			},
			async openLogsFolder() {
				const dir = getLogDir();
				if (!dir) return null;
				Utils.openPath(dir); // reveal the folder in the OS file manager
				return { dir };
			},
			async openExternal({ url }) {
				// Only hand off http(s) URLs to the OS browser — never arbitrary schemes.
				if (/^https?:\/\//i.test(url)) Utils.openExternal(url);
			},
		},
	},
});

// Create the main application window
const url = await getMainViewUrl();

// Open at 85% of the primary display's work area, centered. We size the window at
// creation rather than calling maximize() afterward, because the webview is created at
// the window's initial frame and can't be resized after — maximize() grows the OS window
// but leaves the webview small (white gap). Fall back to a fixed size if the query fails.
const WINDOW_SCALE = 0.85;
const { workArea } = Screen.getPrimaryDisplay();
const frame =
	workArea.width > 0 && workArea.height > 0
		? {
				width: Math.round(workArea.width * WINDOW_SCALE),
				height: Math.round(workArea.height * WINDOW_SCALE),
				x: workArea.x + Math.round((workArea.width * (1 - WINDOW_SCALE)) / 2),
				y: workArea.y + Math.round((workArea.height * (1 - WINDOW_SCALE)) / 2),
			}
		: { x: 200, y: 200, width: 1100, height: 800 };

const mainWindow = new BrowserWindow({
	title: "LogicGATT",
	url,
	frame,
	rpc,
});

// Electrobun leaves the native Windows caption in the OS light theme; recolor it
// dark to match the app (no-op on macOS/Linux and on any failure).
applyWindowsDarkTitleBar("LogicGATT");

// Electrobun sets no window icon on Windows, so the caption + taskbar show a
// blank default; set our icon on the native HWND via Win32 FFI (no-op elsewhere).
applyWindowsWindowIcon("LogicGATT");

// The webview corrects itself to the client area once it calls `fitWindow` on mount (see
// the RPC handler above) — no timer needed here.

// Now that the RPC transport is attached, forward both event streams to the webview.
sendConnectionEvent = (e) => {
	try {
		rpc.send.connectionEvent(e);
	} catch {
		/* webview not ready yet — it re-fetches state via getConnectionInfo on mount */
	}
};
sendDeviceEvent = (e) => {
	try {
		rpc.send.deviceEvent(e);
	} catch {
		/* webview not ready yet */
	}
};

console.log("LogicGATT desktop started!");
