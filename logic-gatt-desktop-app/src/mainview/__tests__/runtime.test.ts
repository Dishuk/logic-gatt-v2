/**
 * Tests for the scenario engine (`lib/runtime.ts`).
 *
 * These drive the real `startRuntime` through a fake `TransportConnection`: events are
 * pushed in the way the phone pushes them, and the assertions are on what the runtime
 * sends back (notify / respondToRead) and what it logs. Only the sandbox worker is
 * mocked — user function bodies are stubbed per test so the pipeline itself is real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TriggerKind, StepKind, type Schema, type Scenario, type UserFunction } from '../types'
import type { TransportConnection, TransportEvent, TransportEventHandler } from '../lib/transport/types'
import { createSessionState } from '../lib/sessionState'
import { MAX_SCENARIO_DEPTH } from '../lib/constants'

// --- sandbox stub -----------------------------------------------------------
//
// Each test registers function bodies by name. A stub returns the output buffer and
// any scenarios the body asked for via `ctx.runScenario()`.

type FnStub = (input: Uint8Array) => { output: Uint8Array | null; scenarioRequests?: string[] }

const stubs = new Map<string, FnStub>()
/** Every function the runtime executed, in order. */
let executed: { name: string; input: number[] }[] = []

vi.mock('../lib/executor', () => ({
  executeFunction: vi.fn(async (fn: UserFunction, input: Uint8Array) => {
    executed.push({ name: fn.name, input: [...input] })
    const stub = stubs.get(fn.name)
    if (!stub) return { output: input, scenarioRequests: [] }
    const result = stub(input)
    return { output: result.output, scenarioRequests: result.scenarioRequests ?? [] }
  }),
}))

const { startRuntime } = await import('../lib/runtime')

// --- fixtures ---------------------------------------------------------------

const SVC = '0000180d-0000-1000-8000-00805f9b34fb'
const CHAR_A = '00002a37-0000-1000-8000-00805f9b34fb'
const CHAR_B = '00002a38-0000-1000-8000-00805f9b34fb'

const schema: Schema = [
  {
    id: 'svc-1',
    uuid: SVC,
    tag: 'Heart Rate',
    characteristics: [
      {
        id: 'char-a',
        uuid: CHAR_A,
        tag: 'Measurement',
        properties: { read: true, write: true, notify: true },
        defaultValue: '',
      },
      {
        id: 'char-b',
        uuid: CHAR_B,
        tag: 'Body Sensor',
        properties: { read: true, write: false, notify: false },
        defaultValue: 'AB CD',
      },
    ],
  },
]

function fn(name: string): UserFunction {
  return { id: `fn-${name}`, name, body: '' }
}

function scenario(overrides: Partial<Scenario> & Pick<Scenario, 'name' | 'trigger'>): Scenario {
  return { id: `sc-${overrides.name}`, enabled: true, steps: [], ...overrides }
}

/** Fake transport: records outbound calls, lets a test push inbound events. */
function fakeConnection() {
  const notified: { serviceUuid: string; charUuid: string; data: number[] }[] = []
  const responded: { serviceUuid: string; charUuid: string; data: number[] }[] = []
  let handler: TransportEventHandler | null = null

  const connection: TransportConnection = {
    async uploadSchema() {},
    async notify(serviceUuid, charUuid, data) {
      notified.push({ serviceUuid, charUuid, data: [...data] })
    },
    async respondToRead(serviceUuid, charUuid, data) {
      responded.push({ serviceUuid, charUuid, data: [...data] })
    },
    onEvent(h) {
      handler = h
      return () => {
        handler = null
      }
    },
    async stopDevice() {},
    async disconnect() {},
  }

  return {
    connection,
    notified,
    responded,
    emit: (event: TransportEvent) => handler?.(event),
    hasHandler: () => handler !== null,
  }
}

interface StartOptions {
  scenarios?: Scenario[]
  functions?: UserFunction[]
  onDisconnect?: () => void
}

function start(transport: ReturnType<typeof fakeConnection>, options: StartOptions = {}) {
  const logs: string[] = []
  const scenarios = options.scenarios ?? []
  // A live array so a test can edit scenarios mid-run, the way the editor does.
  const live = [...scenarios]
  const runtime = startRuntime({
    connection: transport.connection,
    schema,
    getScenarios: () => live,
    getFunctions: () => options.functions ?? [],
    session: createSessionState(),
    log: msg => logs.push(msg),
    fnLog: () => {},
    onDisconnect: options.onDisconnect ?? (() => {}),
  })
  return { runtime, logs, live }
}

/** Let every queued microtask and expired timer settle. */
async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  vi.useFakeTimers()
  stubs.clear()
  executed = []
})

afterEach(() => {
  vi.useRealTimers()
})

// --- trigger matching -------------------------------------------------------

describe('char-write triggers', () => {
  it('runs a scenario bound to the written characteristic', async () => {
    const t = fakeConnection()
    stubs.set('echo', input => ({ output: input }))
    start(t, {
      functions: [fn('echo')],
      scenarios: [
        scenario({
          name: 'On write',
          trigger: { kind: TriggerKind.CharWrite, serviceUuid: SVC, charUuid: CHAR_A },
          steps: [
            { kind: StepKind.CallFunction, functionName: 'echo' },
            { kind: StepKind.Notify, serviceUuid: SVC, charUuid: CHAR_A },
          ],
        }),
      ],
    })

    t.emit({ type: 'char-write', serviceUuid: SVC, charUuid: CHAR_A, data: new Uint8Array([1, 2, 3]) })
    await settle()

    expect(executed).toEqual([{ name: 'echo', input: [1, 2, 3] }])
    expect(t.notified).toEqual([{ serviceUuid: SVC, charUuid: CHAR_A, data: [1, 2, 3] }])
  })

  it('ignores disabled scenarios', async () => {
    const t = fakeConnection()
    start(t, {
      functions: [fn('echo')],
      scenarios: [
        scenario({
          name: 'Off',
          enabled: false,
          trigger: { kind: TriggerKind.CharWrite, serviceUuid: SVC, charUuid: CHAR_A },
          steps: [{ kind: StepKind.CallFunction, functionName: 'echo' }],
        }),
      ],
    })

    t.emit({ type: 'char-write', serviceUuid: SVC, charUuid: CHAR_A, data: new Uint8Array([1]) })
    await settle()

    expect(executed).toEqual([])
  })

  it('ignores a scenario bound to a different characteristic', async () => {
    const t = fakeConnection()
    start(t, {
      functions: [fn('echo')],
      scenarios: [
        scenario({
          name: 'Other char',
          trigger: { kind: TriggerKind.CharWrite, serviceUuid: SVC, charUuid: CHAR_B },
          steps: [{ kind: StepKind.CallFunction, functionName: 'echo' }],
        }),
      ],
    })

    t.emit({ type: 'char-write', serviceUuid: SVC, charUuid: CHAR_A, data: new Uint8Array([1]) })
    await settle()

    expect(executed).toEqual([])
  })

  it('ignores a read-triggered scenario on a write', async () => {
    const t = fakeConnection()
    start(t, {
      functions: [fn('echo')],
      scenarios: [
        scenario({
          name: 'Read only',
          trigger: { kind: TriggerKind.CharRead, serviceUuid: SVC, charUuid: CHAR_A },
          steps: [{ kind: StepKind.CallFunction, functionName: 'echo' }],
        }),
      ],
    })

    t.emit({ type: 'char-write', serviceUuid: SVC, charUuid: CHAR_A, data: new Uint8Array([1]) })
    await settle()

    expect(executed).toEqual([])
  })

  it('runs every matching scenario, in order', async () => {
    const t = fakeConnection()
    stubs.set('first', input => ({ output: input }))
    stubs.set('second', input => ({ output: input }))
    const trigger = { kind: TriggerKind.CharWrite, serviceUuid: SVC, charUuid: CHAR_A } as const
    start(t, {
      functions: [fn('first'), fn('second')],
      scenarios: [
        scenario({ name: 'A', trigger, steps: [{ kind: StepKind.CallFunction, functionName: 'first' }] }),
        scenario({ name: 'B', trigger, steps: [{ kind: StepKind.CallFunction, functionName: 'second' }] }),
      ],
    })

    t.emit({ type: 'char-write', serviceUuid: SVC, charUuid: CHAR_A, data: new Uint8Array([9]) })
    await settle()

    expect(executed.map(e => e.name)).toEqual(['first', 'second'])
  })
})

// --- step execution ---------------------------------------------------------

describe('step execution', () => {
  it('feeds each function the previous one’s output', async () => {
    const t = fakeConnection()
    stubs.set('double', input => ({ output: new Uint8Array(input.map(b => b * 2)) }))
    stubs.set('inc', input => ({ output: new Uint8Array(input.map(b => b + 1)) }))
    start(t, {
      functions: [fn('double'), fn('inc')],
      scenarios: [
        scenario({
          name: 'Chain',
          trigger: { kind: TriggerKind.CharWrite, serviceUuid: SVC, charUuid: CHAR_A },
          steps: [
            { kind: StepKind.CallFunction, functionName: 'double' },
            { kind: StepKind.CallFunction, functionName: 'inc' },
            { kind: StepKind.Notify, serviceUuid: SVC, charUuid: CHAR_A },
          ],
        }),
      ],
    })

    t.emit({ type: 'char-write', serviceUuid: SVC, charUuid: CHAR_A, data: new Uint8Array([1, 2]) })
    await settle()

    expect(executed).toEqual([
      { name: 'double', input: [1, 2] },
      { name: 'inc', input: [2, 4] },
    ])
    expect(t.notified[0].data).toEqual([3, 5])
  })

  it('stops the pipeline when a function returns null', async () => {
    const t = fakeConnection()
    stubs.set('drop', () => ({ output: null }))
    start(t, {
      functions: [fn('drop')],
      scenarios: [
        scenario({
          name: 'Dropped',
          trigger: { kind: TriggerKind.CharWrite, serviceUuid: SVC, charUuid: CHAR_A },
          steps: [
            { kind: StepKind.CallFunction, functionName: 'drop' },
            { kind: StepKind.Notify, serviceUuid: SVC, charUuid: CHAR_A },
          ],
        }),
      ],
    })

    t.emit({ type: 'char-write', serviceUuid: SVC, charUuid: CHAR_A, data: new Uint8Array([1]) })
    await settle()

    expect(t.notified).toEqual([])
  })

  it('logs and stops the pipeline for an unknown function name', async () => {
    const t = fakeConnection()
    const { logs } = start(t, {
      functions: [],
      scenarios: [
        scenario({
          name: 'Missing',
          trigger: { kind: TriggerKind.CharWrite, serviceUuid: SVC, charUuid: CHAR_A },
          steps: [
            { kind: StepKind.CallFunction, functionName: 'nope' },
            { kind: StepKind.Notify, serviceUuid: SVC, charUuid: CHAR_A },
          ],
        }),
      ],
    })

    t.emit({ type: 'char-write', serviceUuid: SVC, charUuid: CHAR_A, data: new Uint8Array([1]) })
    await settle()

    expect(logs.some(l => l.includes('"nope" not found'))).toBe(true)
    expect(t.notified).toEqual([])
  })

  it('ignores a respond step outside a char-read', async () => {
    const t = fakeConnection()
    const { logs } = start(t, {
      scenarios: [
        scenario({
          name: 'Bad respond',
          trigger: { kind: TriggerKind.CharWrite, serviceUuid: SVC, charUuid: CHAR_A },
          steps: [{ kind: StepKind.Respond }],
        }),
      ],
    })

    t.emit({ type: 'char-write', serviceUuid: SVC, charUuid: CHAR_A, data: new Uint8Array([1]) })
    await settle()

    expect(t.responded).toEqual([])
    expect(logs.some(l => l.includes('only valid for char-read'))).toBe(true)
  })
})

// --- reads ------------------------------------------------------------------

describe('char-read handling', () => {
  it('answers with the scenario’s buffer', async () => {
    const t = fakeConnection()
    stubs.set('value', () => ({ output: new Uint8Array([0x42]) }))
    start(t, {
      functions: [fn('value')],
      scenarios: [
        scenario({
          name: 'Serve',
          trigger: { kind: TriggerKind.CharRead, serviceUuid: SVC, charUuid: CHAR_A },
          steps: [{ kind: StepKind.CallFunction, functionName: 'value' }, { kind: StepKind.Respond }],
        }),
      ],
    })

    t.emit({ type: 'char-read', serviceUuid: SVC, charUuid: CHAR_A })
    await settle()

    expect(t.responded).toEqual([{ serviceUuid: SVC, charUuid: CHAR_A, data: [0x42] }])
  })

  it('falls back to the characteristic default when no scenario responds', async () => {
    const t = fakeConnection()
    start(t)

    t.emit({ type: 'char-read', serviceUuid: SVC, charUuid: CHAR_B })
    await settle()

    // CHAR_B's defaultValue is "AB CD".
    expect(t.responded).toEqual([{ serviceUuid: SVC, charUuid: CHAR_B, data: [0xab, 0xcd] }])
  })

  it('matches the default by UUID case-insensitively', async () => {
    const t = fakeConnection()
    start(t)

    t.emit({ type: 'char-read', serviceUuid: SVC.toUpperCase(), charUuid: CHAR_B.toUpperCase() })
    await settle()

    expect(t.responded[0].data).toEqual([0xab, 0xcd])
  })

  it('answers an unknown characteristic with an empty buffer rather than stalling', async () => {
    const t = fakeConnection()
    start(t)

    t.emit({ type: 'char-read', serviceUuid: SVC, charUuid: 'not-in-schema' })
    await settle()

    expect(t.responded).toEqual([{ serviceUuid: SVC, charUuid: 'not-in-schema', data: [] }])
  })

  it('does not add a default response when a scenario already responded', async () => {
    const t = fakeConnection()
    stubs.set('value', () => ({ output: new Uint8Array([1]) }))
    start(t, {
      functions: [fn('value')],
      scenarios: [
        scenario({
          name: 'Serve',
          trigger: { kind: TriggerKind.CharRead, serviceUuid: SVC, charUuid: CHAR_B },
          steps: [{ kind: StepKind.CallFunction, functionName: 'value' }, { kind: StepKind.Respond }],
        }),
      ],
    })

    t.emit({ type: 'char-read', serviceUuid: SVC, charUuid: CHAR_B })
    await settle()

    expect(t.responded).toHaveLength(1)
    expect(t.responded[0].data).toEqual([1])
  })
})

// --- ctx.runScenario() chaining ---------------------------------------------

describe('ctx.runScenario() chaining', () => {
  it('runs a scenario requested by a function', async () => {
    const t = fakeConnection()
    stubs.set('caller', input => ({ output: input, scenarioRequests: ['Callee'] }))
    stubs.set('callee', input => ({ output: input }))
    start(t, {
      functions: [fn('caller'), fn('callee')],
      scenarios: [
        scenario({
          name: 'Caller',
          trigger: { kind: TriggerKind.CharWrite, serviceUuid: SVC, charUuid: CHAR_A },
          steps: [{ kind: StepKind.CallFunction, functionName: 'caller' }],
        }),
        scenario({
          name: 'Callee',
          trigger: { kind: TriggerKind.Manual },
          steps: [{ kind: StepKind.CallFunction, functionName: 'callee' }],
        }),
      ],
    })

    t.emit({ type: 'char-write', serviceUuid: SVC, charUuid: CHAR_A, data: new Uint8Array([7]) })
    await settle()

    expect(executed.map(e => e.name)).toEqual(['caller', 'callee'])
    // The callee receives the caller's output buffer.
    expect(executed[1].input).toEqual([7])
  })

  it('ignores a request for a scenario that does not exist', async () => {
    const t = fakeConnection()
    stubs.set('caller', input => ({ output: input, scenarioRequests: ['Ghost'] }))
    start(t, {
      functions: [fn('caller')],
      scenarios: [
        scenario({
          name: 'Caller',
          trigger: { kind: TriggerKind.CharWrite, serviceUuid: SVC, charUuid: CHAR_A },
          steps: [{ kind: StepKind.CallFunction, functionName: 'caller' }],
        }),
      ],
    })

    t.emit({ type: 'char-write', serviceUuid: SVC, charUuid: CHAR_A, data: new Uint8Array([1]) })
    await settle()

    expect(executed.map(e => e.name)).toEqual(['caller'])
  })

  it('caps a self-triggering scenario instead of looping forever', async () => {
    const t = fakeConnection()
    // The classic runaway: the function asks for its own scenario every time.
    stubs.set('loop', input => ({ output: input, scenarioRequests: ['Loop'] }))
    const { logs } = start(t, {
      functions: [fn('loop')],
      scenarios: [
        scenario({
          name: 'Loop',
          trigger: { kind: TriggerKind.CharWrite, serviceUuid: SVC, charUuid: CHAR_A },
          steps: [{ kind: StepKind.CallFunction, functionName: 'loop' }],
        }),
      ],
    })

    t.emit({ type: 'char-write', serviceUuid: SVC, charUuid: CHAR_A, data: new Uint8Array([1]) })
    await settle()

    // The triggering run, plus MAX_SCENARIO_DEPTH chained ones, then it stops.
    expect(executed).toHaveLength(MAX_SCENARIO_DEPTH + 1)
    expect(logs.some(l => l.includes('depth limit'))).toBe(true)
  })

  it('caps an A→B→A cycle too', async () => {
    const t = fakeConnection()
    stubs.set('toB', input => ({ output: input, scenarioRequests: ['B'] }))
    stubs.set('toA', input => ({ output: input, scenarioRequests: ['A'] }))
    start(t, {
      functions: [fn('toB'), fn('toA')],
      scenarios: [
        scenario({
          name: 'A',
          trigger: { kind: TriggerKind.CharWrite, serviceUuid: SVC, charUuid: CHAR_A },
          steps: [{ kind: StepKind.CallFunction, functionName: 'toB' }],
        }),
        scenario({
          name: 'B',
          trigger: { kind: TriggerKind.Manual },
          steps: [{ kind: StepKind.CallFunction, functionName: 'toA' }],
        }),
      ],
    })

    t.emit({ type: 'char-write', serviceUuid: SVC, charUuid: CHAR_A, data: new Uint8Array([1]) })
    await settle()

    expect(executed).toHaveLength(MAX_SCENARIO_DEPTH + 1)
  })
})

// --- triggers that do not come from BLE -------------------------------------

describe('startup and timer triggers', () => {
  it('runs startup scenarios shortly after start', async () => {
    const t = fakeConnection()
    stubs.set('boot', () => ({ output: new Uint8Array([1]) }))
    start(t, {
      functions: [fn('boot')],
      scenarios: [
        scenario({
          name: 'Boot',
          trigger: { kind: TriggerKind.Startup },
          steps: [{ kind: StepKind.CallFunction, functionName: 'boot' }],
        }),
      ],
    })

    expect(executed).toEqual([])
    await settle(600)
    expect(executed.map(e => e.name)).toEqual(['boot'])
  })

  it('repeats a repeating timer and stops a one-shot', async () => {
    const t = fakeConnection()
    stubs.set('tick', () => ({ output: new Uint8Array([1]) }))
    stubs.set('once', () => ({ output: new Uint8Array([1]) }))
    start(t, {
      functions: [fn('tick'), fn('once')],
      scenarios: [
        scenario({
          name: 'Repeat',
          trigger: { kind: TriggerKind.Timer, intervalMs: 100, repeat: true },
          steps: [{ kind: StepKind.CallFunction, functionName: 'tick' }],
        }),
        scenario({
          name: 'Once',
          trigger: { kind: TriggerKind.Timer, intervalMs: 100, repeat: false },
          steps: [{ kind: StepKind.CallFunction, functionName: 'once' }],
        }),
      ],
    })

    await settle(350)

    expect(executed.filter(e => e.name === 'tick')).toHaveLength(3)
    expect(executed.filter(e => e.name === 'once')).toHaveLength(1)
  })

  it('re-reads the scenario on each tick, so edits apply without a restart', async () => {
    const t = fakeConnection()
    stubs.set('old', () => ({ output: new Uint8Array([1]) }))
    stubs.set('new', () => ({ output: new Uint8Array([1]) }))
    const { live } = start(t, {
      functions: [fn('old'), fn('new')],
      scenarios: [
        scenario({
          name: 'Timer',
          trigger: { kind: TriggerKind.Timer, intervalMs: 100, repeat: true },
          steps: [{ kind: StepKind.CallFunction, functionName: 'old' }],
        }),
      ],
    })

    await settle(150)
    live[0] = { ...live[0], steps: [{ kind: StepKind.CallFunction, functionName: 'new' }] }
    await settle(200)

    expect(executed.map(e => e.name)).toEqual(['old', 'new', 'new'])
  })

  it('skips a tick for a scenario that was disabled mid-run', async () => {
    const t = fakeConnection()
    stubs.set('tick', () => ({ output: new Uint8Array([1]) }))
    const { live } = start(t, {
      functions: [fn('tick')],
      scenarios: [
        scenario({
          name: 'Timer',
          trigger: { kind: TriggerKind.Timer, intervalMs: 100, repeat: true },
          steps: [{ kind: StepKind.CallFunction, functionName: 'tick' }],
        }),
      ],
    })

    await settle(150)
    live[0] = { ...live[0], enabled: false }
    await settle(300)

    expect(executed).toHaveLength(1)
  })

  it('runs a manual scenario through the returned runScenario()', async () => {
    const t = fakeConnection()
    stubs.set('manual', () => ({ output: new Uint8Array([1]) }))
    const manual = scenario({
      name: 'Manual',
      trigger: { kind: TriggerKind.Manual },
      steps: [{ kind: StepKind.CallFunction, functionName: 'manual' }],
    })
    const { runtime } = start(t, { functions: [fn('manual')], scenarios: [manual] })

    await runtime.runScenario(manual)

    expect(executed.map(e => e.name)).toEqual(['manual'])
  })
})

// --- lifecycle --------------------------------------------------------------

describe('lifecycle', () => {
  it('stops responding to events and unsubscribes after stop()', async () => {
    const t = fakeConnection()
    stubs.set('echo', input => ({ output: input }))
    const { runtime } = start(t, {
      functions: [fn('echo')],
      scenarios: [
        scenario({
          name: 'Echo',
          trigger: { kind: TriggerKind.CharWrite, serviceUuid: SVC, charUuid: CHAR_A },
          steps: [{ kind: StepKind.CallFunction, functionName: 'echo' }],
        }),
      ],
    })

    runtime.stop()
    expect(t.hasHandler()).toBe(false)

    t.emit({ type: 'char-write', serviceUuid: SVC, charUuid: CHAR_A, data: new Uint8Array([1]) })
    await settle()

    expect(executed).toEqual([])
  })

  it('cancels pending timers on stop()', async () => {
    const t = fakeConnection()
    stubs.set('tick', () => ({ output: new Uint8Array([1]) }))
    const { runtime } = start(t, {
      functions: [fn('tick')],
      scenarios: [
        scenario({
          name: 'Timer',
          trigger: { kind: TriggerKind.Timer, intervalMs: 100, repeat: true },
          steps: [{ kind: StepKind.CallFunction, functionName: 'tick' }],
        }),
      ],
    })

    await settle(150)
    runtime.stop()
    await settle(500)

    expect(executed).toHaveLength(1)
  })

  it('reports a disconnect once and calls onDisconnect', async () => {
    const t = fakeConnection()
    const onDisconnect = vi.fn()
    const { logs } = start(t, { onDisconnect })

    t.emit({ type: 'disconnected', reason: 'phone hung up' })
    await settle()

    expect(onDisconnect).toHaveBeenCalledTimes(1)
    expect(logs.some(l => l.includes('phone hung up'))).toBe(true)
    expect(t.hasHandler()).toBe(false)
  })

  it('logs a schema mismatch without tearing the runtime down', async () => {
    const t = fakeConnection()
    const { logs } = start(t)

    t.emit({ type: 'schema-mismatch' })
    await settle()

    expect(logs.some(l => l.includes('Schema mismatch'))).toBe(true)
    expect(t.hasHandler()).toBe(true)
  })
})
