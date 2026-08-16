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

interface UseTransportOptions {
  log: (msg: string) => void
  fnLog: (msg: string) => void
}

interface RuntimeRefs {
  getScenarios: () => Scenario[]
  getFunctions: () => UserFunction[]
  getVariables: () => UserVariable[]
  setVariables: (vars: UserVariable[]) => void
}

export function useTransport({ log, fnLog }: UseTransportOptions) {
  const [connection, setConnection] = useState<TransportConnection | null>(null)
  const [connectionLabel, setConnectionLabel] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [running, setRunning] = useState(false)
  const runtimeRef = useRef<ReturnType<typeof startRuntime> | null>(null)

  // Stop the running scenario/runtime and the emulated device, but KEEP the transport
  // link so Upload & Run can re-run without reconnecting. (In the old app Stop also
  // disconnected; v2 keeps the link and leaves dropping it to `handleDisconnect`.)
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
  }, [connection])

  const connect = useCallback((conn: TransportConnection, label: string) => {
    setConnection(conn)
    setConnectionLabel(label)
  }, [])

  async function handleUpload(schema: Schema, deviceSettings: DeviceSettings, refs: RuntimeRefs) {
    if (!connection) {
      log('No connection. Select a device first.')
      return
    }

    // Validate schema before upload
    const validation = validateSchema(
      schema,
      deviceSettings,
      refs.getFunctions(),
      refs.getVariables(),
      refs.getScenarios()
    )
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

    setUploading(true)
    try {
      await connection.uploadSchema(schema, deviceSettings, log)

      // Start runtime on the same connection
      const rt = startRuntime({
        connection,
        schema,
        getScenarios: refs.getScenarios,
        getFunctions: refs.getFunctions,
        getVariables: refs.getVariables,
        setVariables: refs.setVariables,
        log,
        fnLog,
        onDisconnect: async () => {
          runtimeRef.current = null
          setRunning(false)
          setConnection(null)
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
    // Expose connection presence as "port" for backwards compatibility with UI
    port: connection,
    portName: connectionLabel,
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
