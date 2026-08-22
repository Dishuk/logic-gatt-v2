/**
 * Worker pool for user function execution. The sandbox itself lives in `sandbox.ts`.
 */

import type { SetVariables, UserFunction, UserVariable } from '../types'
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
let worker: Worker | null = null
const pendingRequests = new Map<
  string,
  {
    resolve: (result: ExecutionResult) => void
    reject: (error: Error) => void
    timeoutId: ReturnType<typeof setTimeout>
    log: (msg: string) => void
    functionName: string
  }
>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./sandbox.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data
      const pending = pendingRequests.get(response.id)
      if (!pending) return

      clearTimeout(pending.timeoutId)
      pendingRequests.delete(response.id)

      for (const log of response.logs) {
        pending.log(log.message)
      }

      if (response.error) {
        pending.log(`Error in "${pending.functionName}": ${response.error}`)
        pending.resolve({
          output: null,
          variableUpdates: [],
          scenarioRequests: [],
        })
      } else {
        pending.resolve({
          output: response.result ? new Uint8Array(response.result) : null,
          variableUpdates: response.variableUpdates,
          scenarioRequests: response.scenarioRequests ?? [],
        })
      }
    }
    worker.onerror = error => {
      terminateWorker()
      for (const [, pending] of pendingRequests) {
        clearTimeout(pending.timeoutId)
        pending.log(`Error in "${pending.functionName}": Worker error: ${error.message}`)
        pending.reject(new Error(`Worker error: ${error.message}`))
      }
      pendingRequests.clear()
    }
  }
  return worker
}

function terminateWorker() {
  if (worker) {
    worker.terminate()
    worker = null
  }
}

export async function executeFunction(
  fn: UserFunction,
  input: Uint8Array,
  ctx: ExecutionContext,
  variables: UserVariable[],
  setVariables: SetVariables,
  scenarioNames: string[] = []
): Promise<{ output: Uint8Array | null; scenarioRequests: string[] }> {
  const id = crypto.randomUUID()

  const request: WorkerRequest = {
    id,
    body: fn.body,
    input: Array.from(input),
    variables: variables.map(v => ({ name: v.name, type: v.type, value: v.initialValue })),
    scenarioNames,
  }

  return new Promise(resolve => {
    const w = getWorker()

    const timeoutId = setTimeout(() => {
      pendingRequests.delete(id)
      terminateWorker()
      ctx.log(`Error in "${fn.name}": Execution timed out after ${EXECUTION_TIMEOUT_MS / 1000}s`)
      resolve({ output: null, scenarioRequests: [] })
    }, EXECUTION_TIMEOUT_MS)

    pendingRequests.set(id, {
      resolve: result => {
        // Merge into the LATEST state (functional updater), not a snapshot taken when this
        // call started: timer scenarios and reads run concurrently, so a stale-snapshot
        // replace would clobber unrelated edits.
        if (result.variableUpdates.length > 0) {
          setVariables(prev => {
            const updated = [...prev]
            for (const update of result.variableUpdates) {
              const idx = updated.findIndex(v => v.name === update.name)
              if (idx !== -1) {
                updated[idx] = { ...updated[idx], initialValue: update.value }
              }
            }
            return updated
          })
        }

        resolve({ output: result.output, scenarioRequests: result.scenarioRequests })
      },
      reject: () => {
        resolve({ output: null, scenarioRequests: [] })
      },
      timeoutId,
      log: ctx.log,
      functionName: fn.name,
    })

    w.postMessage(request)
  })
}
