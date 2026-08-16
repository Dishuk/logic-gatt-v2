/**
 * Tests for executor and sandbox logic.
 * Tests the synchronous executor and helper functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildContext, executeFunctionSync } from '../lib/executor'
import type { UserFunction, UserVariable } from '../types'

// Helper to create a function
function fn(name: string, body: string): UserFunction {
  return { id: crypto.randomUUID(), name, body }
}

// Helper to create variables
function vars(...defs: [string, 'hex' | 'u8' | 'u16' | 'u32' | 'string', string][]): UserVariable[] {
  return defs.map(([name, type, initialValue]) => ({
    id: crypto.randomUUID(),
    name,
    type,
    initialValue,
  }))
}

describe('executeFunctionSync', () => {
  const mockLog = vi.fn()
  const mockCtx = { log: mockLog, getVar: () => undefined, setVar: () => {} }

  beforeEach(() => {
    mockLog.mockClear()
  })

  describe('basic execution', () => {
    it('should return input unchanged (echo)', () => {
      const result = executeFunctionSync(fn('echo', 'return input;'), new Uint8Array([0xaa, 0xbb]), mockCtx)
      expect(result).toEqual(new Uint8Array([0xaa, 0xbb]))
    })

    it('should reverse input', () => {
      const result = executeFunctionSync(
        fn('reverse', 'return new Uint8Array([...input].reverse());'),
        new Uint8Array([1, 2, 3]),
        mockCtx
      )
      expect(result).toEqual(new Uint8Array([3, 2, 1]))
    })

    it('should handle empty input', () => {
      const result = executeFunctionSync(fn('echo', 'return input;'), new Uint8Array([]), mockCtx)
      expect(result).toEqual(new Uint8Array([]))
    })

    it('should transform input (XOR)', () => {
      const result = executeFunctionSync(
        fn('xor', 'return new Uint8Array(input.map(b => b ^ 0xFF));'),
        new Uint8Array([0x00, 0xff, 0x55]),
        mockCtx
      )
      expect(result).toEqual(new Uint8Array([0xff, 0x00, 0xaa]))
    })
  })

  describe('return values', () => {
    it('should return null when function returns null', () => {
      const result = executeFunctionSync(fn('nullFn', 'return null;'), new Uint8Array([0xaa]), mockCtx)
      expect(result).toBeNull()
    })

    it('should return null when function has no return', () => {
      const result = executeFunctionSync(fn('noReturn', 'const x = 1;'), new Uint8Array([0xaa]), mockCtx)
      expect(result).toBeNull()
    })

    it('should return null and log warning for non-Uint8Array return', () => {
      const result = executeFunctionSync(fn('badReturn', 'return [1, 2, 3];'), new Uint8Array([]), mockCtx)
      expect(result).toBeNull()
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('non-Uint8Array'))
    })

    it('should return null and log warning for string return', () => {
      const result = executeFunctionSync(fn('stringReturn', 'return "hello";'), new Uint8Array([]), mockCtx)
      expect(result).toBeNull()
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('non-Uint8Array'))
    })
  })

  describe('error handling', () => {
    it('should catch and log thrown errors', () => {
      const result = executeFunctionSync(fn('throwFn', 'throw new Error("Test error");'), new Uint8Array([]), mockCtx)
      expect(result).toBeNull()
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Test error'))
    })

    it('should catch syntax errors', () => {
      const result = executeFunctionSync(fn('syntaxErr', 'return {{{'), new Uint8Array([]), mockCtx)
      expect(result).toBeNull()
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Error'))
    })

    it('should catch reference errors', () => {
      const result = executeFunctionSync(fn('refErr', 'return undefinedVariable;'), new Uint8Array([]), mockCtx)
      expect(result).toBeNull()
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Error'))
    })
  })

  describe('console logging', () => {
    it('should capture console.log', () => {
      executeFunctionSync(fn('logFn', 'console.log("hello"); return input;'), new Uint8Array([]), mockCtx)
      expect(mockLog).toHaveBeenCalledWith('hello')
    })

    it('should capture console.warn with prefix', () => {
      executeFunctionSync(fn('warnFn', 'console.warn("warning"); return input;'), new Uint8Array([]), mockCtx)
      expect(mockLog).toHaveBeenCalledWith('[warn] warning')
    })

    it('should capture console.error with prefix', () => {
      executeFunctionSync(fn('errorFn', 'console.error("error"); return input;'), new Uint8Array([]), mockCtx)
      expect(mockLog).toHaveBeenCalledWith('[error] error')
    })

    it('should format multiple arguments', () => {
      executeFunctionSync(fn('multiLog', 'console.log("a", 123, true); return input;'), new Uint8Array([]), mockCtx)
      expect(mockLog).toHaveBeenCalledWith('a 123 true')
    })

    it('should stringify objects', () => {
      executeFunctionSync(fn('objLog', 'console.log({foo: "bar"}); return input;'), new Uint8Array([]), mockCtx)
      expect(mockLog).toHaveBeenCalledWith('{"foo":"bar"}')
    })
  })
})

describe('buildContext', () => {
  describe('getVar', () => {
    it('should return hex variable as Uint8Array', () => {
      const variables = vars(['buf', 'hex', 'CA FE'])
      const log = vi.fn()
      const setVars = vi.fn()
      const ctx = buildContext(variables, setVars, log)

      const result = ctx.getVar('buf')
      expect(result).toEqual(new Uint8Array([0xca, 0xfe]))
    })

    it('should return u8 variable as number', () => {
      const variables = vars(['val', 'u8', '42'])
      const ctx = buildContext(variables, vi.fn(), vi.fn())

      expect(ctx.getVar('val')).toBe(42)
    })

    it('should return u16 variable as number', () => {
      const variables = vars(['val', 'u16', '1000'])
      const ctx = buildContext(variables, vi.fn(), vi.fn())

      expect(ctx.getVar('val')).toBe(1000)
    })

    it('should return u32 variable as number', () => {
      const variables = vars(['val', 'u32', '100000'])
      const ctx = buildContext(variables, vi.fn(), vi.fn())

      expect(ctx.getVar('val')).toBe(100000)
    })

    it('should return string variable as string', () => {
      const variables = vars(['str', 'string', 'hello'])
      const ctx = buildContext(variables, vi.fn(), vi.fn())

      expect(ctx.getVar('str')).toBe('hello')
    })

    it('should return undefined and log for unknown variable', () => {
      const log = vi.fn()
      const ctx = buildContext([], vi.fn(), log)

      expect(ctx.getVar('unknown')).toBeUndefined()
      expect(log).toHaveBeenCalledWith(expect.stringContaining('unknown variable'))
    })

    it('should handle hex without spaces', () => {
      const variables = vars(['buf', 'hex', 'DEADBEEF'])
      const ctx = buildContext(variables, vi.fn(), vi.fn())

      expect(ctx.getVar('buf')).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
    })
  })

  describe('setVar', () => {
    it('should set hex variable from Uint8Array', () => {
      const variables = vars(['buf', 'hex', '00'])
      const setVars = vi.fn()
      const ctx = buildContext(variables, setVars, vi.fn())

      ctx.setVar('buf', new Uint8Array([0xab, 0xcd]))

      expect(setVars).toHaveBeenCalled()
      const updated = setVars.mock.calls[0][0]
      expect(updated[0].initialValue).toBe('AB CD')
    })

    it('should set u8 variable from number', () => {
      const variables = vars(['val', 'u8', '0'])
      const setVars = vi.fn()
      const ctx = buildContext(variables, setVars, vi.fn())

      ctx.setVar('val', 255)

      const updated = setVars.mock.calls[0][0]
      expect(updated[0].initialValue).toBe('255')
    })

    it('should reject invalid type for hex', () => {
      const variables = vars(['buf', 'hex', '00'])
      const log = vi.fn()
      const setVars = vi.fn()
      const ctx = buildContext(variables, setVars, log)

      ctx.setVar('buf', 'not a Uint8Array')

      expect(setVars).not.toHaveBeenCalled()
      expect(log).toHaveBeenCalledWith(expect.stringContaining('expected Uint8Array'))
    })

    it('should reject u8 out of range', () => {
      const variables = vars(['val', 'u8', '0'])
      const log = vi.fn()
      const setVars = vi.fn()
      const ctx = buildContext(variables, setVars, log)

      ctx.setVar('val', 256)

      expect(setVars).not.toHaveBeenCalled()
      expect(log).toHaveBeenCalledWith(expect.stringContaining('out of range'))
    })

    it('should reject u16 out of range', () => {
      const variables = vars(['val', 'u16', '0'])
      const log = vi.fn()
      const setVars = vi.fn()
      const ctx = buildContext(variables, setVars, log)

      ctx.setVar('val', 65536)

      expect(setVars).not.toHaveBeenCalled()
      expect(log).toHaveBeenCalledWith(expect.stringContaining('out of range'))
    })

    it('should reject u32 out of range', () => {
      const variables = vars(['val', 'u32', '0'])
      const log = vi.fn()
      const setVars = vi.fn()
      const ctx = buildContext(variables, setVars, log)

      ctx.setVar('val', 0x100000000)

      expect(setVars).not.toHaveBeenCalled()
      expect(log).toHaveBeenCalledWith(expect.stringContaining('out of range'))
    })

    it('should reject non-integer for u8', () => {
      const variables = vars(['val', 'u8', '0'])
      const log = vi.fn()
      const setVars = vi.fn()
      const ctx = buildContext(variables, setVars, log)

      ctx.setVar('val', 3.14)

      expect(setVars).not.toHaveBeenCalled()
      expect(log).toHaveBeenCalledWith(expect.stringContaining('expected integer'))
    })

    it('should reject non-string for string type', () => {
      const variables = vars(['str', 'string', ''])
      const log = vi.fn()
      const setVars = vi.fn()
      const ctx = buildContext(variables, setVars, log)

      ctx.setVar('str', 123)

      expect(setVars).not.toHaveBeenCalled()
      expect(log).toHaveBeenCalledWith(expect.stringContaining('expected string'))
    })

    it('should log for unknown variable', () => {
      const log = vi.fn()
      const ctx = buildContext([], vi.fn(), log)

      ctx.setVar('unknown', 123)

      expect(log).toHaveBeenCalledWith(expect.stringContaining('unknown variable'))
    })
  })

  describe('log', () => {
    it('should forward messages to log callback', () => {
      const log = vi.fn()
      const ctx = buildContext([], vi.fn(), log)

      ctx.log('test message')

      expect(log).toHaveBeenCalledWith('test message')
    })
  })
})

describe('integration: executeFunctionSync with context', () => {
  it('should read and write variables', () => {
    const variables = vars(['counter', 'u32', '5'])
    const setVars = vi.fn()
    const log = vi.fn()
    const ctx = buildContext(variables, setVars, log)

    const result = executeFunctionSync(
      fn(
        'increment',
        `
        const val = ctx.getVar('counter');
        ctx.setVar('counter', val + 1);
        return new Uint8Array([val + 1]);
      `
      ),
      new Uint8Array([]),
      ctx
    )

    expect(result).toEqual(new Uint8Array([6]))
    expect(setVars).toHaveBeenCalled()
  })

  it('should handle multiple variable operations', () => {
    const variables = vars(['a', 'u8', '10'], ['b', 'u8', '20'])
    const setVars = vi.fn()
    const log = vi.fn()
    const ctx = buildContext(variables, setVars, log)

    const result = executeFunctionSync(
      fn(
        'sum',
        `
        const a = ctx.getVar('a');
        const b = ctx.getVar('b');
        return new Uint8Array([a + b]);
      `
      ),
      new Uint8Array([]),
      ctx
    )

    expect(result).toEqual(new Uint8Array([30]))
  })

  it('should handle hex buffer manipulation', () => {
    const variables = vars(['buf', 'hex', 'AA BB CC'])
    const setVars = vi.fn()
    const log = vi.fn()
    const ctx = buildContext(variables, setVars, log)

    const result = executeFunctionSync(
      fn(
        'appendInput',
        `
        const buf = ctx.getVar('buf');
        const result = new Uint8Array(buf.length + input.length);
        result.set(buf);
        result.set(input, buf.length);
        return result;
      `
      ),
      new Uint8Array([0xdd, 0xee]),
      ctx
    )

    expect(result).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd, 0xee]))
  })
})
