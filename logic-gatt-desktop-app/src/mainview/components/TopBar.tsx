import { useState } from 'react'
import type { TransportConnection } from '../lib/transport/types'
import type { UseProject } from '../hooks/useProject'
import type { UseProjectFile } from '../hooks/useProjectFile'
import { BackendTransportModal } from './BackendTransportModal'
import { FileMenu } from './FileMenu'
import { HelpModal } from './HelpModal'
import { SettingsModal } from './SettingsModal'

export interface ExampleProject {
  name: string
  description: string
  /** Preset id the Bun main process knows it by. */
  preset: string
}

interface TopBarProps {
  transport: {
    connection: TransportConnection | null
    connectionLabel: string | null
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
  const { connection, connectionLabel, uploading, running, connect, handleStop, handleDisconnect } = transport
  const { services, projectName, isDirty } = project
  const { log } = logger
  const uploadDisabled = uploading || services.length === 0 || !connection
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
        <button onClick={() => (connection ? handleDisconnect() : setShowTransport(true))} disabled={running}>
          {connectionLabel ? `Disconnect (${connectionLabel})` : 'Connect Device'}
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

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

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
