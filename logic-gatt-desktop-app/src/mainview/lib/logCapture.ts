/**
 * Webview-side log capture.
 *
 * The system webview is a sandboxed browser context — it cannot write files. So its
 * high-value signals (uncaught errors, unhandled promise rejections, and console
 * warnings/errors) are shipped over RPC to the Bun main process, which writes them into
 * the single per-session log file alongside the Bun-side output.
 *
 * We deliberately capture only `error`/`warn` and the two global error events, not every
 * `console.log`, to keep the file focused on things that matter for diagnosis. `console.*`
 * still prints to the webview devtools console as normal.
 */

import { rpc } from './rpc'
import type { LogLevel } from '@shared/rpc'

let installed = false

/**
 * Fire-and-forget a log line to the Bun-side session file. Must never throw or reject
 * (a rejection would re-trigger the unhandledrejection handler and recurse). Exported so
 * other webview code (e.g. the in-app Terminal logger) can persist its lines too.
 */
export function forwardLog(level: LogLevel, source: string, message: string): void {
  try {
    const p = rpc.request.log({ level, source, message })
    // Outside the Electrobun webview the RPC transport is absent and this rejects; swallow
    // it so the rejection doesn't re-trigger the unhandledrejection handler in a loop.
    if (p && typeof p.catch === 'function') p.catch(() => {})
  } catch {
    /* ignore — logging must not break the app */
  }
}

/** Local shorthand for webview-sourced lines. */
function ship(level: LogLevel, message: string): void {
  forwardLog(level, 'webview', message)
}

/** Turn console arguments into a single string line. */
function argsToMessage(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a
      if (a instanceof Error) return a.stack || a.message
      try {
        return typeof a === 'object' ? JSON.stringify(a) : String(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}

export function installWebviewLogCapture(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', (e: ErrorEvent) => {
    const where = e.filename ? ` @ ${e.filename}:${e.lineno}:${e.colno}` : ''
    const stack = e.error instanceof Error && e.error.stack ? `\n${e.error.stack}` : ''
    ship('error', `window.onerror: ${e.message}${where}${stack}`)
  })

  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const reason = e.reason instanceof Error ? e.reason.stack || e.reason.message : String(e.reason)
    ship('error', `unhandledrejection: ${reason}`)
  })

  // Tee console.error / console.warn to the file while keeping normal devtools output.
  const realError = console.error.bind(console)
  const realWarn = console.warn.bind(console)
  console.error = (...args: unknown[]) => {
    realError(...args)
    ship('error', argsToMessage(args))
  }
  console.warn = (...args: unknown[]) => {
    realWarn(...args)
    ship('warn', argsToMessage(args))
  }
}
