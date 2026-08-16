import { useState, useRef, useCallback } from 'react'
import { forwardLog } from '../lib/logCapture'

export function useLogger() {
  const [logs, setLogs] = useState<string[]>([])
  // Attached to the terminal <pre>; the Terminal owns scroll behaviour (auto-scroll only
  // while the user is pinned to the bottom) so reading back-scrolled logs isn't interrupted.
  const ref = useRef<HTMLPreElement>(null)

  const log = useCallback((msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])
    // Also persist to the Bun-side session log file. These runtime/scenario lines are the
    // most useful trace for diagnosing a session, so they must survive past the UI buffer.
    forwardLog(/error/i.test(msg) ? 'error' : 'info', 'terminal', msg)
  }, [])

  const clear = useCallback(() => setLogs([]), [])

  return { logs, log, clear, ref }
}
