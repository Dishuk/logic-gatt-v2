/**
 * Worker pool for user function execution. The sandbox itself lives in `sandbox.ts`.
 *
 * One worker per in-flight call, rather than one worker for the whole app. A sandbox
 * runs `runSandboxed` synchronously, so a worker busy with a function cannot look at
 * another message until that function returns — and there is no way to interrupt a
 * runaway one except to terminate its realm. Sharing a single worker therefore meant a
 * function that spun made every *other* function wait out its five-second timeout, and
 * then die with it, each reporting a timeout of its own that never happened.
 *
 * With a slot per call, terminating a runaway costs only the call that caused it.
 * Slots are reused while idle so the common case still spawns nothing.
 */

import type { UserFunction } from '../types'
import type { SessionState } from './sessionState'
import type { WorkerRequest, WorkerResponse } from './sandbox.worker'

/** Only `log` is used during execution — variables are resolved inside the worker. */
export interface ExecutionContext {
  log: (msg: string) => void
}

export interface ExecutionResult {
  output: Uint8Array | null
  variableUpdates: { name: string; value: string }[]
  scenarioRequests: string[]
}

const EXECUTION_TIMEOUT_MS = 5000

/**
 * How many sandboxes may run at once. A scenario's own steps are sequential, so this
 * only has to cover pipelines that overlap — a few timer scenarios alongside a BLE
 * read/write. Calls past the cap queue rather than spawning without bound.
 */
const MAX_WORKERS = 4

type Settle = (result: { output: Uint8Array | null; scenarioRequests: string[] }) => void

interface Job {
  id: string
  body: string
  input: number[]
  scenarioNames: string[]
  session: SessionState
  log: (msg: string) => void
  functionName: string
  settle: Settle
}

interface Slot {
  worker: Worker
  job: Job | null
  timeoutId: ReturnType<typeof setTimeout> | null
}

const slots: Slot[] = []
const queue: Job[] = []

function spawn(): Slot {
  const worker = new Worker(new URL('./sandbox.worker.ts', import.meta.url), { type: 'module' })
  const slot: Slot = { worker, job: null, timeoutId: null }

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data
    const job = slot.job
    // A late reply from a call already given up on has no one waiting for it.
    if (!job || response.id !== job.id) return

    // Freed, but nothing new is started until this job's writes have landed: a queued
    // job reads its variables when it is dispatched, so pumping first would hand it
    // the state from before this function ran.
    release(slot)
    for (const line of response.logs) job.log(line.message)

    if (response.error) {
      job.log(`Error in "${job.functionName}": ${response.error}`)
      job.settle({ output: null, scenarioRequests: [] })
      pump()
      return
    }

    // Applied before settling so the next function to run — the next step in this
    // pipeline, a timer scenario firing now — reads what this one wrote.
    for (const update of response.variableUpdates) job.session.set(update.name, update.value)

    job.settle({
      output: response.result ? new Uint8Array(response.result) : null,
      scenarioRequests: response.scenarioRequests ?? [],
    })
    pump()
  }

  worker.onerror = error => {
    const job = slot.job
    discard(slot)
    if (job) {
      job.log(`Error in "${job.functionName}": Worker error: ${error.message}`)
      job.settle({ output: null, scenarioRequests: [] })
    }
    pump()
  }

  slots.push(slot)
  return slot
}

/** Hand a slot its job and start its clock. */
function assign(slot: Slot, job: Job): void {
  slot.job = job
  slot.timeoutId = setTimeout(() => {
    // The function is still running and cannot be asked to stop, so this realm goes.
    // Only this call is affected; other slots keep their workers.
    discard(slot)
    job.log(`Error in "${job.functionName}": Execution timed out after ${EXECUTION_TIMEOUT_MS / 1000}s`)
    job.settle({ output: null, scenarioRequests: [] })
    pump()
  }, EXECUTION_TIMEOUT_MS)

  // Variables are read here rather than when the call was made: a job that waited in
  // the queue must see what the functions ahead of it wrote, not a stale snapshot.
  const request: WorkerRequest = {
    id: job.id,
    body: job.body,
    input: job.input,
    variables: job.session.list().map(v => ({ name: v.name, type: v.type, value: v.current })),
    scenarioNames: job.scenarioNames,
  }
  slot.worker.postMessage(request)
}

/** Free a slot for reuse, keeping its worker. Does not start queued work; see `pump`. */
function release(slot: Slot): void {
  if (slot.timeoutId !== null) clearTimeout(slot.timeoutId)
  slot.timeoutId = null
  slot.job = null
}

/** Kill a slot's worker and drop it from the pool. */
function discard(slot: Slot): void {
  if (slot.timeoutId !== null) clearTimeout(slot.timeoutId)
  slot.timeoutId = null
  slot.job = null
  const at = slots.indexOf(slot)
  if (at !== -1) slots.splice(at, 1)
  slot.worker.terminate()
}

/** Start whatever is queued, reusing idle slots before spawning new ones. */
function pump(): void {
  while (queue.length > 0) {
    const slot = slots.find(s => s.job === null) ?? (slots.length < MAX_WORKERS ? spawn() : null)
    if (!slot) return
    assign(slot, queue.shift()!)
  }
}

export async function executeFunction(
  fn: UserFunction,
  input: Uint8Array,
  ctx: ExecutionContext,
  session: SessionState,
  scenarioNames: string[] = []
): Promise<{ output: Uint8Array | null; scenarioRequests: string[] }> {
  return new Promise(resolve => {
    queue.push({
      id: crypto.randomUUID(),
      body: fn.body,
      input: Array.from(input),
      scenarioNames,
      session,
      log: ctx.log,
      functionName: fn.name,
      settle: resolve,
    })
    pump()
  })
}

/** Tear the pool down. Exported for tests; the app keeps its workers for its lifetime. */
export function resetWorkerPool(): void {
  for (const slot of [...slots]) discard(slot)
  queue.length = 0
}
