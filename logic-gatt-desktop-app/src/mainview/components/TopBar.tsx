import { useState } from 'react'
import type { TransportConnection } from '../lib/transport/types'
import type { Service } from '../types'
import { BackendTransportModal } from './BackendTransportModal'

export interface ExampleProject {
  name: string
  description: string
  data: unknown
}

interface TopBarProps {
  transport: {
    port: TransportConnection | null
    portName: string | null
    uploading: boolean
    running: boolean
    connect: (connection: TransportConnection, label: string) => void
    handleStop: () => void
    handleDisconnect: () => void
  }
  project: {
    services: Service[]
    handleImport: () => void
    handleExport: () => void
  }
  logger: { log: (msg: string) => void }
  onUpload: () => void
  examples?: ExampleProject[]
  onLoadExample?: (example: ExampleProject) => void
}

export function TopBar({ transport, project, logger, onUpload, examples = [], onLoadExample }: TopBarProps) {
  const { port, portName, uploading, running, connect, handleStop, handleDisconnect } = transport
  const { services, handleImport, handleExport } = project
  const { log } = logger
  const uploadDisabled = uploading || services.length === 0 || !port
  const [showHelp, setShowHelp] = useState(false)
  const [showExamples, setShowExamples] = useState(false)
  const [showTransport, setShowTransport] = useState(false)

  return (
    <div className="top-bar">
      <h1>LogicGATT</h1>
      <div className="toolbar">
        <button onClick={() => (port ? handleDisconnect() : setShowTransport(true))} disabled={running}>
          {portName ? `Disconnect (${portName})` : 'Connect Device'}
        </button>
        <button
          className={running ? 'stop-btn' : ''}
          onClick={running ? handleStop : onUpload}
          disabled={!running && uploadDisabled}
          style={{ minWidth: '7rem' }}
        >
          {running ? 'Stop' : uploading ? 'Uploading...' : 'Upload & Run'}
        </button>
        <button onClick={handleImport}>Import</button>
        <button onClick={handleExport}>Export</button>
        {examples.length > 0 && (
          <div className="examples-dropdown">
            <button className="examples-btn" onClick={() => setShowExamples(!showExamples)}>
              Examples
              <span className={`examples-arrow${showExamples ? ' examples-arrow--open' : ''}`} />
            </button>
            {showExamples && (
              <div className="examples-menu">
                {examples.map((ex, i) => (
                  <button
                    key={i}
                    className="example-item"
                    onClick={() => {
                      onLoadExample?.(ex)
                      setShowExamples(false)
                    }}
                    title={ex.description}
                  >
                    {ex.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button onClick={() => setShowHelp(true)} style={{ marginLeft: 'auto' }}>
          Help
        </button>
      </div>

      {showHelp && (
        <div className="help-overlay" onClick={() => setShowHelp(false)}>
          <div className="help-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>LogicGATT</h2>
              <button className="modal-close" onClick={() => setShowHelp(false)}>
                &times;
              </button>
            </div>
            <div className="help-content">
              <section>
                <h3>What is this?</h3>
                <p>
                  A programmable BLE device emulator. Define GATT services, write response logic, and test BLE
                  interactions with real clients.
                </p>
              </section>

              <section>
                <h3>Quick Start</h3>
                <ol>
                  <li>
                    <strong>Define Services</strong> : Add GATT services and characteristics in the left panel
                  </li>
                  <li>
                    <strong>Write Functions</strong> : Create reusable logic in the <em>Functions</em> tab
                  </li>
                  <li>
                    <strong>Create Scenarios</strong> : Wire up triggers and actions in the <em>Scenarios</em> tab
                  </li>
                  <li>
                    <strong>Connect &amp; Run</strong> : Connect to a device, click <em>Upload &amp; Run</em>
                  </li>
                </ol>
              </section>

              <section>
                <h3>Panels</h3>
                <dl>
                  <dt>Services</dt>
                  <dd>Define BLE services and characteristics with UUIDs, properties (R/W/N), and default values</dd>

                  <dt>Scenarios</dt>
                  <dd>Event-driven pipelines: trigger on char writes/reads, timers, or startup, then execute steps</dd>

                  <dt>Functions</dt>
                  <dd>
                    Write JavaScript functions that process data. Receives <code>input</code> (Uint8Array) and{' '}
                    <code>ctx</code> for state
                  </dd>

                  <dt>Variables</dt>
                  <dd>
                    Global state accessible via <code>ctx.getVar()</code> / <code>ctx.setVar()</code>
                  </dd>

                  <dt>Tests</dt>
                  <dd>Validate functions with hex input/output test cases</dd>
                </dl>
              </section>

              <section>
                <h3>Scenario Steps</h3>
                <ul>
                  <li>
                    <strong>Call Function</strong> : Execute a function, passing current data buffer
                  </li>
                  <li>
                    <strong>Notify</strong> : Send BLE notification to the connected client
                  </li>
                  <li>
                    <strong>Respond</strong> : Reply to a read/write request with current buffer
                  </li>
                </ul>
              </section>

              <section>
                <h3>Tips</h3>
                <ul>
                  <li>
                    Click <strong>API</strong> in the Code Editor header for the full function reference (
                    <code>ctx</code>, <code>reader</code>/<code>writer</code>, available globals)
                  </li>
                  <li>
                    Use <code>console.log()</code> in functions : output appears in Functions tab of the terminal
                  </li>
                  <li>Variables persist across scenario executions until device reset</li>
                  <li>Use Tags on services/characteristics for easier identification in scenarios</li>
                  <li>Import/Export saves your entire project as JSON</li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      )}

      {showTransport && (
        <BackendTransportModal
          onConnect={(connection, label) => {
            connect(connection, label)
            setShowTransport(false)
          }}
          onClose={() => setShowTransport(false)}
          log={log}
        />
      )}
    </div>
  )
}
