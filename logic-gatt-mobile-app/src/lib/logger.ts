/**
 * Tagged, levelled logger for the mobile app.
 *
 * Before this the app logged only to the in-app "Log" panel and made no
 * `console` calls at all, so Metro / adb logcat / RN DevTools showed nothing.
 * Every level here mirrors to the JS console; `info` / `warn` / `error` also
 * flow to a `sink` (the UI panel). `debug` is console-only so high-rate traces
 * (e.g. ping round-trips) don't flood the panel.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  tag: string;
  msg: string;
}

/** Receives entries destined for the UI panel. `debug` never reaches here. */
export type LogSink = (entry: LogEntry) => void;

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

/** Best-effort human string from any thrown value (native modules attach `message`/`code`). */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string') return m;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

const CONSOLE: Record<LogLevel, (...args: unknown[]) => void> = {
  debug: console.debug ?? console.log,
  info: console.info ?? console.log,
  warn: console.warn,
  error: console.error,
};

/** Create a logger tagged `tag`; UI-bound levels are forwarded to `sink`. */
export function createLogger(tag: string, sink: LogSink): Logger {
  const emit = (level: LogLevel, msg: string) => {
    CONSOLE[level](`[${tag}] ${msg}`);
    if (level !== 'debug') sink({ ts: Date.now(), level, tag, msg });
  };
  return {
    debug: (m) => emit('debug', m),
    info: (m) => emit('info', m),
    warn: (m) => emit('warn', m),
    error: (m) => emit('error', m),
  };
}

/** `HH:MM:SS.mmm` — millisecond precision so latency/timing is visible in the panel. */
export function formatLogTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
