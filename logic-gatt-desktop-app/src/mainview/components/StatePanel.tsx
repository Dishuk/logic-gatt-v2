/**
 * Live session state: what the running device is working with, as opposed to what the
 * project defines. Values here belong to the session and are never written back to the
 * project unless the user asks for it ("save as initial").
 */

import { useState, useSyncExternalStore } from 'react'
import type { SessionState, SessionVariable } from '../lib/sessionState'
import type { SetVariables, UserVariable } from '../types'
import { useSettings } from '../hooks/useSettings'
import { Card, CardHeader, CardBody } from './Card'
import { HexByteInput } from './HexByteInput'
import { ArrowUpToLine, RotateCcw } from 'lucide-react'

interface StatePanelProps {
  session: SessionState
  /** Authored variables — what a reset goes back to, and what "save as initial" writes. */
  variables: UserVariable[]
  setVariables: SetVariables
  running: boolean
}

function VariableRow({
  entry,
  editable,
  onChange,
  onRevert,
  onSaveAsInitial,
}: {
  entry: SessionVariable
  editable: boolean
  onChange: (value: string) => void
  onRevert: () => void
  onSaveAsInitial: () => void
}) {
  const dirty = entry.current !== entry.initial

  return (
    <Card className={`state-var${dirty ? ' state-var--dirty' : ''}`}>
      <CardHeader variant="code" noBorder>
        <span className="state-var-name">{entry.name}</span>
        <span className="state-var-type">{entry.type}</span>
        <span className="state-var-initial" title="Value in the project">
          {entry.initial || '—'}
        </span>
        <span className="state-var-arrow">→</span>
        {!editable ? (
          // A readout, not a disabled input: nothing is running, so there is nothing to poke.
          <span className="state-var-current">{entry.current || '—'}</span>
        ) : entry.type === 'hex' ? (
          <HexByteInput value={entry.current} onChange={onChange} placeholder="empty" />
        ) : (
          <input
            className="var-value-input"
            value={entry.current}
            onChange={e => onChange(e.target.value)}
            placeholder="empty"
          />
        )}
        {dirty && (
          <span className="state-var-actions ml-auto">
            <button className="icon-btn" onClick={onRevert} title="Back to the project value">
              <RotateCcw size={13} />
            </button>
            <button className="icon-btn" onClick={onSaveAsInitial} title="Save this value into the project">
              <ArrowUpToLine size={13} />
            </button>
          </span>
        )}
      </CardHeader>
    </Card>
  )
}

export function StatePanel({ session, variables, setVariables, running }: StatePanelProps) {
  const { settings, setSetting } = useSettings()
  const [changedOnly, setChangedOnly] = useState(false)
  useSyncExternalStore(session.subscribe, session.getVersion)

  const entries = session.list()
  const dirty = session.isDirty()
  const shown = changedOnly ? entries.filter(e => e.current !== e.initial) : entries

  function saveAsInitial(names: string[]) {
    const wanted = new Set(names)
    setVariables(prev =>
      prev.map(v => {
        if (!wanted.has(v.name)) return v
        const current = session.get(v.name)
        return current === undefined ? v : { ...v, initialValue: current }
      })
    )
  }

  return (
    <div className="state-panel">
      <div className="state-status">
        <span className={`state-badge${running ? ' state-badge--live' : ''}`}>{running ? 'Live' : 'Idle'}</span>
        <span className="hint">
          {running
            ? 'Values below are what scenarios are running against.'
            : 'Not running — showing the next start values.'}
        </span>
      </div>

      <Card>
        <CardHeader title="Variables" noBorder>
          <span className="state-header-actions ml-auto">
            <button
              className={`toggle-btn${changedOnly ? ' toggle-btn--on' : ''}`}
              aria-pressed={changedOnly}
              onClick={() => setChangedOnly(!changedOnly)}
            >
              Changed only
            </button>
            <button onClick={() => session.reseed(variables)} disabled={!dirty}>
              Reset all
            </button>
            <button onClick={() => saveAsInitial(entries.map(e => e.name))} disabled={!dirty}>
              Save all as initial
            </button>
          </span>
        </CardHeader>
        <CardBody className="state-var-list">
          {entries.length === 0 ? (
            <p className="hint">No variables defined. Add them in the Variables tab.</p>
          ) : shown.length === 0 ? (
            <p className="hint">
              Nothing has changed yet — all {entries.length} variable{entries.length === 1 ? '' : 's'} are at their
              project values.
            </p>
          ) : (
            shown.map(entry => (
              <VariableRow
                key={entry.name}
                entry={entry}
                editable={running}
                onChange={value => session.set(entry.name, value)}
                onRevert={() => session.set(entry.name, entry.initial)}
                onSaveAsInitial={() => saveAsInitial([entry.name])}
              />
            ))
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Reset" noBorder />
        <CardBody>
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={settings.resetVariablesOnRun}
              onChange={e => setSetting('resetVariablesOnRun', e.target.checked)}
            />
            Reset variables on Upload &amp; Run
          </label>
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={settings.resetVariablesOnDisconnect}
              onChange={e => setSetting('resetVariablesOnDisconnect', e.target.checked)}
            />
            Reset variables on disconnect
          </label>
        </CardBody>
      </Card>
    </div>
  )
}
