import { useState } from 'react'
import type { TransportConnection } from '../lib/transport/types'
import type { UseProject } from '../hooks/useProject'
import type { UseProjectFile } from '../hooks/useProjectFile'
import { BackendTransportModal } from './BackendTransportModal'
import { FileMenu } from './FileMenu'
import { SettingsModal } from './SettingsModal'

export interface ExampleProject {
  name: string
  description: string
  /** Preset id the Bun main process knows it by. */
  preset: string
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
  project: UseProject
  files: UseProjectFile
  logger: { log: (msg: string) => void }
  onUpload: () => void
  examples?: ExampleProject[]
}

export function TopBar({ transport, project, files, logger, onUpload, examples = [] }: TopBarProps) {
  const { port, portName, uploading, running, connect, handleStop, handleDisconnect } = transport
  const { services, projectName, isDirty } = project
  const { log } = logger
  const uploadDisabled = uploading || services.length === 0 || !port
  const [showHelp, setShowHelp] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showTransport, setShowTransport] = useState(false)

  return (
    <div className="top-bar">
      <div className="menubar">
        <FileMenu files={files} saveDisabled={!isDirty && project.currentPath !== null} examples={examples} />
        <button className="menubar-item" onClick={() => setShowSettings(true)}>
          Settings
        </button>
        <button className="menubar-item" onClick={() => setShowHelp(true)}>
          Help
        </button>
      </div>
      <div className="project-name" title={project.currentPath ?? 'Not saved to a file yet'}>
        {projectName}
        {isDirty && (
          <span className="project-dirty" aria-label="Unsaved changes">
            •
          </span>
        )}
      </div>
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
                  <li>
                    Variables hold live state: <code>ctx.setVar()</code> overwrites the value shown in the
                    <em> Variables</em> tab, and Stop does not restore it — re-enter a value there to reset it
                  </li>
                  <li>Use Tags on services/characteristics for easier identification in scenarios</li>
                  <li>
                    Save writes the whole project (services, functions, variables, tests, scenarios) to one JSON
                    file. Upload &amp; Run never touches it, so testing against a device leaves the file alone
                  </li>
                  <li>
                    Closing the window does not prompt about unsaved changes : save before quitting
                  </li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      )}

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

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
