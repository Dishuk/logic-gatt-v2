/**
 * Tests for the sandbox worker pool (`lib/executor.ts`).
 *
 * The behaviour that matters here is isolation: a function that never returns must cost
 * only its own call. Workers are faked so a test can hang one, answer another, and
 * inspect exactly which realms were terminated.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { UserFunction } from '../types'
import { createSessionState } from '../lib/sessionState'
import { executeFunction, resetWorkerPool } from '../lib/executor'
import type { WorkerRequest, WorkerResponse } from '../lib/sandbox.worker'

/** A `message` event carrying a worker response, without faking the other 28 fields. */
function messageEvent(data: WorkerResponse): MessageEvent<WorkerResponse> {
  return { data } as unknown as MessageEvent<WorkerResponse>
}

/** Stand-in for a sandbox realm: records what it was sent, replies only when told to. */
class FakeWorker {
  static live: FakeWorker[] = []

  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null
  onerror: ((e: { message: string }) => void) | null = null
  readonly sent: WorkerRequest[] = []
  terminated = false

  constructor() {
    FakeWorker.live.push(this)
  }

  postMessage(request: WorkerRequest) {
    this.sent.push(request)
  }

  terminate() {
    this.terminated = true
  }

  /** The request this realm is currently working on. */
  get pending(): WorkerRequest | undefined {
    return this.sent[this.sent.length - 1]
  }

  reply(partial: Partial<WorkerResponse> = {}) {
    const id = this.pending?.id
    if (id === undefined) throw new Error('nothing was sent to this worker')
    this.onmessage?.(
      messageEvent({
        id,
        result: null,
        logs: [],
        variableUpdates: [],
        scenarioRequests: [],
        error: null,
        ...partial,
      })
    )
  }

  fail(message: string) {
    this.onerror?.({ message })
  }
}

function fn(name: string, body = ''): UserFunction {
  return { id: `fn-${name}`, name, body }
}

/** Lines the runtime would have shown in the Functions terminal tab. */
function logger() {
  const lines: string[] = []
  return { lines, ctx: { log: (m: string) => lines.push(m) } }
}

beforeEach(() => {
  FakeWorker.live = []
  vi.stubGlobal('Worker', FakeWorker)
  vi.useFakeTimers()
})

afterEach(() => {
  resetWorkerPool()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('isolation between concurrent calls', () => {
  it('does not disturb a running call when another times out', async () => {
    const hung = logger()
    const healthy = logger()
    const session = createSessionState()

    const hungCall = executeFunction(fn('spins'), new Uint8Array(), hung.ctx, session)
    // Started later, the way a timer scenario overlaps one already running, so its own
    // deadline has not arrived when the first call's does.
    await vi.advanceTimersByTimeAsync(3000)
    const healthyCall = executeFunction(fn('works'), new Uint8Array([1]), healthy.ctx, session)

    // Two calls at once means two realms — neither waits on the other.
    expect(FakeWorker.live).toHaveLength(2)
    const [spinner, worker] = FakeWorker.live

    await vi.advanceTimersByTimeAsync(2500)
    expect(await hungCall).toEqual({ output: null, scenarioRequests: [] })

    // Only the runaway realm was killed.
    expect(spinner.terminated).toBe(true)
    expect(worker.terminated).toBe(false)

    // And the other call still completes normally, afterwards.
    worker.reply({ result: [0x42] })
    const result = await healthyCall
    expect([...(result.output ?? [])]).toEqual([0x42])
  })

  it('blames only the function that actually timed out', async () => {
    const hung = logger()
    const healthy = logger()
    const session = createSessionState()

    void executeFunction(fn('spins'), new Uint8Array(), hung.ctx, session)
    await vi.advanceTimersByTimeAsync(3000)
    void executeFunction(fn('works'), new Uint8Array(), healthy.ctx, session)
    await vi.advanceTimersByTimeAsync(2500)

    expect(hung.lines.join('\n')).toContain('Error in "spins": Execution timed out')
    // The bug this replaces: every in-flight call reported a timeout of its own.
    expect(healthy.lines.join('\n')).not.toContain('timed out')
  })

  it('does not let a slow function hold up an unrelated one', async () => {
    const a = logger()
    const b = logger()
    const session = createSessionState()

    void executeFunction(fn('slow'), new Uint8Array(), a.ctx, session)
    const quick = executeFunction(fn('quick'), new Uint8Array(), b.ctx, session)

    const [, second] = FakeWorker.live
    second.reply({ result: [7] })

    // Answered while the first call is still outstanding.
    expect([...((await quick).output ?? [])]).toEqual([7])
  })

  it('fails only its own call when a worker errors', async () => {
    const a = logger()
    const b = logger()
    const session = createSessionState()

    const broken = executeFunction(fn('boom'), new Uint8Array(), a.ctx, session)
    const fine = executeFunction(fn('fine'), new Uint8Array(), b.ctx, session)
    const [first, second] = FakeWorker.live

    first.fail('realm died')

    expect(await broken).toEqual({ output: null, scenarioRequests: [] })
    expect(a.lines.join('\n')).toContain('Error in "boom": Worker error: realm died')
    expect(second.terminated).toBe(false)

    second.reply({ result: [1] })
    expect([...((await fine).output ?? [])]).toEqual([1])
    expect(b.lines).toHaveLength(0)
  })
})

describe('pooling', () => {
  it('reuses an idle worker rather than spawning per call', async () => {
    const { ctx } = logger()
    const session = createSessionState()

    const first = executeFunction(fn('a'), new Uint8Array(), ctx, session)
    expect(FakeWorker.live).toHaveLength(1)
    FakeWorker.live[0].reply({ result: [1] })
    await first

    const second = executeFunction(fn('b'), new Uint8Array(), ctx, session)
    expect(FakeWorker.live).toHaveLength(1)
    FakeWorker.live[0].reply({ result: [2] })
    expect([...((await second).output ?? [])]).toEqual([2])
  })

  it('caps concurrent workers and queues the rest', async () => {
    const { ctx } = logger()
    const session = createSessionState()

    const calls = Array.from({ length: 6 }, (_, i) => executeFunction(fn(`f${i}`), new Uint8Array(), ctx, session))

    expect(FakeWorker.live).toHaveLength(4)

    // Freeing one slot dispatches a queued call into it, without a new realm.
    FakeWorker.live[0].reply({ result: [0] })
    await calls[0]
    expect(FakeWorker.live).toHaveLength(4)
    expect(FakeWorker.live[0].sent).toHaveLength(2)
  })

  it('replaces a terminated worker for queued work', async () => {
    const { ctx } = logger()
    const session = createSessionState()

    const calls = Array.from({ length: 5 }, (_, i) => executeFunction(fn(`f${i}`), new Uint8Array(), ctx, session))
    const spinner = FakeWorker.live[0]

    await vi.advanceTimersByTimeAsync(6000)
    await calls[0]

    expect(spinner.terminated).toBe(true)
    // The queued fifth call still gets a realm to run in.
    const usable = FakeWorker.live.filter(w => !w.terminated)
    expect(usable.some(w => w.sent.length > 0)).toBe(true)
  })
})

describe('variables', () => {
  it('applies a function’s writes before the call settles', async () => {
    const { ctx } = logger()
    const session = createSessionState([{ id: 'v1', name: 'count', type: 'u8', initialValue: '1' }])

    const call = executeFunction(fn('bump'), new Uint8Array(), ctx, session)
    FakeWorker.live[0].reply({ result: [], variableUpdates: [{ name: 'count', value: '2' }] })
    await call

    expect(session.get('count')).toBe('2')
  })

  it('gives a queued call the variables as they are when it starts', async () => {
    const { ctx } = logger()
    const session = createSessionState([{ id: 'v1', name: 'count', type: 'u8', initialValue: '1' }])

    // Fill every slot, then queue one more behind them.
    const running = Array.from({ length: 4 }, (_, i) => executeFunction(fn(`f${i}`), new Uint8Array(), ctx, session))
    const queued = executeFunction(fn('last'), new Uint8Array(), ctx, session)

    // The first call rewrites the variable before the queued one is dispatched.
    FakeWorker.live[0].reply({ result: [], variableUpdates: [{ name: 'count', value: '9' }] })
    await running[0]

    const dispatched = FakeWorker.live[0].sent[1]
    expect(dispatched.variables).toEqual([{ name: 'count', type: 'u8', value: '9' }])
    FakeWorker.live[0].reply({ result: [] })
    await queued
  })

  it('reports a sandbox error against the right function', async () => {
    const { ctx, lines } = logger()
    const session = createSessionState()

    const call = executeFunction(fn('bad'), new Uint8Array(), ctx, session)
    FakeWorker.live[0].reply({ error: 'ReferenceError: nope is not defined' })
    await call

    expect(lines.join('\n')).toContain('Error in "bad": ReferenceError: nope is not defined')
  })

  it('forwards sandbox log lines', async () => {
    const { ctx, lines } = logger()
    const session = createSessionState()

    const call = executeFunction(fn('chatty'), new Uint8Array(), ctx, session)
    FakeWorker.live[0].reply({ result: [], logs: [{ level: 'log', message: 'hello' }] })
    await call

    expect(lines).toContain('hello')
  })

  it('ignores a reply that arrives after its call was abandoned', async () => {
    const { ctx } = logger()
    const session = createSessionState()

    const call = executeFunction(fn('late'), new Uint8Array(), ctx, session)
    const worker = FakeWorker.live[0]
    const pending = worker.pending!

    await vi.advanceTimersByTimeAsync(6000)
    expect(await call).toEqual({ output: null, scenarioRequests: [] })

    // The terminated realm answering afterwards must not touch anything.
    expect(() =>
      worker.onmessage?.(
        messageEvent({
          id: pending.id,
          result: [1],
          logs: [],
          variableUpdates: [{ name: 'count', value: '5' }],
          scenarioRequests: [],
          error: null,
        })
      )
    ).not.toThrow()
    expect(session.get('count')).toBeUndefined()
  })
})

describe('scenario requests', () => {
  it('passes through what the function queued', async () => {
    const { ctx } = logger()
    const session = createSessionState()

    const call = executeFunction(fn('caller'), new Uint8Array(), ctx, session, ['Other'])
    expect(FakeWorker.live[0].pending?.scenarioNames).toEqual(['Other'])

    FakeWorker.live[0].reply({ result: [], scenarioRequests: ['Other'] })
    expect((await call).scenarioRequests).toEqual(['Other'])
  })
})
