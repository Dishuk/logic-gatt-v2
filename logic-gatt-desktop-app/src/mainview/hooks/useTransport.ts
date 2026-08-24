/**
 * Transport connection management hook.
 * Handles plugin selection, connection, upload, and runtime lifecycle.
 *
 * Uses backend plugins via WebSocket API.
 */

import { useState, useRef, useCallback } from 'react'
import type { Schema, UserFunction, UserVariable, Scenario, DeviceSettings } from '../types'
import type { TransportConnection } from '../lib/transport/types'
import { validateSchema, formatValidationErrors } from '../lib/validation'
import { startRuntime } from '../lib/runtime'
import type { SessionState } from '../lib/sessionState'

/** When live variable values go back to their authored ones. */
export interface ResetPolicy {
  onRun: boolean
  onDisconnect: boolean
}

interface UseTransportOptions {
  log: (msg: string) => void
  fnLog: (msg: string) => void
  /** Live variable values. Owned by the caller: the UI reads it, a run writes it. */
  session: SessionState
  /** Authored variables — the seed for every session. */
  getVariables: () => UserVariable[]
  resetPolicy: ResetPolicy
}

interface RuntimeRefs {
  getScenarios: () => Scenario[]
  getFunctions: () => UserFunction[]
}

interface UploadOptions {
  /** Overrides `resetPolicy.onRun`. False keeps live values across an auto-resume. */
  reseed?: boolean
}

export function useTransport({ log, fnLog, session, getVariables, resetPolicy }: UseTransportOptions) {
  const [connection, setConnection] = useState<TransportConnection | null>(null)
  const [connectionLabel, setConnectionLabel] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [running, setRunning] = useState(false)
  const runtimeRef = useRef<ReturnType<typeof startRuntime> | null>(null)

  // Read through refs: the callbacks below are memoized on `connection` and would
  // otherwise capture the policy and variables from the render that created them.
  const policyRef = useRef(resetPolicy)
  policyRef.current = resetPolicy
  const getVariablesRef = useRef(getVariables)
  getVariablesRef.current = getVariables

  const resetSessionIfPolicy = useCallback(() => {
    if (policyRef.current.onDisconnect) session.reseed(getVariablesRef.current())
  }, [session])

  // Stop the running scenario/runtime and the emulated device, but KEEP the transport
  // link so Upload & Run can re-run without reconnecting. (In the old app Stop also
  // disconnected; v2 keeps the link and leaves dropping it to `handleDisconnect`.)
  // Live variable values survive Stop so they can be inspected afterwards.
  const handleStop = useCallback(async () => {
    if (runtimeRef.current) {
      runtimeRef.current.stop()
      runtimeRef.current = null
    }
    setRunning(false)
    if (connection) {
      await connection.stopDevice()
    }
  }, [connection])

  // Fully drop the transport link (Disconnect button, or when the phone hangs up).
  const handleDisconnect = useCallback(async () => {
    if (runtimeRef.current) {
      runtimeRef.current.stop()
      runtimeRef.current = null
    }
    setRunning(false)
    if (connection) {
      await connection.disconnect()
      setConnection(null)
      setConnectionLabel(null)
    }
    resetSessionIfPolicy()
  }, [connection, resetSessionIfPolicy])

  const connect = useCallback((conn: TransportConnection, label: string) => {
    setConnection(conn)
    setConnectionLabel(label)
  }, [])

  async function handleUpload(
    schema: Schema,
    deviceSettings: DeviceSettings,
    refs: RuntimeRefs,
    options: UploadOptions = {}
  ) {
    if (!connection) {
      log('No connection. Select a device first.')
      return
    }

    const variables = getVariablesRef.current()

    // Validate schema before upload
    const validation = validateSchema(schema, deviceSettings, refs.getFunctions(), variables, refs.getScenarios())
    if (!validation.valid) {
      log('Validation failed:')
      log(formatValidationErrors(validation))
      return
    }

    // Stop any existing runtime
    if (runtimeRef.current) {
      runtimeRef.current.stop()
      runtimeRef.current = null
      setRunning(false)
    }

    // A fresh run starts from the authored values; `sync` (definitions only) is what
    // keeps a resumed session — a phone that dropped and dialled back in — intact.
    if (options.reseed ?? policyRef.current.onRun) session.reseed(variables)
    else session.sync(variables)

    setUploading(true)
    try {
      await connection.uploadSchema(schema, deviceSettings, log)

      // Start runtime on the same connection
      const rt = startRuntime({
        connection,
        schema,
        getScenarios: refs.getScenarios,
        getFunctions: refs.getFunctions,
        session,
        log,
        fnLog,
        onDisconnect: async () => {
          runtimeRef.current = null
          setRunning(false)
          setConnection(null)
          resetSessionIfPolicy()
        },
      })
      runtimeRef.current = rt
      setRunning(true)
    } catch (err) {
      log(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
      await connection.disconnect()
      setConnection(null)
    } finally {
      setUploading(false)
    }
  }

  const runScenario = useCallback(async (scenario: Scenario) => {
    if (runtimeRef.current) {
      await runtimeRef.current.runScenario(scenario)
    }
  }, [])

  return {
    connection,
    connectionLabel,
    uploading,
    running,

    // Connection methods
    connect,
    handleUpload,
    handleStop,
    handleDisconnect,
    runScenario,
  }
}
