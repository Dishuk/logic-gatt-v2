import { useState, useRef, useCallback, useEffect } from 'react'
import { Trash2, FolderOpen } from 'lucide-react'
import type { useLogger } from '../hooks/useLogger'
import { rpc } from '../lib/rpc'

const MIN_HEIGHT = 100
const DEFAULT_HEIGHT = 200

interface TerminalProps {
  deviceLogger: ReturnType<typeof useLogger>
  fnLogger: ReturnType<typeof useLogger>
}

export function Terminal({ deviceLogger, fnLogger }: TerminalProps) {
  const [tab, setTab] = useState<'device' | 'functions'>('device')
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const isDragging = useRef(false)
  const startY = useRef(0)
  const startHeight = useRef(0)

  const logger = tab === 'device' ? deviceLogger : fnLogger
  const { logs, ref: logRef, clear: onClear } = logger

  // Auto-scroll to the newest line only while the user is pinned to the bottom. Scrolling
  // up to read an event unpins it, so incoming logs no longer yank the view down.
  const pinnedToBottom = useRef(true)

  const handleScroll = useCallback((e: React.UIEvent<HTMLPreElement>) => {
    const el = e.currentTarget
    pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }, [])

  useEffect(() => {
    if (pinnedToBottom.current && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs, tab, logRef])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true
      startY.current = e.clientY
      startHeight.current = height
      document.body.style.cursor = 'ns-resize'
      document.body.style.userSelect = 'none'
    },
    [height]
  )

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = startY.current - e.clientY
      const maxHeight = window.innerHeight * 0.5
      const newHeight = Math.min(maxHeight, Math.max(MIN_HEIGHT, startHeight.current + delta))
      setHeight(newHeight)
    }

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  return (
    <div className="terminal" style={{ height }}>
      <div className="terminal-resize-handle" onMouseDown={handleMouseDown} />
      <div className="terminal-header">
        <div className="terminal-tabs">
          <button
            className={`tab${tab === 'device' ? ' tab--active' : ''}`}
            onClick={() => {
              pinnedToBottom.current = true
              setTab('device')
            }}
          >
            Device
          </button>
          <button
            className={`tab${tab === 'functions' ? ' tab--active' : ''}`}
            onClick={() => {
              pinnedToBottom.current = true
              setTab('functions')
            }}
          >
            Functions
          </button>
        </div>
        <div className="terminal-actions">
          <button
            className="terminal-icon-btn"
            onClick={() => {
              void rpc.request.openLogsFolder().catch(() => {})
            }}
            title="Open the folder containing this app's log files"
          >
            <FolderOpen size={14} />
          </button>
          <button
            className="terminal-icon-btn"
            onClick={() => {
              pinnedToBottom.current = true
              onClear()
            }}
            title="Clear terminal"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <pre className="terminal-log" ref={logRef as React.RefObject<HTMLPreElement>} onScroll={handleScroll}>
        {logs.length === 0
          ? tab === 'device'
            ? 'Ready. Connect to a device and upload a schema.'
            : 'No function logs yet.'
          : logs.join('\n')}
      </pre>
    </div>
  )
}
