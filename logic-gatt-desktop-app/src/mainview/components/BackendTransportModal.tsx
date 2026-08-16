/**
 * Backend Plugin Selection Modal
 *
 * Shows available backend plugins and handles connection flow.
 * Plugin UI is auto-generated from plugin action UI metadata.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { TransportConnection, BackendPluginInfo, PluginAction } from '../lib/transport/types'
import { fetchBackendPlugins, selectPlugin, callPluginAction } from '../lib/transport/plugin-loader'
import { ElectrobunConnection } from '../lib/transport/electrobun-connection'
import { validateSelectOptions, validateStatusResponse, type SelectOption, type StatusResponse } from '../lib/validate'
import { rpc, onConnectionEvent } from '../lib/rpc'
import { ConnectionPanel } from './ConnectionPanel'

interface BackendTransportModalProps {
  onConnect: (connection: TransportConnection, label: string) => void
  onClose: () => void
  log: (msg: string) => void
}

/** Icon component that renders based on plugin icon name */
function PluginIcon({ icon, color }: { icon?: string; color?: string }) {
  const style = { color: color || 'currentColor' }

  switch (icon) {
    case 'usb':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={style}>
          <path d="M12 2v6m0 0l-2-2m2 2l2-2" />
          <circle cx="12" cy="12" r="2" />
          <path d="M12 14v4m-3-2h6" />
          <path d="M6 18a2 2 0 100-4 2 2 0 000 4zm12 0a2 2 0 100-4 2 2 0 000 4z" />
          <path d="M6 16v-4a2 2 0 012-2h1m7 0h1a2 2 0 012 2v4" />
        </svg>
      )
    case 'bluetooth':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={style}>
          <path d="M6.5 6.5l11 11L12 23V1l5.5 5.5-11 11" />
        </svg>
      )
    default:
      return <span style={{ fontSize: '1.5rem' }}>🔌</span>
  }
}

// ============================================================================
// Dynamic Form Field Components
// ============================================================================

interface SelectFieldProps {
  fieldId: string
  label: string
  pluginId: string
  sourceAction: PluginAction
  targetAction?: PluginAction
  selectedValue: string | null
  onSelect: (value: string) => void
  log: (msg: string) => void
}

function SelectField({
  fieldId,
  label,
  pluginId,
  sourceAction,
  targetAction,
  selectedValue,
  onSelect,
  log,
}: SelectFieldProps) {
  const [options, setOptions] = useState<SelectOption[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    callPluginAction(pluginId, sourceAction.method, sourceAction.path)
      .then(result => {
        const validated = validateSelectOptions(result)
        if (validated.success && validated.data) {
          setOptions(validated.data)
        } else {
          log(`Invalid options response: ${validated.error}`)
          setOptions([])
        }
      })
      .catch(err => {
        log(`Failed to load options: ${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => setLoading(false))
  }, [pluginId, sourceAction, log])

  const handleSelect = async (value: string) => {
    if (targetAction) {
      try {
        await callPluginAction(pluginId, targetAction.method, targetAction.path, { value })
        onSelect(value)
        log(`Selected: ${value}`)
      } catch (err) {
        log(`Selection failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    } else {
      onSelect(value)
    }
  }

  return (
    <div className="port-selection" data-field-id={fieldId}>
      <h4>{label}</h4>
      {loading ? (
        <p className="no-ports">Loading...</p>
      ) : options.length === 0 ? (
        <p className="no-ports">No options available</p>
      ) : (
        <div className="port-list">
          {options.map(opt => (
            <button
              key={opt.value}
              className={`port-item ${selectedValue === opt.value ? 'selected' : ''}`}
              onClick={() => handleSelect(opt.value)}
            >
              <span className="port-path">{opt.label}</span>
              {opt.description && <span className="port-manufacturer">{opt.description}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface StatusFieldProps {
  fieldId: string
  label: string
  pluginId: string
  statusAction: PluginAction
  startAction?: PluginAction
  stopAction?: PluginAction
  refreshMs?: number
  log: (msg: string) => void
}

function StatusField({
  fieldId,
  label,
  pluginId,
  statusAction,
  startAction,
  stopAction,
  refreshMs,
  log,
}: StatusFieldProps) {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [loading, setLoading] = useState<string | null>(null)

  const fetchStatus = useCallback(() => {
    callPluginAction(pluginId, statusAction.method, statusAction.path)
      .then(result => {
        const validated = validateStatusResponse(result)
        if (validated.success && validated.data) {
          setStatus(validated.data)
        } else {
          setStatus(null)
        }
      })
      .catch(() => setStatus(null))
  }, [pluginId, statusAction])

  useEffect(() => {
    fetchStatus()
    if (refreshMs && refreshMs > 0) {
      const interval = setInterval(fetchStatus, refreshMs)
      return () => clearInterval(interval)
    }
  }, [fetchStatus, refreshMs])

  const handleStart = async () => {
    if (!startAction) return
    setLoading('start')
    try {
      await callPluginAction(pluginId, startAction.method, startAction.path)
      log('Backend started')
      fetchStatus()
    } catch (err) {
      log(`Failed to start: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(null)
    }
  }

  const handleStop = async () => {
    if (!stopAction) return
    setLoading('stop')
    try {
      await callPluginAction(pluginId, stopAction.method, stopAction.path)
      log('Backend stopped')
      setStatus({ running: false })
    } catch (err) {
      log(`Failed to stop: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="backend-controls" data-field-id={fieldId}>
      <h4>{label}</h4>
      <div className="backend-status">
        <span className={`status-indicator ${status?.running ? 'running' : 'stopped'}`} />
        <span>{status?.running ? 'Running' : 'Stopped'}</span>
        {status?.wsConnected && <span className="ws-connected">(WebSocket connected)</span>}
      </div>
      <div className="backend-actions">
        {!status?.running && startAction && (
          <button onClick={handleStart} disabled={loading !== null} className="start-backend-button">
            {loading === 'start' ? 'Starting...' : startAction.label}
          </button>
        )}
        {status?.running && stopAction && (
          <button onClick={handleStop} disabled={loading !== null} className="stop-backend-button">
            {loading === 'stop' ? 'Stopping...' : stopAction.label}
          </button>
        )}
      </div>
      {startAction?.description && <p className="backend-note">{startAction.description}</p>}
    </div>
  )
}

// ============================================================================
// Plugin Connect UI (Auto-generated from actions)
// ============================================================================

interface FieldGroup {
  fieldId: string
  label: string
  type: 'select' | 'status'
  sourceAction?: PluginAction
  targetAction?: PluginAction
  statusAction?: PluginAction
  startAction?: PluginAction
  stopAction?: PluginAction
  refreshMs?: number
  requiredForConnect?: boolean
}

function groupActionsByField(actions: PluginAction[]): FieldGroup[] {
  const groups = new Map<string, FieldGroup>()

  for (const action of actions) {
    if (!action.ui || action.ui.display === 'hidden') continue

    const fieldId = action.ui.fieldId || action.path
    let group = groups.get(fieldId)

    if (!group) {
      group = {
        fieldId,
        label: action.ui.fieldLabel || action.label,
        type: action.ui.display.startsWith('status') ? 'status' : 'select',
        requiredForConnect: action.ui.requiredForConnect,
      }
      groups.set(fieldId, group)
    }

    switch (action.ui.display) {
      case 'select-source':
        group.sourceAction = action
        group.label = action.ui.fieldLabel || group.label
        if (action.ui.requiredForConnect) group.requiredForConnect = true
        break
      case 'select-target':
        group.targetAction = action
        break
      case 'status':
        group.statusAction = action
        group.refreshMs = action.ui.refreshMs
        group.label = action.ui.fieldLabel || group.label
        break
      case 'status-start':
        group.startAction = action
        break
      case 'status-stop':
        group.stopAction = action
        break
    }
  }

  return Array.from(groups.values())
}

function PluginConnectUI({
  plugin,
  onConnect,
  onCancel,
  log,
}: {
  plugin: BackendPluginInfo
  onConnect: (connection: TransportConnection, label: string) => void
  onCancel: () => void
  log: (msg: string) => void
}) {
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedValues, setSelectedValues] = useState<Record<string, string>>({})

  const fieldGroups = groupActionsByField(plugin.actions)

  const handleSelect = (fieldId: string, value: string) => {
    setSelectedValues(prev => ({ ...prev, [fieldId]: value }))
  }

  const handleConnect = async () => {
    setLoading('connect')
    setError(null)
    try {
      await selectPlugin(plugin.id)
      const connection = new ElectrobunConnection()
      await connection.connect()
      // Initiate modules open their device link here (mobile is await-peer and never
      // reaches this path). Routed to the active module's connect() in the host.
      await rpc.request.connect()
      onConnect(connection, plugin.name)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      log(`Connection failed: ${msg}`)
    } finally {
      setLoading(null)
    }
  }

  // Check if all required fields are satisfied
  const isConnectDisabled = () => {
    if (loading !== null) return true
    for (const group of fieldGroups) {
      if (group.requiredForConnect && group.type === 'select') {
        if (!selectedValues[group.fieldId]) return true
      }
    }
    return false
  }

  return (
    <div className="plugin-connect-ui">
      {error && <div className="error-message">{error}</div>}

      {/* Render dynamic form fields */}
      {fieldGroups.map(group => {
        if (group.type === 'select' && group.sourceAction) {
          return (
            <SelectField
              key={group.fieldId}
              fieldId={group.fieldId}
              label={group.label}
              pluginId={plugin.id}
              sourceAction={group.sourceAction}
              targetAction={group.targetAction}
              selectedValue={selectedValues[group.fieldId] || null}
              onSelect={value => handleSelect(group.fieldId, value)}
              log={log}
            />
          )
        }

        if (group.type === 'status' && group.statusAction) {
          return (
            <StatusField
              key={group.fieldId}
              fieldId={group.fieldId}
              label={group.label}
              pluginId={plugin.id}
              statusAction={group.statusAction}
              startAction={group.startAction}
              stopAction={group.stopAction}
              refreshMs={group.refreshMs}
              log={log}
            />
          )
        }

        return null
      })}

      {/* Connect/Cancel buttons */}
      <div className="connect-actions">
        <button className="cancel-button" onClick={onCancel} disabled={loading !== null}>
          Cancel
        </button>
        <button className="connect-button" onClick={handleConnect} disabled={isConnectDisabled()}>
          {loading === 'connect' ? 'Connecting...' : 'Connect'}
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// Await-peer Connect UI (mobile module: desktop is the server, phone dials in)
// ============================================================================

/**
 * Connect UI for `await-peer` modules. The desktop is the WebSocket server, so it
 * cannot initiate — it shows the QR and *waits*. When the phone dials in (a live
 * `peer-connected`, or one that was already connected when the modal opened) the
 * desktop adopts it automatically and hands the connection up. No Connect button.
 */
function MobileConnectUI({
  module,
  onConnect,
  log,
}: {
  module: BackendPluginInfo
  onConnect: (connection: TransportConnection, label: string) => void
  log: (msg: string) => void
}) {
  const adoptedRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    const adopt = async (peerId: string) => {
      if (adoptedRef.current || cancelled) return
      adoptedRef.current = true
      try {
        const connection = new ElectrobunConnection()
        await connection.connect()
        if (cancelled) {
          await connection.disconnect()
          return
        }
        log(`Phone connected (${peerId}) — adopted`)
        onConnect(connection, module.name)
      } catch (err) {
        adoptedRef.current = false
        log(`Adopt failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Selecting the mobile module is what actually starts the desktop's Wi-Fi server
    // + QR/mDNS — only then can a phone dial in. After it's up, adopt a peer that was
    // already connected (e.g. reconnect), and keep listening for a fresh one.
    void selectPlugin(module.id)
      .then(() => rpc.request.getConnectionInfo())
      .then((info) => {
        if (info.peerId) void adopt(info.peerId)
      })
      .catch(() => {})

    const off = onConnectionEvent((e) => {
      if (e.type === 'peer-connected') void adopt(e.peerId)
    })

    return () => {
      cancelled = true
      off()
      // Backed out of the QR before any phone connected → stop the server so the
      // QR/mDNS don't linger and nothing can connect while it isn't in use.
      if (!adoptedRef.current) {
        void rpc.request.disconnect().catch(() => {})
      }
    }
  }, [module, onConnect, log])

  return (
    <div className="plugin-connect-ui">
      <ConnectionPanel />
      <p className="backend-note">
        Scan the QR with the LogicGATT phone app (or let it auto-discover on Wi-Fi). The
        phone connects and this desktop adopts it automatically — nothing to press here.
      </p>
    </div>
  )
}

// ============================================================================
// Main Modal Component
// ============================================================================

export function BackendTransportModal({ onConnect, onClose, log }: BackendTransportModalProps) {
  const [plugins, setPlugins] = useState<BackendPluginInfo[]>([])
  const [selectedPlugin, setSelectedPlugin] = useState<BackendPluginInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchBackendPlugins()
      .then(setPlugins)
      .finally(() => setLoading(false))
  }, [])

  const handleConnect = (connection: TransportConnection, label: string) => {
    onConnect(connection, label)
    onClose()
  }

  // Default connection way first (defensive — the host already orders it first).
  const orderedPlugins = [...plugins].sort(
    (a, b) => Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault)),
  )

  // Direction is per-module: `await-peer` (mobile) shows a QR and adopts the phone;
  // everything else uses the metadata-driven action form + an explicit Connect.
  const renderConnectUI = (module: BackendPluginInfo) =>
    module.connectKind === 'await-peer' ? (
      <MobileConnectUI module={module} onConnect={handleConnect} log={log} />
    ) : (
      <PluginConnectUI
        plugin={module}
        onConnect={handleConnect}
        onCancel={() => setSelectedPlugin(null)}
        log={log}
      />
    )

  return (
    <div className="transport-overlay" onClick={onClose}>
      <div className="transport-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            {selectedPlugin ? (
              <>
                <button className="back-button" onClick={() => setSelectedPlugin(null)}>
                  &larr;
                </button>
                {selectedPlugin.name}
              </>
            ) : (
              'Select Transport'
            )}
          </h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="transport-modal-body">
          {loading ? (
            <div className="loading">Loading modules...</div>
          ) : selectedPlugin ? (
            // A connection way was picked — show its connect UI (QR for the mobile
            // module, metadata form for hardware modules).
            renderConnectUI(selectedPlugin)
          ) : plugins.length === 0 ? (
            <div className="no-plugins">No modules available. Start the backend server.</div>
          ) : (
            // Always the first step: choose a connection way (matches the old app).
            // The list is shown even for a single module — selecting a module is what
            // reveals its QR / starts its transport, never done implicitly.
            <div className="plugin-list">
              {orderedPlugins.map(plugin => (
                <button
                  key={plugin.id}
                  className={`plugin-card ${!plugin.isAvailable ? 'unavailable' : ''}`}
                  style={{ borderLeftColor: plugin.color, borderLeftWidth: '3px' }}
                  onClick={() => setSelectedPlugin(plugin)}
                  disabled={!plugin.isAvailable}
                >
                  <div className="plugin-icon">
                    <PluginIcon icon={plugin.icon} color={plugin.color} />
                  </div>
                  <div className="plugin-info">
                    <div className="plugin-name">
                      {plugin.name}
                      {plugin.isDefault && (
                        <span
                          style={{
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            color: plugin.color || '#34d399',
                            border: `1px solid ${plugin.color || '#34d399'}`,
                            borderRadius: 4,
                            padding: '1px 6px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Default
                        </span>
                      )}
                    </div>
                    <div className="plugin-description">{plugin.description}</div>
                    {!plugin.isAvailable && <div className="plugin-unavailable">Not available</div>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
