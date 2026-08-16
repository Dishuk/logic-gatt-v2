/**
 * File logger for the Bun main process.
 *
 * Why this exists: the app's real output (Bun `console.*`, module `ctx.log`, the
 * connection server, and — via RPC — the webview's errors) previously went only to
 * the `make dev` terminal's stdout, which is ephemeral and absent entirely in a
 * packaged build. This writes it all to a rotating, per-session log file on disk so
 * a crash or a bug leaves a durable trail the user can hand over.
 *
 * Design decisions (see the logging discussion):
 *   - **Session-scoped rotation, not size-based.** One file per app launch; keep the
 *     newest `MAX_SESSIONS`. This app emits human-scale events (KB/session), so
 *     size-rolling machinery (`.1`, `.2`, …) buys nothing. `MAX_FILE_BYTES` is only a
 *     runaway-loop guard, not the primary mechanism.
 *   - **`appendFileSync` per line (not a buffered FileSink).** Crashes are exactly when
 *     you need the tail, and a synchronous append is durable with no flush ambiguity.
 *     Volume is tiny, so the per-call `open` cost is irrelevant.
 *   - **Never throws.** Logging must not be able to take down the app.
 *
 * Location comes from Electrobun's `Utils.paths.userLogs` (app + channel scoped,
 * e.g. `%LOCALAPPDATA%\<id>\<channel>\logs` on Windows, `~/Library/Logs/…` on macOS).
 * In dev that can be degenerate (it reads a bundled `version.json` that may be absent),
 * so we fall back to a fixed `<logsBase>/LogicGATT/logs`.
 */

import { Utils } from "electrobun/bun";
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

/** How many past session files to keep (this one included). */
const MAX_SESSIONS = 10;
/** Per-session hard cap — a runaway loop guard, not the rotation mechanism. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

let logDir = "";
let logFile = "";
let bytesWritten = 0;
let overflowed = false;

/** Console methods captured BEFORE we patch them, so the file logger can echo to stdout. */
const realConsole = {
	log: console.log.bind(console),
	info: console.info.bind(console),
	warn: console.warn.bind(console),
	error: console.error.bind(console),
	debug: console.debug.bind(console),
};

/** Resolve a stable, app-scoped logs directory across dev and packaged builds. */
function resolveLogDir(): string {
	try {
		const scoped = Utils.paths.userLogs; // reads version.json synchronously
		// When identifier/channel are empty (dev, no version.json) `userLogs` collapses
		// to the base logs dir — detect that and use the fixed fallback instead.
		if (scoped && scoped !== Utils.paths.logs) return join(scoped, "logs");
	} catch {
		/* fall through to fallback */
	}
	return join(Utils.paths.logs, "LogicGATT", "logs");
}

/** Filesystem-safe timestamp for a filename: 2026-08-15T08-46-31. */
function fileStamp(d: Date): string {
	return d.toISOString().replace(/\.\d+Z$/, "").replace(/:/g, "-");
}

/** Delete session files beyond the newest MAX_SESSIONS. Best-effort, never throws. */
function pruneOldSessions(dir: string): void {
	try {
		const sessions = readdirSync(dir)
			.filter((f) => f.startsWith("session-") && f.endsWith(".log"))
			.map((f) => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
			.sort((a, b) => b.mtime - a.mtime);
		for (const { f } of sessions.slice(MAX_SESSIONS)) {
			try {
				unlinkSync(join(dir, f));
			} catch {
				/* ignore individual failures */
			}
		}
	} catch {
		/* ignore */
	}
}

function format(level: LogLevel, source: string, message: string): string {
	return `${new Date().toISOString()} [${level.toUpperCase().padEnd(5)}] [${source}] ${message}\n`;
}

/** Write one line to the session file. Never throws; silent no-op before init. */
export function writeLog(level: LogLevel, source: string, message: string): void {
	if (!logFile || overflowed) return;
	const line = format(level, source, message);
	try {
		appendFileSync(logFile, line);
		bytesWritten += Buffer.byteLength(line);
		if (bytesWritten > MAX_FILE_BYTES) {
			overflowed = true;
			appendFileSync(
				logFile,
				format("warn", "logger", `session log exceeded ${MAX_FILE_BYTES} bytes — further lines suppressed`),
			);
		}
	} catch {
		/* logging must never crash the app */
	}
}

/** Turn arbitrary console args into a single string line. */
function argsToMessage(args: unknown[]): string {
	return args
		.map((a) => {
			if (typeof a === "string") return a;
			if (a instanceof Error) return a.stack || a.message;
			try {
				return typeof a === "object" ? JSON.stringify(a) : String(a);
			} catch {
				return String(a);
			}
		})
		.join(" ");
}

/** Route console.* through the file logger while still printing to stdout (dev terminal). */
function patchConsole(): void {
	console.log = (...a: unknown[]) => {
		realConsole.log(...a);
		writeLog("info", "bun", argsToMessage(a));
	};
	console.info = (...a: unknown[]) => {
		realConsole.info(...a);
		writeLog("info", "bun", argsToMessage(a));
	};
	console.warn = (...a: unknown[]) => {
		realConsole.warn(...a);
		writeLog("warn", "bun", argsToMessage(a));
	};
	console.error = (...a: unknown[]) => {
		realConsole.error(...a);
		writeLog("error", "bun", argsToMessage(a));
	};
	console.debug = (...a: unknown[]) => {
		realConsole.debug(...a);
		writeLog("debug", "bun", argsToMessage(a));
	};
}

/** Capture crash signals that currently go nowhere. */
function installProcessHandlers(): void {
	process.on("uncaughtException", (err) => {
		writeLog("error", "bun", `uncaughtException: ${err?.stack || err}`);
		// Preserve the pre-logger crash semantics (no handler = process dies), but only
		// after the line is durably on disk. Electrobun's process.exit runs native cleanup.
		process.exit(1);
	});
	process.on("unhandledRejection", (reason) => {
		const detail = reason instanceof Error ? reason.stack || reason.message : String(reason);
		writeLog("error", "bun", `unhandledRejection: ${detail}`);
	});
}

/**
 * Start a new logging session: create the dir, open a fresh timestamped file, prune old
 * sessions, patch console, and install crash handlers. Idempotent-ish — call once at boot.
 * Returns the resolved paths (never throws; returns empty strings if setup failed).
 */
export function initLogger(): { dir: string; file: string } {
	try {
		logDir = resolveLogDir();
		mkdirSync(logDir, { recursive: true });
		const now = new Date();
		logFile = join(logDir, `session-${fileStamp(now)}.log`);
		bytesWritten = 0;
		overflowed = false;
		writeLog("info", "logger", `session started — ${now.toISOString()}`);
		pruneOldSessions(logDir); // after creating this file, so it counts toward MAX_SESSIONS
		patchConsole();
		installProcessHandlers();
		realConsole.log(`[logger] writing session log to ${logFile}`);
	} catch (err) {
		realConsole.error("[logger] failed to initialize file logging:", err);
	}
	return { dir: logDir, file: logFile };
}

/** The active logs directory (for the "Open logs folder" action). */
export function getLogDir(): string {
	return logDir;
}
