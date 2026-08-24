/**
 * Tests for the sandboxed executor — exercises `runSandboxed`, the same code the
 * worker ships, rather than a reimplementation of it.
 */

import { describe, it, expect } from 'vitest'
import { runSandboxed, type SandboxResult } from '../lib/sandbox'
import type { UserVariable } from '../types'

function vars(...defs: [string, 'hex' | 'u8' | 'u16' | 'u32' | 'string', string][]): UserVariable[] {
  return defs.map(([name, type, initialValue]) => ({ id: crypto.randomUUID(), name, type, initialValue }))
}

function run(body: string, opts: { input?: number[]; variables?: UserVariable[]; scenarioNames?: string[] } = {}) {
  return runSandboxed({
    body,
    input: opts.input ?? [],
    variables: (opts.variables ?? []).map(v => ({ name: v.name, type: v.type, value: v.initialValue })),
    scenarioNames: opts.scenarioNames ?? [],
  })
}

const out = (r: SandboxResult) => (r.result ? new Uint8Array(r.result) : null)
const msgs = (r: SandboxResult) => r.logs.map(l => l.message)

describe('runSandboxed', () => {
  describe('basic execution', () => {
    it('should return input unchanged (echo)', () => {
      expect(out(run('return input;', { input: [0xaa, 0xbb] }))).toEqual(new Uint8Array([0xaa, 0xbb]))
    })

    it('should reverse input', () => {
      const r = run('return new Uint8Array([...input].reverse());', { input: [1, 2, 3] })
      expect(out(r)).toEqual(new Uint8Array([3, 2, 1]))
    })

    it('should handle empty input', () => {
      expect(out(run('return input;'))).toEqual(new Uint8Array([]))
    })

    it('should transform input (XOR)', () => {
      const r = run('return new Uint8Array(input.map(b => b ^ 0xFF));', { input: [0x00, 0xff, 0x55] })
      expect(out(r)).toEqual(new Uint8Array([0xff, 0x00, 0xaa]))
    })
  })

  describe('return values', () => {
    it('should return null when function returns null', () => {
      expect(out(run('return null;', { input: [0xaa] }))).toBeNull()
    })

    it('should return null when function has no return', () => {
      expect(out(run('const x = 1;', { input: [0xaa] }))).toBeNull()
    })

    it('should return null and warn for non-Uint8Array return', () => {
      const r = run('return [1, 2, 3];')
      expect(out(r)).toBeNull()
      expect(msgs(r).join()).toContain('non-Uint8Array')
    })

    it('should return null and warn for string return', () => {
      const r = run('return "hello";')
      expect(out(r)).toBeNull()
      expect(msgs(r).join()).toContain('non-Uint8Array')
    })
  })

  describe('error handling', () => {
    it('should catch thrown errors', () => {
      const r = run('throw new Error("Test error");')
      expect(out(r)).toBeNull()
      expect(r.error).toContain('Test error')
    })

    it('should catch syntax errors', () => {
      const r = run('return {{{')
      expect(out(r)).toBeNull()
      expect(r.error).toBeTruthy()
    })

    it('should catch reference errors', () => {
      const r = run('return undefinedVariable;')
      expect(out(r)).toBeNull()
      expect(r.error).toBeTruthy()
    })

    it('should keep logs emitted before a throw', () => {
      const r = run('console.log("before"); throw new Error("boom");')
      expect(msgs(r)).toContain('before')
      expect(r.error).toContain('boom')
    })
  })

  describe('console logging', () => {
    it('should capture console.log', () => {
      expect(msgs(run('console.log("hello"); return input;'))).toContain('hello')
    })

    it('should capture console.warn with prefix', () => {
      expect(msgs(run('console.warn("warning"); return input;'))).toContain('[warn] warning')
    })

    it('should capture console.error with prefix', () => {
      expect(msgs(run('console.error("error"); return input;'))).toContain('[error] error')
    })

    it('should capture console.info with prefix', () => {
      expect(msgs(run('console.info("info"); return input;'))).toContain('[info] info')
    })

    it('should format multiple arguments', () => {
      expect(msgs(run('console.log("a", 123, true); return input;'))).toContain('a 123 true')
    })

    it('should stringify objects', () => {
      expect(msgs(run('console.log({foo: "bar"}); return input;'))).toContain('{"foo":"bar"}')
    })
  })

  describe('ctx.getVar', () => {
    it('should return hex variable as Uint8Array', () => {
      const r = run("return ctx.getVar('buf');", { variables: vars(['buf', 'hex', 'CA FE']) })
      expect(out(r)).toEqual(new Uint8Array([0xca, 0xfe]))
    })

    it('should handle hex without spaces', () => {
      const r = run("return ctx.getVar('buf');", { variables: vars(['buf', 'hex', 'DEADBEEF']) })
      expect(out(r)).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
    })

    it('should return u8 variable as number', () => {
      const r = run("console.log(ctx.getVar('val'));", { variables: vars(['val', 'u8', '42']) })
      expect(msgs(r)).toContain('42')
    })

    it('should return u16 variable as number', () => {
      const r = run("console.log(ctx.getVar('val'));", { variables: vars(['val', 'u16', '1000']) })
      expect(msgs(r)).toContain('1000')
    })

    it('should return u32 variable as number', () => {
      const r = run("console.log(ctx.getVar('val'));", { variables: vars(['val', 'u32', '100000']) })
      expect(msgs(r)).toContain('100000')
    })

    it('should return string variable as string', () => {
      const r = run("console.log(ctx.getVar('str'));", { variables: vars(['str', 'string', 'hello']) })
      expect(msgs(r)).toContain('hello')
    })

    it('should return undefined and warn for unknown variable', () => {
      const r = run("console.log(String(ctx.getVar('nope')));")
      expect(msgs(r).join()).toContain('unknown variable')
      expect(msgs(r)).toContain('undefined')
    })
  })

  describe('ctx.setVar', () => {
    it('should set hex variable from Uint8Array', () => {
      const r = run("ctx.setVar('buf', new Uint8Array([0xAB, 0xCD]));", { variables: vars(['buf', 'hex', '00']) })
      expect(r.variableUpdates).toEqual([{ name: 'buf', value: 'AB CD' }])
    })

    it('should set u8 variable from number', () => {
      const r = run("ctx.setVar('val', 255);", { variables: vars(['val', 'u8', '0']) })
      expect(r.variableUpdates).toEqual([{ name: 'val', value: '255' }])
    })

    it('should reject invalid type for hex', () => {
      const r = run("ctx.setVar('buf', 'not a Uint8Array');", { variables: vars(['buf', 'hex', '00']) })
      expect(r.variableUpdates).toEqual([])
      expect(msgs(r).join()).toContain('expected Uint8Array')
    })

    it('should reject u8 out of range', () => {
      const r = run("ctx.setVar('val', 256);", { variables: vars(['val', 'u8', '0']) })
      expect(r.variableUpdates).toEqual([])
      expect(msgs(r).join()).toContain('out of range')
    })

    it('should reject u16 out of range', () => {
      const r = run("ctx.setVar('val', 65536);", { variables: vars(['val', 'u16', '0']) })
      expect(r.variableUpdates).toEqual([])
      expect(msgs(r).join()).toContain('out of range')
    })

    it('should reject u32 out of range', () => {
      const r = run("ctx.setVar('val', 0x100000000);", { variables: vars(['val', 'u32', '0']) })
      expect(r.variableUpdates).toEqual([])
      expect(msgs(r).join()).toContain('out of range')
    })

    it('should reject non-integer for u8', () => {
      const r = run("ctx.setVar('val', 3.14);", { variables: vars(['val', 'u8', '0']) })
      expect(r.variableUpdates).toEqual([])
      expect(msgs(r).join()).toContain('expected integer')
    })

    it('should reject non-string for string type', () => {
      const r = run("ctx.setVar('str', 123);", { variables: vars(['str', 'string', '']) })
      expect(r.variableUpdates).toEqual([])
      expect(msgs(r).join()).toContain('expected string')
    })

    it('should warn for unknown variable', () => {
      const r = run("ctx.setVar('unknown', 123);")
      expect(msgs(r).join()).toContain('unknown variable')
    })

    it('should make a set value visible to a later getVar in the same run', () => {
      const r = run("ctx.setVar('val', 7); return new Uint8Array([ctx.getVar('val')]);", {
        variables: vars(['val', 'u8', '0']),
      })
      expect(out(r)).toEqual(new Uint8Array([7]))
    })
  })

  describe('ctx.log and ctx.runScenario', () => {
    it('should forward ctx.log messages', () => {
      expect(msgs(run("ctx.log('test message');"))).toContain('test message')
    })

    it('should queue a known scenario', () => {
      const r = run("ctx.runScenario('blink');", { scenarioNames: ['blink'] })
      expect(r.scenarioRequests).toEqual(['blink'])
    })

    it('should reject an unknown scenario', () => {
      const r = run("ctx.runScenario('nope');", { scenarioNames: ['blink'] })
      expect(r.scenarioRequests).toEqual([])
      expect(msgs(r).join()).toContain('unknown scenario')
    })
  })

  describe('reader/writer', () => {
    it('should read integers of both endiannesses', () => {
      const r = run(
        'const rd = reader(input); const a = rd.uint16BE(); const b = rd.uint16LE(); return new Uint8Array([a >> 8, a & 0xff, b & 0xff, b >> 8]);',
        { input: [0x12, 0x34, 0x56, 0x78] }
      )
      expect(out(r)).toEqual(new Uint8Array([0x12, 0x34, 0x56, 0x78]))
    })

    it('should track position and remaining', () => {
      const r = run('const rd = reader(input); rd.skip(2); return new Uint8Array([rd.pos, rd.remaining()]);', {
        input: [1, 2, 3, 4, 5],
      })
      expect(out(r)).toEqual(new Uint8Array([2, 3]))
    })

    it('should build bytes with the writer', () => {
      const r = run('return writer().uint8(0x01).uint16BE(0x0203).bytes([0x04]).build();')
      expect(out(r)).toEqual(new Uint8Array([0x01, 0x02, 0x03, 0x04]))
    })

    it('should round-trip signed values', () => {
      const r = run(
        'const rd = reader(writer().int16LE(-2).build()); return new Uint8Array([rd.int16LE() === -2 ? 1 : 0]);'
      )
      expect(out(r)).toEqual(new Uint8Array([1]))
    })
  })
})
