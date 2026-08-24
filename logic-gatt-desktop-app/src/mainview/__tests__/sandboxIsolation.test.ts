/**
 * Escape-vector regression tests. Isolated in its own file because
 * `sealEscapeHatches()` mutates realm globals.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { runSandboxed, sealEscapeHatches } from '../lib/sandbox'

beforeAll(() => sealEscapeHatches())

const run = (body: string) => runSandboxed({ body, input: [], variables: [], scenarioNames: [] })

describe('sandbox isolation', () => {
  const escapes: [string, string][] = [
    ['Function constructor', "return (function(){}).constructor('return globalThis')();"],
    ['constructor chain from a literal', "return ''.constructor.constructor('return globalThis')();"],
    ['async function constructor', "return (async function(){}).constructor('return globalThis');"],
    ['generator function constructor', "return (function*(){}).constructor('return globalThis');"],
    ['indirect eval', "return (0, eval)('globalThis');"],
    ['direct eval', "return eval('globalThis');"],
    ['sloppy-mode this', 'return this.fetch;'],
    ['globalThis', 'return globalThis.fetch;'],
    ['self', 'return self.fetch;'],
    ['bare fetch call', "return fetch('http://example.com');"],
    ['window', 'return window.document;'],
    ['importScripts', "return importScripts('http://example.com');"],
  ]

  for (const [name, body] of escapes) {
    it(`should block ${name}`, () => {
      const r = run(body)
      expect(r.error).toBeTruthy()
      expect(r.result).toBeNull()
    })
  }

  it('should still run legitimate code', () => {
    const r = run('const w = writer(); w.uint8(1).uint16BE(0x0203); return w.build();')
    expect(r.error).toBeNull()
    expect(r.result).toEqual([1, 2, 3])
  })

  it('should still expose standard built-ins', () => {
    const r = run('return new Uint8Array([JSON.parse("[7]")[0], Math.min(2, 9), typeof Date === "function" ? 1 : 0]);')
    expect(r.error).toBeNull()
    expect(r.result).toEqual([7, 2, 1])
  })
})
