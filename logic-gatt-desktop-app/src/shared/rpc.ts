/**
 * RPC contract between the webview and the Bun main process.
 *
 * Shared by both sides. Structured to satisfy electrobun's `ElectrobunRPCSchema`
 * (`{ bun, webview }`, each with `requests` + `messages`). Convention (see
 * electrobun `defineElectrobunRPC`):
 *   - `bun.requests`     = requests HANDLED BY bun     (the webview calls them)
 *   - `webview.messages` = messages HANDLED BY webview (bun sends them)
 *
 * Kept free of any electrobun import so it is safe to load on both sides.
 */

import type {
	PluginEvent,
	PluginInfo,
	Schema as WireSchema,
	DeviceSettings as WireDeviceSettings,
} from "./wire";

type Req<P, R> = { params: P; response: R };

/** Severity for a log line. Mirrors `LogLevel` in `bun/logger.ts` (kept local so this
 * shared file never imports the Bun-only logger). */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Info the webview needs to render the QR / show the address. */
export type ConnectionInfo = {
	url: string;
	host: string;
	port: number;
	localName: string;
	/**
	 * The currently-connected executor (phone), or null if none. A snapshot so the
	 * connect UI can adopt a peer that connected *before* the modal was opened
	 * (e.g. a reconnect), not only ones that arrive via a live `peer-connected`.
	 */
	peerId: string | null;
};

/** Connection-flow events pushed from Bun to the webview (ping/pong milestone). */
export type ConnectionEvent =
	| { type: "server-listening"; url: string; host: string; port: number }
	| { type: "peer-connected"; peerId: string }
	| { type: "peer-disconnected"; peerId: string }
	| { type: "ping"; peerId: string; seq: number }
	| { type: "pong"; peerId: string; seq: number }
	| { type: "log"; message: string };

export type DesktopRPCSchema = {
	bun: {
		requests: {
			// connection flow (QR + mDNS + ping/pong milestone)
			getConnectionInfo: Req<void, ConnectionInfo>;
			// transport lifecycle. `connect` opens the link for INITIATE modules (serial /
			// local backend); it is a no-op for the mobile module (the phone dials in and
			// is auto-adopted). `disconnect` ends the session for any module.
			connect: Req<void, void>;
			uploadSchema: Req<{ schema: WireSchema; settings: WireDeviceSettings }, void>;
			notify: Req<{ serviceUuid: string; charUuid: string; data: number[] }, void>;
			respondToRead: Req<{ serviceUuid: string; charUuid: string; data: number[] }, void>;
			// Stop the emulated device but keep the link (Stop). `disconnect` = full teardown.
			stopDevice: Req<void, void>;
			disconnect: Req<void, void>;
			// modules (ex-"plugins")
			listModules: Req<void, PluginInfo[]>;
			selectModule: Req<{ moduleId: string }, PluginInfo | null>;
			callModuleAction: Req<
				{ moduleId: string; method: string; path: string; body?: unknown },
				unknown
			>;
			// presets
			getPresets: Req<void, string[]>;
			getPreset: Req<{ name: string }, unknown>;
			// Called once the webview has mounted so Bun can nudge the window size — the
			// webview is created at the OUTER frame size and only corrects to the client
			// area on a real resize event (see index.ts).
			fitWindow: Req<void, void>;
			// logging: the webview ships its own errors/warnings here so they land in the
			// single Bun-side session log file (the webview can't write files itself).
			log: Req<{ level: LogLevel; source: string; message: string }, void>;
			// reveal the logs directory in the OS file manager (the "Open logs folder" button).
			openLogsFolder: Req<void, { dir: string } | null>;
			// open an external URL in the user's default browser (doc links). The webview
			// can't navigate away safely, so this hands off to the OS.
			openExternal: Req<{ url: string }, void>;
		};
		messages: Record<never, never>;
	};
	webview: {
		requests: Record<never, never>;
		messages: {
			/** Bun -> webview device event stream. */
			deviceEvent: PluginEvent;
			/** Bun -> webview connection-flow events. */
			connectionEvent: ConnectionEvent;
		};
	};
};

/** Bun -> webview push message payload. */
export type DeviceEvent = PluginEvent;
