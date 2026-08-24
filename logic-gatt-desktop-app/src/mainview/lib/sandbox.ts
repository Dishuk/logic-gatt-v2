/**
 * Sandboxed execution of user function bodies.
 *
 * Pure and importable so tests exercise the same code the worker ships;
 * `sandbox.worker.ts` is only the postMessage wrapper around `runSandboxed`.
 */

import type { VarType } from '../types'
import { formatHex, parseHex } from '@shared/hex'

// ─── Binary Reader/Writer ───────────────────────────────────────────────────

export interface BinaryReader {
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

export interface BinaryWriter {
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

export function createReader(data: Uint8Array): BinaryReader {
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

export function createWriter(): BinaryWriter {
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

// ─── Variable codec ─────────────────────────────────────────────────────────

export function parseVarValue(type: VarType, raw: string): unknown {
  switch (type) {
    case 'hex':
      return parseHex(raw)
    case 'u8':
    case 'u16':
    case 'u32':
      return Number(raw) || 0
    case 'string':
      return raw
  }
}

export function serializeVarValue(type: VarType, value: unknown): string {
  if (type === 'hex' && value instanceof Uint8Array) return formatHex(value)
  return String(value)
}

export function validateVarValue(type: VarType, value: unknown): string | null {
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

// ─── Isolation ──────────────────────────────────────────────────────────────

/**
 * Identifiers shadowed as function parameters so user code can't name them directly.
 * `globalThis`/`self`/`Function` are the escape hatches that made the rest pointless.
 */
export const BLOCKED_GLOBALS = [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'importScripts',
  'indexedDB',
  'caches',
  'navigator',
  'Notification',
  'ServiceWorker',
  'SharedWorker',
  'globalThis',
  'self',
  'Function',
  'Worker',
  'postMessage',
]

export const blockedProxy = new Proxy(
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

Object.freeze(blockedProxy)

const RealFunction = Function
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const GeneratorFunction = Object.getPrototypeOf(function* () {}).constructor
const AsyncGeneratorFunction = Object.getPrototypeOf(async function* () {}).constructor

/**
 * Shadowing alone leaves `({}).constructor.constructor('return globalThis')()` open, which
 * rebuilds a function in global scope and reaches every blocked name. Mutates realm
 * globals, so only the worker calls it — never the main thread.
 */
export function sealEscapeHatches(): void {
  const deny = (name: string) => () => {
    throw new Error(`Access to '${name}' is blocked in sandbox`)
  }
  for (const ctor of [RealFunction, AsyncFunction, GeneratorFunction, AsyncGeneratorFunction]) {
    try {
      Object.defineProperty(ctor.prototype, 'constructor', {
        value: deny('Function'),
        writable: false,
        configurable: false,
      })
    } catch {
      /* already sealed */
    }
  }
  // `eval` can't be a strict-mode parameter name, so it can't be shadowed like the
  // rest. Replace the intrinsic instead — that defeats indirect eval too.
  try {
    Object.defineProperty(globalThis, 'eval', { value: deny('eval'), writable: false, configurable: false })
  } catch {
    /* already sealed */
  }
}

// ─── Execution ──────────────────────────────────────────────────────────────

export interface SandboxRequest {
  body: string
  input: number[]
  variables: { name: string; type: string; value: string }[]
  /** Available scenario names for `ctx.runScenario()`. */
  scenarioNames: string[]
}

export interface SandboxResult {
  result: number[] | null
  logs: { level: string; message: string }[]
  variableUpdates: { name: string; value: string }[]
  scenarioRequests: string[]
  error: string | null
}

export function runSandboxed({ body, input, variables, scenarioNames }: SandboxRequest): SandboxResult {
  const logs: { level: string; message: string }[] = []
  const variableUpdates: { name: string; value: string }[] = []
  const scenarioRequests: string[] = []
  const scenarioNameSet = new Set(scenarioNames ?? [])

  const varStore = new Map(variables.map(v => [v.name, { type: v.type as VarType, value: v.value }]))

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

  const fmt = (...args: unknown[]) => args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')

  const sandboxConsole = {
    log: (...args: unknown[]) => logs.push({ level: 'log', message: fmt(...args) }),
    warn: (...args: unknown[]) => logs.push({ level: 'warn', message: `[warn] ${fmt(...args)}` }),
    error: (...args: unknown[]) => logs.push({ level: 'error', message: `[error] ${fmt(...args)}` }),
    info: (...args: unknown[]) => logs.push({ level: 'info', message: `[info] ${fmt(...args)}` }),
  }

  try {
    const argNames = ['input', 'ctx', 'console', 'reader', 'writer', ...BLOCKED_GLOBALS]
    const argValues = [
      new Uint8Array(input),
      ctx,
      sandboxConsole,
      (data: Uint8Array) => createReader(data),
      () => createWriter(),
      ...BLOCKED_GLOBALS.map(() => blockedProxy),
    ]

    // Strict mode: otherwise a sloppy-mode call binds `this` to the global scope,
    // handing user code `this.fetch` regardless of what the parameters shadow.
    const runner = RealFunction(...argNames, `"use strict";\n${body}`)
    const result = runner(...argValues)

    let resultArray: number[] | null = null
    if (result instanceof Uint8Array) {
      resultArray = Array.from(result)
    } else if (result != null) {
      logs.push({ level: 'warn', message: `Warning: function returned non-Uint8Array: ${typeof result}` })
    }

    return { result: resultArray, logs, variableUpdates, scenarioRequests, error: null }
  } catch (err) {
    return {
      result: null,
      logs,
      variableUpdates,
      scenarioRequests,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
