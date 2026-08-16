/**
 * Sandboxed code execution worker.
 * Executes user functions in isolation with blocked browser APIs.
 */

export interface WorkerRequest {
  id: string
  body: string
  input: number[] // Uint8Array as plain array for transfer
  variables: { name: string; type: string; value: string }[]
  scenarioNames: string[] // Available scenario names for ctx.runScenario()
}

export interface WorkerResponse {
  id: string
  result: number[] | null // Uint8Array as plain array
  logs: { level: string; message: string }[]
  variableUpdates: { name: string; value: string }[]
  scenarioRequests: string[] // Scenarios to run after this function completes
  error: string | null
}

// Block dangerous globals
const BLOCKED_GLOBALS = [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'importScripts',
  'eval',
  'indexedDB',
  'caches',
  'navigator',
  'Notification',
  'ServiceWorker',
  'SharedWorker',
]

const blockedProxy = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(`Access to '${String(prop)}' is blocked in sandbox`)
    },
    set(_target, prop) {
      throw new Error(`Access to '${String(prop)}' is blocked in sandbox`)
    },
  }
)

// Freeze the proxy to prevent modifications
Object.freeze(blockedProxy)

// ─── Binary Reader/Writer Utilities ─────────────────────────────────────────

interface BinaryReader {
  /** Read unsigned 8-bit integer */
  uint8(): number
  /** Read signed 8-bit integer */
  int8(): number
  /** Read unsigned 16-bit integer (little-endian) */
  uint16LE(): number
  /** Read unsigned 16-bit integer (big-endian) */
  uint16BE(): number
  /** Read signed 16-bit integer (little-endian) */
  int16LE(): number
  /** Read signed 16-bit integer (big-endian) */
  int16BE(): number
  /** Read unsigned 32-bit integer (little-endian) */
  uint32LE(): number
  /** Read unsigned 32-bit integer (big-endian) */
  uint32BE(): number
  /** Read signed 32-bit integer (little-endian) */
  int32LE(): number
  /** Read signed 32-bit integer (big-endian) */
  int32BE(): number
  /** Read n bytes as unsigned integer (little-endian). Returns bigint if n > 4 */
  uintLE(n: number): number | bigint
  /** Read n bytes as unsigned integer (big-endian). Returns bigint if n > 4 */
  uintBE(n: number): number | bigint
  /** Read n bytes as signed integer (little-endian). Returns bigint if n > 4 */
  intLE(n: number): number | bigint
  /** Read n bytes as signed integer (big-endian). Returns bigint if n > 4 */
  intBE(n: number): number | bigint
  /** Read n bytes as Uint8Array */
  bytes(n: number): Uint8Array
  /** Skip n bytes */
  skip(n: number): void
  /** Current read position */
  pos: number
  /** Remaining bytes */
  remaining(): number
}

interface BinaryWriter {
  /** Write unsigned 8-bit integer */
  uint8(value: number): BinaryWriter
  /** Write signed 8-bit integer */
  int8(value: number): BinaryWriter
  /** Write unsigned 16-bit integer (little-endian) */
  uint16LE(value: number): BinaryWriter
  /** Write unsigned 16-bit integer (big-endian) */
  uint16BE(value: number): BinaryWriter
  /** Write signed 16-bit integer (little-endian) */
  int16LE(value: number): BinaryWriter
  /** Write signed 16-bit integer (big-endian) */
  int16BE(value: number): BinaryWriter
  /** Write unsigned 32-bit integer (little-endian) */
  uint32LE(value: number): BinaryWriter
  /** Write unsigned 32-bit integer (big-endian) */
  uint32BE(value: number): BinaryWriter
  /** Write signed 32-bit integer (little-endian) */
  int32LE(value: number): BinaryWriter
  /** Write signed 32-bit integer (big-endian) */
  int32BE(value: number): BinaryWriter
  /** Write n bytes as unsigned integer (little-endian) */
  uintLE(value: number | bigint, n: number): BinaryWriter
  /** Write n bytes as unsigned integer (big-endian) */
  uintBE(value: number | bigint, n: number): BinaryWriter
  /** Write n bytes as signed integer (little-endian) */
  intLE(value: number | bigint, n: number): BinaryWriter
  /** Write n bytes as signed integer (big-endian) */
  intBE(value: number | bigint, n: number): BinaryWriter
  /** Write raw bytes */
  bytes(data: Uint8Array | number[]): BinaryWriter
  /** Build final Uint8Array */
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
      for (let i = 0; i < n; i++) {
        result |= BigInt(view.getUint8(pos + i)) << BigInt(i * 8)
      }
      pos += n
      return n <= 4 ? Number(result) : result
    },
    uintBE(n: number) {
      let result = 0n
      for (let i = 0; i < n; i++) {
        result = (result << 8n) | BigInt(view.getUint8(pos + i))
      }
      pos += n
      return n <= 4 ? Number(result) : result
    },
    intLE(n: number) {
      let result = 0n
      for (let i = 0; i < n; i++) {
        result |= BigInt(view.getUint8(pos + i)) << BigInt(i * 8)
      }
      pos += n
      const bits = BigInt(n * 8)
      const signBit = 1n << (bits - 1n)
      if (result & signBit) {
        result -= 1n << bits
      }
      return n <= 4 ? Number(result) : result
    },
    intBE(n: number) {
      let result = 0n
      for (let i = 0; i < n; i++) {
        result = (result << 8n) | BigInt(view.getUint8(pos + i))
      }
      pos += n
      const bits = BigInt(n * 8)
      const signBit = 1n << (bits - 1n)
      if (result & signBit) {
        result -= 1n << bits
      }
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

  const writer: BinaryWriter = {
    uint8(value: number) {
      chunks.push(value & 0xff)
      return writer
    },
    int8(value: number) {
      chunks.push(value & 0xff)
      return writer
    },
    uint16LE(value: number) {
      chunks.push(value & 0xff, (value >> 8) & 0xff)
      return writer
    },
    uint16BE(value: number) {
      chunks.push((value >> 8) & 0xff, value & 0xff)
      return writer
    },
    int16LE(value: number) {
      chunks.push(value & 0xff, (value >> 8) & 0xff)
      return writer
    },
    int16BE(value: number) {
      chunks.push((value >> 8) & 0xff, value & 0xff)
      return writer
    },
    uint32LE(value: number) {
      chunks.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff)
      return writer
    },
    uint32BE(value: number) {
      chunks.push((value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff)
      return writer
    },
    int32LE(value: number) {
      chunks.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff)
      return writer
    },
    int32BE(value: number) {
      chunks.push((value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff)
      return writer
    },
    uintLE(value: number | bigint, n: number) {
      let v = BigInt(value)
      for (let i = 0; i < n; i++) {
        chunks.push(Number(v & 0xffn))
        v >>= 8n
      }
      return writer
    },
    uintBE(value: number | bigint, n: number) {
      const v = BigInt(value)
      for (let i = n - 1; i >= 0; i--) {
        chunks.push(Number((v >> BigInt(i * 8)) & 0xffn))
      }
      return writer
    },
    intLE(value: number | bigint, n: number) {
      let v = BigInt(value)
      if (v < 0n) {
        v = (1n << BigInt(n * 8)) + v
      }
      for (let i = 0; i < n; i++) {
        chunks.push(Number(v & 0xffn))
        v >>= 8n
      }
      return writer
    },
    intBE(value: number | bigint, n: number) {
      let v = BigInt(value)
      if (v < 0n) {
        v = (1n << BigInt(n * 8)) + v
      }
      for (let i = n - 1; i >= 0; i--) {
        chunks.push(Number((v >> BigInt(i * 8)) & 0xffn))
      }
      return writer
    },
    bytes(data: Uint8Array | number[]) {
      for (const b of data) chunks.push(b & 0xff)
      return writer
    },
    build() {
      return new Uint8Array(chunks)
    },
  }

  return writer
}

type VarType = 'hex' | 'u8' | 'u16' | 'u32' | 'string'

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

function serializeVarValue(type: VarType, value: unknown): string {
  if (type === 'hex' && value instanceof Uint8Array) {
    return Array.from(value)
      .map(b => b.toString(16).toUpperCase().padStart(2, '0'))
      .join(' ')
  }
  return String(value)
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

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, body, input, variables, scenarioNames } = event.data

  const logs: { level: string; message: string }[] = []
  const variableUpdates: { name: string; value: string }[] = []
  const scenarioRequests: string[] = []
  const scenarioNameSet = new Set(scenarioNames ?? [])

  // Build variable store from input
  const varStore = new Map(variables.map(v => [v.name, { type: v.type as VarType, value: v.value }]))

  // Build context object
  const ctx = {
    log(msg: string) {
      logs.push({ level: 'log', message: msg })
    },
    getVar(name: string): unknown {
      const v = varStore.get(name)
      if (!v) {
        logs.push({ level: 'warn', message: `getVar: unknown variable "${name}"` })
        return undefined
      }
      return parseVarValue(v.type, v.value)
    },
    setVar(name: string, value: unknown) {
      const v = varStore.get(name)
      if (!v) {
        logs.push({ level: 'warn', message: `setVar: unknown variable "${name}"` })
        return
      }
      const err = validateVarValue(v.type, value)
      if (err) {
        logs.push({ level: 'error', message: `setVar("${name}"): ${err}` })
        return
      }
      const serialized = serializeVarValue(v.type, value)
      v.value = serialized
      variableUpdates.push({ name, value: serialized })
    },
    runScenario(name: string) {
      if (!scenarioNameSet.has(name)) {
        logs.push({ level: 'warn', message: `runScenario: unknown scenario "${name}"` })
        return
      }
      scenarioRequests.push(name)
      logs.push({ level: 'log', message: `Queued scenario: "${name}"` })
    },
  }

  // Build console proxy
  const fmt = (...args: unknown[]) => args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')

  const sandboxConsole = {
    log: (...args: unknown[]) => logs.push({ level: 'log', message: fmt(...args) }),
    warn: (...args: unknown[]) => logs.push({ level: 'warn', message: `[warn] ${fmt(...args)}` }),
    error: (...args: unknown[]) => logs.push({ level: 'error', message: `[error] ${fmt(...args)}` }),
    info: (...args: unknown[]) => logs.push({ level: 'info', message: `[info] ${fmt(...args)}` }),
  }

  try {
    // Build blocked globals object
    const blocked: Record<string, unknown> = {}
    for (const name of BLOCKED_GLOBALS) {
      blocked[name] = blockedProxy
    }

    // Create function with blocked globals injected
    const argNames = ['input', 'ctx', 'console', 'reader', 'writer', ...BLOCKED_GLOBALS]
    const argValues = [
      new Uint8Array(input),
      ctx,
      sandboxConsole,
      (data: Uint8Array) => createReader(data),
      () => createWriter(),
      ...BLOCKED_GLOBALS.map(() => blockedProxy),
    ]

    const runner = new Function(...argNames, body)
    const result = runner(...argValues)

    let resultArray: number[] | null = null
    if (result instanceof Uint8Array) {
      resultArray = Array.from(result)
    } else if (result != null) {
      logs.push({ level: 'warn', message: `Warning: function returned non-Uint8Array: ${typeof result}` })
    }

    const response: WorkerResponse = { id, result: resultArray, logs, variableUpdates, scenarioRequests, error: null }
    self.postMessage(response)
  } catch (err) {
    const response: WorkerResponse = {
      id,
      result: null,
      logs,
      variableUpdates,
      scenarioRequests,
      error: err instanceof Error ? err.message : String(err),
    }
    self.postMessage(response)
  }
}
