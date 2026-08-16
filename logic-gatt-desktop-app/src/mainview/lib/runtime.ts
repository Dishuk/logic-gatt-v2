/**
 * Runtime connection manager.
 * Listens for BLE events from the transport connection and runs matching scenario pipelines.
 */

import { TriggerKind, StepKind, type Schema, type Scenario, type UserFunction, type UserVariable } from '../types'
import type { TransportConnection } from './transport/types'
import { executeFunction } from './executor'

type Log = (msg: string) => void

function hexDump(data: Uint8Array): string {
  return Array.from(data)
    .map(b => b.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ')
}

interface RuntimeDeps {
  connection: TransportConnection
  schema: Schema
  getScenarios: () => Scenario[]
  getFunctions: () => UserFunction[]
  getVariables: () => UserVariable[]
  setVariables: (vars: UserVariable[]) => void
  log: Log
  fnLog: Log
  onDisconnect: () => void
}

export function startRuntime(deps: RuntimeDeps): {
  stop: () => void
  runScenario: (scenario: Scenario) => Promise<void>
} {
  const { connection, getScenarios, getFunctions, getVariables, setVariables, log, fnLog, onDisconnect } = deps
  let stopped = false
  const timerIntervals: ReturnType<typeof setInterval>[] = []

  /** Get all scenario names for ctx.runScenario() API */
  function getScenarioNames(): string[] {
    return getScenarios()
      .map(s => s.name)
      .filter(Boolean)
  }

  /** Find scenario by name */
  function findScenarioByName(name: string): Scenario | undefined {
    return getScenarios().find(s => s.name === name)
  }

  /** Execute scenario steps and return final buffer and pending scenarios */
  async function executeSteps(
    steps: Scenario['steps'],
    inputData: Uint8Array,
    options: {
      triggerKind?: TriggerKind
      serviceUuid?: string
      charUuid?: string
    } = {}
  ): Promise<{ buffer: Uint8Array | null; pendingScenarios: string[] }> {
    let buffer: Uint8Array | null = inputData
    const pendingScenarios: string[] = []

    const ctx = {
      log: fnLog,
      getVar: () => undefined,
      setVar: () => {},
    }

    for (const step of steps) {
      if (stopped) break

      switch (step.kind) {
        case StepKind.CallFunction: {
          const fn = getFunctions().find(f => f.name === step.functionName)
          if (!fn) {
            log(`[scenario] function "${step.functionName}" not found`)
            buffer = null
            break
          }
          const result = await executeFunction(
            fn,
            buffer ?? new Uint8Array(),
            ctx,
            getVariables(),
            setVariables,
            getScenarioNames()
          )
          buffer = result.output
          pendingScenarios.push(...result.scenarioRequests)
          if (!buffer) {
            log(`[scenario] function "${step.functionName}" returned null, stopping pipeline`)
          }
          break
        }
        case StepKind.Notify: {
          if (!buffer) {
            log(`[scenario] notify: no data to send`)
            break
          }
          try {
            await connection.notify(step.serviceUuid, step.charUuid, buffer)
            log(`[scenario] notify ${step.serviceUuid}/${step.charUuid} [${hexDump(buffer)}]`)
          } catch (err) {
            log(`[scenario] notify failed: ${err instanceof Error ? err.message : String(err)}`)
          }
          break
        }
        case StepKind.Respond: {
          if (options.triggerKind !== TriggerKind.CharRead) {
            log(`[scenario] respond: ignored (only valid for char-read triggers)`)
            break
          }
          if (!buffer) {
            log(`[scenario] respond: no data to send`)
            break
          }
          try {
            await connection.respondToRead(options.serviceUuid!, options.charUuid!, buffer)
            log(`[scenario] respond [${hexDump(buffer)}]`)
          } catch (err) {
            log(`[scenario] respond failed: ${err instanceof Error ? err.message : String(err)}`)
          }
          break
        }
      }
      if (!buffer && step.kind === StepKind.CallFunction) break
    }

    return { buffer, pendingScenarios }
  }

  /** Run pending scenarios requested via ctx.runScenario() */
  async function runPendingScenarios(names: string[], inputBuffer: Uint8Array | null) {
    for (const name of names) {
      if (stopped) break
      const scenario = findScenarioByName(name)
      if (scenario) {
        await runScenarioSteps(scenario, inputBuffer ?? new Uint8Array())
      }
    }
  }

  /** Run a scenario's steps (used by timer/startup/manual triggers) */
  async function runScenarioSteps(scenario: Scenario, inputData: Uint8Array = new Uint8Array()) {
    if (stopped) return
    log(`[scenario] "${scenario.name}" triggered`)

    const { buffer, pendingScenarios } = await executeSteps(scenario.steps, inputData)
    await runPendingScenarios(pendingScenarios, buffer)
  }

  /** Run pipeline for char-read/char-write events */
  async function runPipeline(
    scenarios: Scenario[],
    triggerKind: TriggerKind.CharWrite | TriggerKind.CharRead,
    serviceUuid: string,
    charUuid: string,
    inputData: Uint8Array
  ) {
    const matching = scenarios.filter(s => {
      if (!s.enabled) return false
      const t = s.trigger
      return t.kind === triggerKind && t.serviceUuid === serviceUuid && t.charUuid === charUuid
    })

    for (const scenario of matching) {
      if (stopped) break
      log(`[scenario] "${scenario.name}" triggered`)

      const { buffer, pendingScenarios } = await executeSteps(scenario.steps, inputData, {
        triggerKind,
        serviceUuid,
        charUuid,
      })
      await runPendingScenarios(pendingScenarios, buffer)
    }
  }

  // Subscribe to transport events
  const unsubscribe = connection.onEvent(event => {
    if (stopped) return

    switch (event.type) {
      case 'char-write':
        log(`[runtime] WRITE ${event.serviceUuid}/${event.charUuid} [${hexDump(event.data)}]`)
        runPipeline(getScenarios(), TriggerKind.CharWrite, event.serviceUuid, event.charUuid, event.data)
        break
      case 'char-read':
        log(`[runtime] READ ${event.serviceUuid}/${event.charUuid}`)
        runPipeline(getScenarios(), TriggerKind.CharRead, event.serviceUuid, event.charUuid, new Uint8Array())
        break
      case 'schema-mismatch':
        log('[runtime] WARNING: Schema mismatch! Device has different schema. Re-upload required.')
        break
      case 'disconnected':
        log(`[runtime] Disconnected${event.reason ? ': ' + event.reason : ''}`)
        cleanup()
        onDisconnect()
        break
      case 'error':
        log(`[runtime] Error: ${event.message}`)
        break
      case 'adv-started':
        log('[runtime] BLE advertising started')
        break
      case 'adv-failed':
        log(`[runtime] BLE advertising FAILED: stage=${event.stage}, error=0x${event.errorCode.toString(16)}`)
        break
    }
  })

  function cleanup() {
    if (stopped) return
    stopped = true
    unsubscribe()
    // Clear all timer intervals
    for (const interval of timerIntervals) {
      clearInterval(interval)
    }
    timerIntervals.length = 0
    log('[runtime] Stopped')
  }

  log('[runtime] Started — listening for BLE events')

  // Run startup scenarios and set up timer scenarios
  const scenarios = getScenarios()

  // Run startup triggers (once, after a short delay to let BLE settle)
  const startupScenarios = scenarios.filter(s => s.enabled && s.trigger.kind === TriggerKind.Startup)
  if (startupScenarios.length > 0) {
    setTimeout(async () => {
      for (const scenario of startupScenarios) {
        if (stopped) break
        await runScenarioSteps(scenario)
      }
    }, 500)
  }

  // Set up timer triggers
  const timerScenarios = scenarios.filter(s => s.enabled && s.trigger.kind === TriggerKind.Timer)
  for (const scenario of timerScenarios) {
    const trigger = scenario.trigger as { kind: TriggerKind.Timer; intervalMs: number; repeat: boolean }
    log(`[runtime] Timer "${scenario.name}" every ${trigger.intervalMs}ms`)

    if (trigger.repeat) {
      const interval = setInterval(() => {
        if (!stopped) runScenarioSteps(scenario)
      }, trigger.intervalMs)
      timerIntervals.push(interval)
    } else {
      // One-shot timer
      setTimeout(() => {
        if (!stopped) runScenarioSteps(scenario)
      }, trigger.intervalMs)
    }
  }

  return {
    stop: cleanup,
    runScenario: (scenario: Scenario) => runScenarioSteps(scenario),
  }
}
