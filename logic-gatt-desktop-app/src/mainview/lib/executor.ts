import type { UserFunction, UserVariable, VarType } from '../types'
import type { WorkerRequest, WorkerResponse } from './sandbox.worker'

export interface ExecutionContext {
  log: (msg: string) => void
  getVar: (name: string) => unknown
  setVar: (name: string, value: unknown) => void
}

export interface ExecutionResult {
  output: Uint8Array | null
  variableUpdates: { name: string; value: string }[]
  scenarioRequests: string[]
}

function parseVarValue(type: VarType, raw: string): unknown {
  switch (type) {
    case 'hex': {
      const hex = raw.replace(/[^0-9a-fA-F]/g, '')
      const bytes = []
      for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16))
      return new Uint8Array(bytes)
    }
    case 'u8':
    case 'u16':
    case 'u32':
      return Number(raw) || 0
    case 'string':
      return raw
  }
}

function validateVarValue(type: VarType, value: unknown): string | null {
  switch (type) {
    case 'hex':
      if (!(value instanceof Uint8Array)) return `expected Uint8Array for buffer, got ${typeof value}`
      return null
    case 'u8':
      if (typeof value !== 'number' || !Number.isInteger(value)) return `expected integer for u8, got ${typeof value}`
      if (value < 0 || value > 0xff) return `u8 value out of range (0-255): ${value}`
      return null
    case 'u16':
      if (typeof value !== 'number' || !Number.isInteger(value)) return `expected integer for u16, got ${typeof value}`
      if (value < 0 || value > 0xffff) return `u16 value out of range (0-65535): ${value}`
      return null
    case 'u32':
      if (typeof value !== 'number' || !Number.isInteger(value)) return `expected integer for u32, got ${typeof value}`
      if (value < 0 || value > 0xffffffff) return `u32 value out of range (0-4294967295): ${value}`
      return null
    case 'string':
      if (typeof value !== 'string') return `expected string, got ${typeof value}`
      return null
  }
}

// ─── Binary Reader/Writer Utilities ─────────────────────────────────────────

interface BinaryReader {
  uint8(): number
  int8(): number
  uint16LE(): number
  uint16BE(): number
  int16LE(): number
  int16BE(): number
  uint32LE(): number
  uint32BE(): number
  int32LE(): number
  int32BE(): number
  uintLE(n: number): number | bigint
  uintBE(n: number): number | bigint
  intLE(n: number): number | bigint
  intBE(n: number): number | bigint
  bytes(n: number): Uint8Array
  skip(n: number): void
  pos: number
  remaining(): number
}

interface BinaryWriter {
  uint8(value: number): BinaryWriter
  int8(value: number): BinaryWriter
  uint16LE(value: number): BinaryWriter
  uint16BE(value: number): BinaryWriter
  int16LE(value: number): BinaryWriter
  int16BE(value: number): BinaryWriter
  uint32LE(value: number): BinaryWriter
  uint32BE(value: number): BinaryWriter
  int32LE(value: number): BinaryWriter
  int32BE(value: number): BinaryWriter
  uintLE(value: number | bigint, n: number): BinaryWriter
  uintBE(value: number | bigint, n: number): BinaryWriter
  intLE(value: number | bigint, n: number): BinaryWriter
  intBE(value: number | bigint, n: number): BinaryWriter
  bytes(data: Uint8Array | number[]): BinaryWriter
  build(): Uint8Array
}

function createReader(data: Uint8Array): BinaryReader {
  let pos = 0
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  return {
    get pos() {
      return pos
    },
    set pos(v: number) {
      pos = v
    },
    remaining() {
      return data.length - pos
    },
    uint8() {
      const v = view.getUint8(pos)
      pos += 1
      return v
    },
    int8() {
      const v = view.getInt8(pos)
      pos += 1
      return v
    },
    uint16LE() {
      const v = view.getUint16(pos, true)
      pos += 2
      return v
    },
    uint16BE() {
      const v = view.getUint16(pos, false)
      pos += 2
      return v
    },
    int16LE() {
      const v = view.getInt16(pos, true)
      pos += 2
      return v
    },
    int16BE() {
      const v = view.getInt16(pos, false)
      pos += 2
      return v
    },
    uint32LE() {
      const v = view.getUint32(pos, true)
      pos += 4
      return v
    },
    uint32BE() {
      const v = view.getUint32(pos, false)
      pos += 4
      return v
    },
    int32LE() {
      const v = view.getInt32(pos, true)
      pos += 4
      return v
    },
    int32BE() {
      const v = view.getInt32(pos, false)
      pos += 4
      return v
    },
    uintLE(n: number) {
      let result = 0n
      for (let i = 0; i < n; i++) result |= BigInt(view.getUint8(pos + i)) << BigInt(i * 8)
      pos += n
      return n <= 4 ? Number(result) : result
    },
    uintBE(n: number) {
      let result = 0n
      for (let i = 0; i < n; i++) result = (result << 8n) | BigInt(view.getUint8(pos + i))
      pos += n
      return n <= 4 ? Number(result) : result
    },
    intLE(n: number) {
      let result = 0n
      for (let i = 0; i < n; i++) result |= BigInt(view.getUint8(pos + i)) << BigInt(i * 8)
      pos += n
      const bits = BigInt(n * 8)
      const signBit = 1n << (bits - 1n)
      if (result & signBit) result -= 1n << bits
      return n <= 4 ? Number(result) : result
    },
    intBE(n: number) {
      let result = 0n
      for (let i = 0; i < n; i++) result = (result << 8n) | BigInt(view.getUint8(pos + i))
      pos += n
      const bits = BigInt(n * 8)
      const signBit = 1n << (bits - 1n)
      if (result & signBit) result -= 1n << bits
      return n <= 4 ? Number(result) : result
    },
    bytes(n: number) {
      const slice = data.slice(pos, pos + n)
      pos += n
      return slice
    },
    skip(n: number) {
      pos += n
    },
  }
}

function createWriter(): BinaryWriter {
  const chunks: number[] = []
  const w: BinaryWriter = {
    uint8(v) {
      chunks.push(v & 0xff)
      return w
    },
    int8(v) {
      chunks.push(v & 0xff)
      return w
    },
    uint16LE(v) {
      chunks.push(v & 0xff, (v >> 8) & 0xff)
      return w
    },
    uint16BE(v) {
      chunks.push((v >> 8) & 0xff, v & 0xff)
      return w
    },
    int16LE(v) {
      chunks.push(v & 0xff, (v >> 8) & 0xff)
      return w
    },
    int16BE(v) {
      chunks.push((v >> 8) & 0xff, v & 0xff)
      return w
    },
    uint32LE(v) {
      chunks.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff)
      return w
    },
    uint32BE(v) {
      chunks.push((v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff)
      return w
    },
    int32LE(v) {
      chunks.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff)
      return w
    },
    int32BE(v) {
      chunks.push((v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff)
      return w
    },
    uintLE(value, n) {
      let v = BigInt(value)
      for (let i = 0; i < n; i++) {
        chunks.push(Number(v & 0xffn))
        v >>= 8n
      }
      return w
    },
    uintBE(value, n) {
      const v = BigInt(value)
      for (let i = n - 1; i >= 0; i--) chunks.push(Number((v >> BigInt(i * 8)) & 0xffn))
      return w
    },
    intLE(value, n) {
      let v = BigInt(value)
      if (v < 0n) v = (1n << BigInt(n * 8)) + v
      for (let i = 0; i < n; i++) {
        chunks.push(Number(v & 0xffn))
        v >>= 8n
      }
      return w
    },
    intBE(value, n) {
      let v = BigInt(value)
      if (v < 0n) v = (1n << BigInt(n * 8)) + v
      for (let i = n - 1; i >= 0; i--) chunks.push(Number((v >> BigInt(i * 8)) & 0xffn))
      return w
    },
    bytes(data) {
      for (const b of data) chunks.push(b & 0xff)
      return w
    },
    build() {
      return new Uint8Array(chunks)
    },
  }
  return w
}

export function buildContext(
  variables: UserVariable[],
  setVariables: (vars: UserVariable[]) => void,
  log: (msg: string) => void
): ExecutionContext {
  return {
    log,
    getVar(name: string) {
      const v = variables.find(v => v.name === name)
      if (!v) {
        log(`getVar: unknown variable "${name}"`)
        return undefined
      }
      return parseVarValue(v.type, v.initialValue)
    },
    setVar(name: string, value: unknown) {
      const idx = variables.findIndex(v => v.name === name)
      if (idx === -1) {
        log(`setVar: unknown variable "${name}"`)
        return
      }
      const v = variables[idx]
      const err = validateVarValue(v.type, value)
      if (err) {
        log(`setVar("${name}"): ${err}`)
        return
      }
      let raw: string
      if (v.type === 'hex') {
        raw = Array.from(value as Uint8Array)
          .map(b => b.toString(16).toUpperCase().padStart(2, '0'))
          .join(' ')
      } else {
        raw = String(value)
      }
      const updated = [...variables]
      updated[idx] = { ...v, initialValue: raw }
      setVariables(updated)
    },
  }
}

// Worker management
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

      // Process logs from this execution
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
      // Terminate and recreate on next call
      terminateWorker()
      // Reject all pending requests
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
  setVariables: (vars: UserVariable[]) => void,
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
        // Apply variable updates
        if (result.variableUpdates.length > 0) {
          const updated = [...variables]
          for (const update of result.variableUpdates) {
            const idx = updated.findIndex(v => v.name === update.name)
            if (idx !== -1) {
              updated[idx] = { ...updated[idx], initialValue: update.value }
            }
          }
          setVariables(updated)
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

// Legacy synchronous version for backwards compatibility during transition
export function executeFunctionSync(fn: UserFunction, input: Uint8Array, ctx: ExecutionContext): Uint8Array | null {
  try {
    const body = fn.body
    const fmt = (...args: unknown[]) => args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
    const realConsole = globalThis.console
    const console = {
      log: (...args: unknown[]) => {
        realConsole.log(`[fn:${fn.name}]`, ...args)
        ctx.log(fmt(...args))
      },
      warn: (...args: unknown[]) => {
        realConsole.warn(`[fn:${fn.name}]`, ...args)
        ctx.log(`[warn] ${fmt(...args)}`)
      },
      error: (...args: unknown[]) => {
        realConsole.error(`[fn:${fn.name}]`, ...args)
        ctx.log(`[error] ${fmt(...args)}`)
      },
      info: (...args: unknown[]) => {
        realConsole.info(`[fn:${fn.name}]`, ...args)
        ctx.log(`[info] ${fmt(...args)}`)
      },
    }
    const reader = (data: Uint8Array) => createReader(data)
    const writerFn = () => createWriter()
    const runner = new Function('input', 'ctx', 'console', 'reader', 'writer', body)
    const result = runner(input, ctx, console, reader, writerFn)
    if (result instanceof Uint8Array) return result
    if (result == null) return null
    ctx.log(`Warning: function "${fn.name}" returned non-Uint8Array: ${typeof result}`)
    return null
  } catch (err) {
    ctx.log(`Error in "${fn.name}": ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
