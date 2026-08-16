import { useState, useEffect, useRef, useCallback } from 'react'
import { useLogger } from './hooks/useLogger'
import { useProject } from './hooks/useProject'
import { useTransport } from './hooks/useTransport'
import type { ExampleProject } from './components/TopBar'
import { TopBar } from './components/TopBar'
import { ServicesPanel } from './components/ServicesPanel'
import { CodeEditorPanel } from './components/CodeEditorPanel'
import { Terminal } from './components/Terminal'
import { ErrorBoundary } from './components/ErrorBoundary'
import { importProject } from './lib/schemaIO'
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

  // Project state
  const project = useProject(deviceLogger.log)

  // Transport connection
  const transport = useTransport({ log: deviceLogger.log, fnLog: fnLogger.log })

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

  // Mirror the transport asymmetry: the phone initiates, but either side can drop.
  // If the active executor (phone) hangs up, fully end the desktop session (drop the
  // link, not just Stop) so the UI returns to "Connect Device" rather than pointing
  // at a dead peer.
  const { port, handleDisconnect } = transport
  useEffect(() => {
    const off = onConnectionEvent((e) => {
      if (e.type === 'peer-disconnected' && port) {
        deviceLogger.log('Phone disconnected — ending session')
        handleDisconnect()
      }
    })
    return off
  }, [port, handleDisconnect, deviceLogger.log])

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

  const handleUpload = () => {
    transport.handleUpload(project.services, project.deviceSettings, {
      getScenarios: () => project.scenariosRef.current,
      getFunctions: () => project.functionsRef.current,
      getVariables: () => project.variablesRef.current,
      setVariables: project.setVariables,
    })
  }

  const handleLoadExample = async (example: ExampleProject) => {
    try {
      // example.data is now the preset name (string)
      const presetName = example.data as string
      const json = await rpc.request.getPreset({ name: presetName })
      const data = importProject(JSON.stringify(json))
      project.setDeviceSettings(data.deviceSettings)
      project.setServices(data.services)
      project.setFunctions(data.functions)
      project.setVariables(data.variables)
      project.setTests(data.tests)
      project.setScenarios(data.scenarios)
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
          onUpload={handleUpload}
          examples={examples}
          onLoadExample={handleLoadExample}
        />
        <div
          className="panels"
          ref={panelsRef}
          style={{ '--panel-left-basis': `${leftWidthPct}%` } as React.CSSProperties}
        >
          <ServicesPanel project={project} />
          <div className="panel-resize-handle" onMouseDown={startPanelResize} />
          <CodeEditorPanel project={project} fnLogger={fnLogger} transport={transport} />
        </div>
        <Terminal deviceLogger={deviceLogger} fnLogger={fnLogger} />
      </div>
    </ErrorBoundary>
  )
}
