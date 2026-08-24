/**
 * Left panel: the device, in two tabs.
 *
 *   Schema — what the device IS (services, characteristics, advertising).
 *   State  — what the running session is DOING with it.
 *
 * Both stay mounted so switching keeps scroll position and in-progress edits, the same
 * arrangement the right panel uses.
 */

import { useEffect, useRef, useState } from 'react'
import type { SessionState } from '../lib/sessionState'
import type { DeviceSettings, Service, SetVariables, UserVariable } from '../types'
import { MAX_SERVICES } from '../lib/constants'
import { ServicesPanel } from './ServicesPanel'
import { StatePanel } from './StatePanel'

type DeviceTab = 'schema' | 'state'

interface DevicePanelProps {
  project: {
    deviceSettings: DeviceSettings
    setDeviceSettings: (settings: DeviceSettings) => void
    services: Service[]
    setServices: (services: Service[]) => void
    addService: () => void
    updateService: (id: string, updated: Service) => void
    removeService: (id: string) => void
    variables: UserVariable[]
    setVariables: SetVariables
  }
  session: SessionState
  running: boolean
}

export function DevicePanel({ project, session, running }: DevicePanelProps) {
  const [tab, setTab] = useState<DeviceTab>('schema')

  // Reveal State the first time a run starts, then leave the choice alone — a panel
  // that keeps switching itself out from under an edit is worse than one that doesn't.
  const didReveal = useRef(false)
  useEffect(() => {
    if (!running || didReveal.current) return
    didReveal.current = true
    setTab('state')
  }, [running])

  return (
    <div className="panel-left">
      <div className="panel-header">
        <span>Device</span>
      </div>
      <div className="panel-content panel-content--tabs">
        <div className="editor-tabs">
          <button className={`tab${tab === 'schema' ? ' tab--active' : ''}`} onClick={() => setTab('schema')}>
            Schema ({project.services.length}/{MAX_SERVICES})
          </button>
          <button className={`tab${tab === 'state' ? ' tab--active' : ''}`} onClick={() => setTab('state')}>
            State
            {running && <span className="tab-dot" />}
          </button>
        </div>
        <div className="editor-tab-content">
          <div style={{ display: tab === 'schema' ? undefined : 'none' }}>
            <ServicesPanel project={project} />
          </div>
          <div style={{ display: tab === 'state' ? undefined : 'none' }}>
            <StatePanel
              session={session}
              variables={project.variables}
              setVariables={project.setVariables}
              running={running}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
