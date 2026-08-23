/**
 * Runtime variable state for one device session.
 *
 * `UserVariable.initialValue` is authored document data: only the editor writes it.
 * A run works against this store instead, so scenarios never mutate the project and
 * every session starts from a known state. Values use the same serialized string form
 * as `initialValue`, so parsing, validation and the worker protocol are unchanged.
 *
 * Deliberately plain (no React): writes must be visible to the next `getVar` in the
 * same tick. Reading through React state made two scenarios firing in one tick both
 * seed from pre-write values.
 */

import type { UserVariable, VarType } from '../types'

export interface SessionVariable {
  name: string
  type: VarType
  /** Authored value this session started from. */
  initial: string
  /** Live value — diverges from `initial` as functions run. */
  current: string
}

export interface SessionState {
  /** Variables in authored order. */
  list(): SessionVariable[]
  get(name: string): string | undefined
  set(name: string, value: string): void
  /** Discard live values and start again from the authored ones. */
  reseed(vars: UserVariable[]): void
  /** Track edits to the definitions without disturbing live values. */
  sync(vars: UserVariable[]): void
  /** Whether any live value differs from what the session started with. */
  isDirty(): boolean
  /** Change counter — a stable snapshot for `useSyncExternalStore`. */
  getVersion(): number
  subscribe(listener: () => void): () => void
}

export function createSessionState(vars: UserVariable[] = []): SessionState {
  let entries = new Map<string, SessionVariable>()
  const listeners = new Set<() => void>()
  let version = 0

  function fresh(v: UserVariable): SessionVariable {
    return { name: v.name, type: v.type, initial: v.initialValue, current: v.initialValue }
  }

  function seed(source: UserVariable[]) {
    entries = new Map(source.filter(v => v.name).map(v => [v.name, fresh(v)]))
  }

  function changed() {
    version++
    for (const listener of listeners) listener()
  }

  seed(vars)

  return {
    list: () => [...entries.values()],

    get: name => entries.get(name)?.current,

    set(name, value) {
      const entry = entries.get(name)
      if (!entry || entry.current === value) return
      entry.current = value
      changed()
    },

    reseed(source) {
      seed(source)
      changed()
    },

    sync(source) {
      // Rebuilt rather than patched in place, so the store always follows the authored
      // order — reordering the Variables tab reorders this list too.
      const next = new Map<string, SessionVariable>()
      let dirty = false

      for (const v of source) {
        if (!v.name) continue
        const entry = entries.get(v.name)
        if (!entry) {
          next.set(v.name, fresh(v))
          dirty = true
          continue
        }
        // A retyped variable can't keep a value encoded for the old type.
        if (entry.type !== v.type) {
          entry.type = v.type
          entry.initial = v.initialValue
          entry.current = v.initialValue
          dirty = true
        } else if (entry.initial !== v.initialValue) {
          // The document moved; the live value belongs to the session and stays put.
          entry.initial = v.initialValue
          dirty = true
        }
        next.set(v.name, entry)
      }

      if (!dirty) {
        // Same membership either way here: an addition would have set `dirty` already.
        const before = [...entries.keys()]
        const after = [...next.keys()]
        dirty = before.length !== after.length || before.some((name, i) => name !== after[i])
      }

      entries = next
      if (dirty) changed()
    },

    isDirty: () => [...entries.values()].some(e => e.current !== e.initial),

    getVersion: () => version,

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
