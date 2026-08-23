import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useLogger } from './hooks/useLogger'
import { useProject } from './hooks/useProject'
import { useSettings } from './hooks/useSettings'
import { useTransport } from './hooks/useTransport'
import type { ExampleProject } from './components/TopBar'
import { TopBar } from './components/TopBar'
import { DevicePanel } from './components/DevicePanel'
import { CodeEditorPanel } from './components/CodeEditorPanel'
import { Terminal } from './components/Terminal'
import { ErrorBoundary } from './components/ErrorBoundary'
import { importProject } from './lib/schemaIO'
import { createSessionState } from './lib/sessionState'
import { rpc, onConnectionEvent } from './lib/rpc'

// Preset metadata - maps API preset names to display info
const PRESET_INFO: Record<string, { name: string; description: string }> = {
  default: {
    name: 'Default (Echo)',
    description: 'Simple echo service with reader/writer examples',
  },
  'heart-rate-monitor': {
    name: 'Heart Rate Monitor',
    description: 'BLE Heart Rate Profile (0x180D) with measurement, control point, and battery service',
  },
}

export function App() {
  // Logging
  const deviceLogger = useLogger()
  const fnLogger = useLogger()

  const { settings } = useSettings()

  // Live variable values. The project holds the authored ones and is never written to
  // by a run; this store is what scenarios read and write (see lib/sessionState).
  const session = useMemo(() => createSessionState(), [])

  // Project state. Loading another project starts session state over — same-named
  // variables from the old one must not carry their values across.
  const project = useProject(deviceLogger.log, data => session.reseed(data.variables))

  // Transport connection
  const resetPolicy = useMemo(
    () => ({ onRun: settings.resetVariablesOnRun, onDisconnect: settings.resetVariablesOnDisconnect }),
    [settings.resetVariablesOnRun, settings.resetVariablesOnDisconnect]
  )
  const transport = useTransport({
    log: deviceLogger.log,
    fnLog: fnLogger.log,
    session,
    getVariables: () => project.variablesRef.current,
    resetPolicy,
  })

  // Definition edits (added, removed, renamed, retyped, reordered) reach the session
  // without disturbing values a run has already produced.
  useEffect(() => {
    session.sync(project.variables)
  }, [session, project.variables])

  // The webview is created at the OUTER window size on Windows and only snaps to the client
  // area on a real resize, so ask Bun to nudge the window now that we've mounted.
  useEffect(() => {
    void rpc.request.fitWindow().catch(() => {})
  }, [])

  // Example presets from backend
  const [examples, setExamples] = useState<ExampleProject[]>([])

  // Load preset list from the Bun main process
  useEffect(() => {
    async function loadPresetList() {
      try {
        const presets = await rpc.request.getPresets()
        const exampleList: ExampleProject[] = presets.map((name: string) => {
          const info = PRESET_INFO[name] ?? { name, description: '' }
          return { name: info.name, description: info.description, data: name }
        })
        setExamples(exampleList)
      } catch {
        // Ignore errors, examples dropdown will just be empty
      }
    }
    loadPresetList()
  }, [])

  // Resizable split between the Services (left) and Code Editor (right) panels.
  const [leftWidthPct, setLeftWidthPct] = useState(50)
  const panelsRef = useRef<HTMLDivElement>(null)
  const startPanelResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const panels = panelsRef.current
    if (!panels) return
    const onMove = (ev: MouseEvent) => {
      const rect = panels.getBoundingClientRect()
      const pct = ((ev.clientX - rect.left) / rect.width) * 100
      setLeftWidthPct(Math.min(80, Math.max(20, pct)))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  const handleUpload = (options?: { reseed?: boolean }) => {
    transport.handleUpload(
      project.services,
      project.deviceSettings,
      {
        getScenarios: () => project.scenariosRef.current,
        getFunctions: () => project.functionsRef.current,
      },
      options
    )
  }

  // The phone can drop out (sleep, Wi-Fi blip) and dial back in. Keep the Wi-Fi server
  // listening across the gap — stop the device, then resume it when the phone returns —
  // instead of dropping the link, which would leave nothing to reconnect to.
  const { port, running, handleStop } = transport
  const resumeOnReconnect = useRef(false)
  const uploadRef = useRef(handleUpload)
  useEffect(() => {
    uploadRef.current = handleUpload
  })
  useEffect(() => {
    const off = onConnectionEvent(e => {
      if (!port) return
      if (e.type === 'peer-disconnected') {
        resumeOnReconnect.current = running
        deviceLogger.log('Phone disconnected — link kept open, waiting for it to reconnect')
        void handleStop()
      } else if (e.type === 'peer-connected' && resumeOnReconnect.current) {
        resumeOnReconnect.current = false
        deviceLogger.log('Phone reconnected — restarting the device')
        // Resuming the same session: a dropped Wi-Fi link must not reset variables.
        uploadRef.current({ reseed: false })
      }
    })
    return off
  }, [port, running, handleStop, deviceLogger.log])

  const handleLoadExample = async (example: ExampleProject) => {
    try {
      // example.data is now the preset name (string)
      const presetName = example.data as string
      const json = await rpc.request.getPreset({ name: presetName })
      project.loadProject(importProject(JSON.stringify(json)))
      deviceLogger.log(`Loaded example: ${example.name}`)
    } catch (err) {
      deviceLogger.log(`Failed to load example: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <ErrorBoundary>
      <div className="layout">
        <TopBar
          transport={transport}
          project={project}
          logger={deviceLogger}
          onUpload={() => handleUpload()}
          examples={examples}
          onLoadExample={handleLoadExample}
        />
        <div
          className="panels"
          ref={panelsRef}
          style={{ '--panel-left-basis': `${leftWidthPct}%` } as React.CSSProperties}
        >
          <DevicePanel project={project} session={session} running={running} />
          <div className="panel-resize-handle" onMouseDown={startPanelResize} />
          <CodeEditorPanel project={project} fnLogger={fnLogger} transport={transport} />
        </div>
        <Terminal deviceLogger={deviceLogger} fnLogger={fnLogger} />
      </div>
    </ErrorBoundary>
  )
}
