/**
 * Tests for the runtime variable store.
 *
 * The property that matters most: a run works against this store and never against the
 * authored `UserVariable[]`, and a write is visible to the very next read.
 */

import { describe, it, expect, vi } from 'vitest'
import { createSessionState } from '../lib/sessionState'
import type { UserVariable } from '../types'

function vars(...entries: [name: string, type: UserVariable['type'], value: string][]): UserVariable[] {
  return entries.map(([name, type, initialValue], i) => ({ id: `var-${i}`, name, type, initialValue }))
}

describe('createSessionState', () => {
  describe('seeding', () => {
    it('starts every value at its authored one', () => {
      const s = createSessionState(vars(['counter', 'u16', '7'], ['buf', 'hex', 'AA BB']))

      expect(s.list()).toEqual([
        { name: 'counter', type: 'u16', initial: '7', current: '7' },
        { name: 'buf', type: 'hex', initial: 'AA BB', current: 'AA BB' },
      ])
      expect(s.isDirty()).toBe(false)
    })

    it('skips unnamed variables', () => {
      expect(createSessionState(vars(['', 'u8', '1'])).list()).toEqual([])
    })

    it('starts empty with no variables', () => {
      expect(createSessionState().list()).toEqual([])
    })
  })

  describe('writes', () => {
    it('is readable immediately after a write', () => {
      const s = createSessionState(vars(['counter', 'u16', '0']))

      s.set('counter', '1')

      expect(s.get('counter')).toBe('1')
      expect(s.isDirty()).toBe(true)
    })

    it('leaves the authored variables untouched', () => {
      const authored = vars(['counter', 'u16', '0'])
      const s = createSessionState(authored)

      s.set('counter', '99')

      expect(authored[0].initialValue).toBe('0')
      expect(s.list()[0].initial).toBe('0')
    })

    it('ignores unknown names', () => {
      const s = createSessionState(vars(['counter', 'u16', '0']))

      s.set('nope', '1')

      expect(s.get('nope')).toBeUndefined()
      expect(s.list()).toHaveLength(1)
    })

    it('does not notify when the value is unchanged', () => {
      const s = createSessionState(vars(['counter', 'u16', '0']))
      const listener = vi.fn()
      s.subscribe(listener)

      s.set('counter', '0')

      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('reseed', () => {
    it('drops live values and takes the authored ones', () => {
      const s = createSessionState(vars(['counter', 'u16', '0']))
      s.set('counter', '42')

      s.reseed(vars(['counter', 'u16', '5']))

      expect(s.get('counter')).toBe('5')
      expect(s.isDirty()).toBe(false)
    })
  })

  describe('sync', () => {
    it('adds a new variable at its authored value', () => {
      const s = createSessionState(vars(['a', 'u8', '1']))

      s.sync(vars(['a', 'u8', '1'], ['b', 'u8', '2']))

      expect(s.get('b')).toBe('2')
    })

    it('removes a deleted variable', () => {
      const s = createSessionState(vars(['a', 'u8', '1'], ['b', 'u8', '2']))

      s.sync(vars(['a', 'u8', '1']))

      expect(s.list().map(v => v.name)).toEqual(['a'])
    })

    it('keeps the live value when only the authored value changed', () => {
      const s = createSessionState(vars(['a', 'u8', '1']))
      s.set('a', '9')

      s.sync(vars(['a', 'u8', '3']))

      expect(s.list()[0]).toEqual({ name: 'a', type: 'u8', initial: '3', current: '9' })
    })

    it('resets a retyped variable — the old encoding no longer applies', () => {
      const s = createSessionState(vars(['a', 'u8', '1']))
      s.set('a', '9')

      s.sync(vars(['a', 'hex', 'FF']))

      expect(s.list()[0]).toEqual({ name: 'a', type: 'hex', initial: 'FF', current: 'FF' })
    })

    it('treats a rename as remove plus add', () => {
      const s = createSessionState(vars(['a', 'u8', '1']))
      s.set('a', '9')

      s.sync(vars(['b', 'u8', '1']))

      expect(s.list()).toEqual([{ name: 'b', type: 'u8', initial: '1', current: '1' }])
    })

    it('follows the authored order', () => {
      const s = createSessionState(vars(['a', 'u8', '1'], ['b', 'u8', '2']))

      s.sync(vars(['b', 'u8', '2'], ['a', 'u8', '1']))

      expect(s.list().map(v => v.name)).toEqual(['b', 'a'])
    })

    it('does not notify when nothing changed', () => {
      const s = createSessionState(vars(['a', 'u8', '1']))
      const listener = vi.fn()
      s.subscribe(listener)

      s.sync(vars(['a', 'u8', '1']))

      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('subscription', () => {
    it('bumps the version and notifies on change', () => {
      const s = createSessionState(vars(['a', 'u8', '1']))
      const listener = vi.fn()
      const before = s.getVersion()
      const unsubscribe = s.subscribe(listener)

      s.set('a', '2')

      expect(listener).toHaveBeenCalledTimes(1)
      expect(s.getVersion()).toBeGreaterThan(before)

      unsubscribe()
      s.set('a', '3')
      expect(listener).toHaveBeenCalledTimes(1)
    })
  })
})
