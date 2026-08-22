/**
 * postMessage wrapper around `runSandboxed`. All execution logic lives in
 * `sandbox.ts` so it is importable and testable without spawning a worker.
 */

import { runSandboxed, sealEscapeHatches, type SandboxRequest, type SandboxResult } from './sandbox'

export interface WorkerRequest extends SandboxRequest {
  id: string
}

export interface WorkerResponse extends SandboxResult {
  id: string
}

// Safe here: a dedicated worker gets its own realm, so this can't affect the app.
sealEscapeHatches()

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, ...request } = event.data
  const response: WorkerResponse = { id, ...runSandboxed(request) }
  self.postMessage(response)
}
