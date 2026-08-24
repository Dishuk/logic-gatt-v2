/**
 * Tests for the sandbox's pure helpers, imported from `sandbox.ts` — the module the
 * worker ships — so a regression there fails here.
 */

import { describe, it, expect } from 'vitest'
import {
  blockedProxy,
  createReader,
  createWriter,
  parseVarValue,
  serializeVarValue,
  validateVarValue,
} from '../lib/sandbox'

describe('parseVarValue', () => {
  describe('hex type', () => {
    it('should parse hex with spaces', () => {
      const result = parseVarValue('hex', 'CA FE BA BE')
      expect(result).toEqual(new Uint8Array([0xca, 0xfe, 0xba, 0xbe]))
    })

    it('should parse hex without spaces', () => {
      const result = parseVarValue('hex', 'DEADBEEF')
      expect(result).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
    })

    it('should parse lowercase hex', () => {
      const result = parseVarValue('hex', 'aabbcc')
      expect(result).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc]))
    })

    it('should ignore non-hex characters', () => {
      const result = parseVarValue('hex', 'AB-CD:EF')
      expect(result).toEqual(new Uint8Array([0xab, 0xcd, 0xef]))
    })

    it('should return empty array for empty string', () => {
      const result = parseVarValue('hex', '')
      expect(result).toEqual(new Uint8Array([]))
    })

    it('should handle single byte', () => {
      const result = parseVarValue('hex', 'FF')
      expect(result).toEqual(new Uint8Array([0xff]))
    })

    it('should ignore a trailing half-byte', () => {
      // One shared reader (@shared/hex) for every path, and its rule is that hex is
      // read in pairs. Nothing is lost in practice: a value typed into a hex field is
      // committed through normalizeHex, which pads 'ABC' to 'AB 0C' first.
      const result = parseVarValue('hex', 'ABC')
      expect(result).toEqual(new Uint8Array([0xab]))
    })
  })

  describe('u8 type', () => {
    it('should parse zero', () => {
      expect(parseVarValue('u8', '0')).toBe(0)
    })

    it('should parse positive number', () => {
      expect(parseVarValue('u8', '255')).toBe(255)
    })

    it('should return 0 for invalid string', () => {
      expect(parseVarValue('u8', 'abc')).toBe(0)
    })

    it('should return 0 for empty string', () => {
      expect(parseVarValue('u8', '')).toBe(0)
    })
  })

  describe('u16 type', () => {
    it('should parse u16 value', () => {
      expect(parseVarValue('u16', '65535')).toBe(65535)
    })
  })

  describe('u32 type', () => {
    it('should parse u32 value', () => {
      expect(parseVarValue('u32', '4294967295')).toBe(4294967295)
    })
  })

  describe('string type', () => {
    it('should return string as-is', () => {
      expect(parseVarValue('string', 'hello world')).toBe('hello world')
    })

    it('should return empty string', () => {
      expect(parseVarValue('string', '')).toBe('')
    })

    it('should preserve special characters', () => {
      expect(parseVarValue('string', 'test\n\ttab')).toBe('test\n\ttab')
    })
  })
})

describe('serializeVarValue', () => {
  describe('hex type', () => {
    it('should serialize Uint8Array with spaces', () => {
      const result = serializeVarValue('hex', new Uint8Array([0xab, 0xcd, 0xef]))
      expect(result).toBe('AB CD EF')
    })

    it('should serialize single byte', () => {
      const result = serializeVarValue('hex', new Uint8Array([0x0f]))
      expect(result).toBe('0F')
    })

    it('should serialize empty array', () => {
      const result = serializeVarValue('hex', new Uint8Array([]))
      expect(result).toBe('')
    })

    it('should pad single digit hex', () => {
      const result = serializeVarValue('hex', new Uint8Array([0x00, 0x01, 0x0a]))
      expect(result).toBe('00 01 0A')
    })
  })

  describe('numeric types', () => {
    it('should serialize u8 as string', () => {
      expect(serializeVarValue('u8', 42)).toBe('42')
    })

    it('should serialize u16 as string', () => {
      expect(serializeVarValue('u16', 1000)).toBe('1000')
    })

    it('should serialize u32 as string', () => {
      expect(serializeVarValue('u32', 100000)).toBe('100000')
    })
  })

  describe('string type', () => {
    it('should return string as-is', () => {
      expect(serializeVarValue('string', 'hello')).toBe('hello')
    })
  })
})

describe('validateVarValue', () => {
  describe('hex type', () => {
    it('should accept Uint8Array', () => {
      expect(validateVarValue('hex', new Uint8Array([0xab]))).toBeNull()
    })

    it('should reject array', () => {
      expect(validateVarValue('hex', [0xab])).toContain('expected Uint8Array')
    })

    it('should reject string', () => {
      expect(validateVarValue('hex', 'AB CD')).toContain('expected Uint8Array')
    })

    it('should reject number', () => {
      expect(validateVarValue('hex', 123)).toContain('expected Uint8Array')
    })
  })

  describe('u8 type', () => {
    it('should accept 0', () => {
      expect(validateVarValue('u8', 0)).toBeNull()
    })

    it('should accept 255', () => {
      expect(validateVarValue('u8', 255)).toBeNull()
    })

    it('should reject 256', () => {
      expect(validateVarValue('u8', 256)).toContain('out of range')
    })

    it('should reject negative', () => {
      expect(validateVarValue('u8', -1)).toContain('out of range')
    })

    it('should reject float', () => {
      expect(validateVarValue('u8', 3.14)).toContain('expected integer')
    })

    it('should reject string', () => {
      expect(validateVarValue('u8', '42')).toContain('expected integer')
    })
  })

  describe('u16 type', () => {
    it('should accept 0', () => {
      expect(validateVarValue('u16', 0)).toBeNull()
    })

    it('should accept 65535', () => {
      expect(validateVarValue('u16', 65535)).toBeNull()
    })

    it('should reject 65536', () => {
      expect(validateVarValue('u16', 65536)).toContain('out of range')
    })

    it('should reject negative', () => {
      expect(validateVarValue('u16', -1)).toContain('out of range')
    })
  })

  describe('u32 type', () => {
    it('should accept 0', () => {
      expect(validateVarValue('u32', 0)).toBeNull()
    })

    it('should accept max u32', () => {
      expect(validateVarValue('u32', 0xffffffff)).toBeNull()
    })

    it('should reject max u32 + 1', () => {
      expect(validateVarValue('u32', 0x100000000)).toContain('out of range')
    })

    it('should reject negative', () => {
      expect(validateVarValue('u32', -1)).toContain('out of range')
    })
  })

  describe('string type', () => {
    it('should accept string', () => {
      expect(validateVarValue('string', 'hello')).toBeNull()
    })

    it('should accept empty string', () => {
      expect(validateVarValue('string', '')).toBeNull()
    })

    it('should reject number', () => {
      expect(validateVarValue('string', 123)).toContain('expected string')
    })

    it('should reject null', () => {
      expect(validateVarValue('string', null)).toContain('expected string')
    })
  })
})

describe('roundtrip: parse -> serialize', () => {
  it('should roundtrip hex value', () => {
    const original = 'AB CD EF'
    const parsed = parseVarValue('hex', original)
    const serialized = serializeVarValue('hex', parsed)
    expect(serialized).toBe(original)
  })

  it('should roundtrip u8 value', () => {
    const original = '123'
    const parsed = parseVarValue('u8', original)
    const serialized = serializeVarValue('u8', parsed)
    expect(serialized).toBe(original)
  })

  it('should roundtrip u32 value', () => {
    const original = '4294967295'
    const parsed = parseVarValue('u32', original)
    const serialized = serializeVarValue('u32', parsed)
    expect(serialized).toBe(original)
  })

  it('should roundtrip string value', () => {
    const original = 'hello world'
    const parsed = parseVarValue('string', original)
    const serialized = serializeVarValue('string', parsed)
    expect(serialized).toBe(original)
  })
})

describe('blockedProxy', () => {
  it('should throw on property access', () => {
    expect(() => (blockedProxy as Record<string, unknown>).fetch).toThrow('blocked in sandbox')
  })

  it('should throw on property set', () => {
    expect(() => {
      ;(blockedProxy as Record<string, unknown>).foo = 'bar'
    }).toThrow('blocked in sandbox')
  })

  it('should include property name in error', () => {
    expect(() => (blockedProxy as Record<string, unknown>).localStorage).toThrow('localStorage')
  })
})

// ─── Binary Reader/Writer Tests ─────────────────────────────────────────────

describe('BinaryReader', () => {
  describe('uint8', () => {
    it('should read single byte', () => {
      const r = createReader(new Uint8Array([0x42]))
      expect(r.uint8()).toBe(0x42)
    })

    it('should advance position', () => {
      const r = createReader(new Uint8Array([0x01, 0x02, 0x03]))
      expect(r.uint8()).toBe(0x01)
      expect(r.uint8()).toBe(0x02)
      expect(r.pos).toBe(2)
    })
  })

  describe('int8', () => {
    it('should read signed byte', () => {
      const r = createReader(new Uint8Array([0xff]))
      expect(r.int8()).toBe(-1)
    })

    it('should read positive signed byte', () => {
      const r = createReader(new Uint8Array([0x7f]))
      expect(r.int8()).toBe(127)
    })
  })

  describe('uint16LE/uint16BE', () => {
    it('should read little-endian uint16', () => {
      const r = createReader(new Uint8Array([0x34, 0x12]))
      expect(r.uint16LE()).toBe(0x1234)
    })

    it('should read big-endian uint16', () => {
      const r = createReader(new Uint8Array([0x12, 0x34]))
      expect(r.uint16BE()).toBe(0x1234)
    })
  })

  describe('int16LE/int16BE', () => {
    it('should read signed little-endian int16', () => {
      const r = createReader(new Uint8Array([0xff, 0xff]))
      expect(r.int16LE()).toBe(-1)
    })

    it('should read signed big-endian int16', () => {
      const r = createReader(new Uint8Array([0xff, 0xff]))
      expect(r.int16BE()).toBe(-1)
    })
  })

  describe('uint32LE/uint32BE', () => {
    it('should read little-endian uint32', () => {
      const r = createReader(new Uint8Array([0xef, 0xbe, 0xad, 0xde]))
      expect(r.uint32LE()).toBe(0xdeadbeef)
    })

    it('should read big-endian uint32', () => {
      const r = createReader(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
      expect(r.uint32BE()).toBe(0xdeadbeef)
    })
  })

  describe('int32LE/int32BE', () => {
    it('should read signed little-endian int32', () => {
      const r = createReader(new Uint8Array([0xff, 0xff, 0xff, 0xff]))
      expect(r.int32LE()).toBe(-1)
    })

    it('should read signed big-endian int32', () => {
      const r = createReader(new Uint8Array([0xff, 0xff, 0xff, 0xff]))
      expect(r.int32BE()).toBe(-1)
    })
  })

  describe('uintLE/uintBE (variable length)', () => {
    it('should read 3-byte little-endian', () => {
      const r = createReader(new Uint8Array([0x56, 0x34, 0x12]))
      expect(r.uintLE(3)).toBe(0x123456)
    })

    it('should read 3-byte big-endian', () => {
      const r = createReader(new Uint8Array([0x12, 0x34, 0x56]))
      expect(r.uintBE(3)).toBe(0x123456)
    })

    it('should read 8-byte as bigint', () => {
      const r = createReader(new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]))
      expect(r.uintLE(8)).toBe(0x0807060504030201n)
    })
  })

  describe('intLE/intBE (variable length signed)', () => {
    it('should read negative 3-byte little-endian', () => {
      const r = createReader(new Uint8Array([0xff, 0xff, 0xff]))
      expect(r.intLE(3)).toBe(-1)
    })

    it('should read negative 3-byte big-endian', () => {
      const r = createReader(new Uint8Array([0xff, 0xff, 0xff]))
      expect(r.intBE(3)).toBe(-1)
    })
  })

  describe('bytes', () => {
    it('should read N bytes', () => {
      const r = createReader(new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]))
      expect(r.bytes(3)).toEqual(new Uint8Array([0x01, 0x02, 0x03]))
      expect(r.pos).toBe(3)
    })

    it('should read remaining bytes', () => {
      const r = createReader(new Uint8Array([0xaa, 0xbb]))
      r.skip(1)
      expect(r.bytes(1)).toEqual(new Uint8Array([0xbb]))
    })
  })

  describe('skip', () => {
    it('should advance position', () => {
      const r = createReader(new Uint8Array([0x01, 0x02, 0x03, 0x04]))
      r.skip(2)
      expect(r.uint8()).toBe(0x03)
    })
  })

  describe('remaining', () => {
    it('should return bytes left', () => {
      const r = createReader(new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]))
      expect(r.remaining()).toBe(5)
      r.uint16LE()
      expect(r.remaining()).toBe(3)
    })
  })

  describe('pos', () => {
    it('should be readable', () => {
      const r = createReader(new Uint8Array([0x01, 0x02]))
      expect(r.pos).toBe(0)
      r.uint8()
      expect(r.pos).toBe(1)
    })

    it('should be writable', () => {
      const r = createReader(new Uint8Array([0x01, 0x02, 0x03]))
      r.pos = 2
      expect(r.uint8()).toBe(0x03)
    })
  })

  describe('protocol parsing', () => {
    it('should parse [cmd:uint8][id:uint16LE][len:uint8][payload]', () => {
      // cmd=0x05, id=0x1234, len=3, payload=AA BB CC
      const r = createReader(new Uint8Array([0x05, 0x34, 0x12, 0x03, 0xaa, 0xbb, 0xcc]))
      expect(r.uint8()).toBe(0x05)
      expect(r.uint16LE()).toBe(0x1234)
      const len = r.uint8()
      expect(len).toBe(3)
      expect(r.bytes(len)).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc]))
    })
  })
})

describe('BinaryWriter', () => {
  describe('uint8', () => {
    it('should write single byte', () => {
      const w = createWriter()
      expect(w.uint8(0x42).build()).toEqual(new Uint8Array([0x42]))
    })

    it('should mask to 8 bits', () => {
      const w = createWriter()
      expect(w.uint8(0x1ff).build()).toEqual(new Uint8Array([0xff]))
    })
  })

  describe('int8', () => {
    it('should write signed byte', () => {
      const w = createWriter()
      expect(w.int8(-1).build()).toEqual(new Uint8Array([0xff]))
    })
  })

  describe('uint16LE/uint16BE', () => {
    it('should write little-endian', () => {
      const w = createWriter()
      expect(w.uint16LE(0x1234).build()).toEqual(new Uint8Array([0x34, 0x12]))
    })

    it('should write big-endian', () => {
      const w = createWriter()
      expect(w.uint16BE(0x1234).build()).toEqual(new Uint8Array([0x12, 0x34]))
    })
  })

  describe('int16LE/int16BE', () => {
    it('should write signed little-endian', () => {
      const w = createWriter()
      expect(w.int16LE(-1).build()).toEqual(new Uint8Array([0xff, 0xff]))
    })

    it('should write signed big-endian', () => {
      const w = createWriter()
      expect(w.int16BE(-1).build()).toEqual(new Uint8Array([0xff, 0xff]))
    })
  })

  describe('uint32LE/uint32BE', () => {
    it('should write little-endian', () => {
      const w = createWriter()
      expect(w.uint32LE(0xdeadbeef).build()).toEqual(new Uint8Array([0xef, 0xbe, 0xad, 0xde]))
    })

    it('should write big-endian', () => {
      const w = createWriter()
      expect(w.uint32BE(0xdeadbeef).build()).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
    })
  })

  describe('int32LE/int32BE', () => {
    it('should write signed little-endian', () => {
      const w = createWriter()
      expect(w.int32LE(-1).build()).toEqual(new Uint8Array([0xff, 0xff, 0xff, 0xff]))
    })

    it('should write signed big-endian', () => {
      const w = createWriter()
      expect(w.int32BE(-1).build()).toEqual(new Uint8Array([0xff, 0xff, 0xff, 0xff]))
    })
  })

  describe('uintLE/uintBE (variable length)', () => {
    it('should write 3-byte little-endian', () => {
      const w = createWriter()
      expect(w.uintLE(0x123456, 3).build()).toEqual(new Uint8Array([0x56, 0x34, 0x12]))
    })

    it('should write 3-byte big-endian', () => {
      const w = createWriter()
      expect(w.uintBE(0x123456, 3).build()).toEqual(new Uint8Array([0x12, 0x34, 0x56]))
    })

    it('should write 8-byte bigint', () => {
      const w = createWriter()
      expect(w.uintLE(0x0807060504030201n, 8).build()).toEqual(
        new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])
      )
    })
  })

  describe('intLE/intBE (variable length signed)', () => {
    it('should write negative 3-byte little-endian', () => {
      const w = createWriter()
      expect(w.intLE(-1, 3).build()).toEqual(new Uint8Array([0xff, 0xff, 0xff]))
    })

    it('should write negative 3-byte big-endian', () => {
      const w = createWriter()
      expect(w.intBE(-1, 3).build()).toEqual(new Uint8Array([0xff, 0xff, 0xff]))
    })
  })

  describe('bytes', () => {
    it('should write Uint8Array', () => {
      const w = createWriter()
      w.bytes(new Uint8Array([0x01, 0x02, 0x03]))
      expect(w.build()).toEqual(new Uint8Array([0x01, 0x02, 0x03]))
    })

    it('should write number array', () => {
      const w = createWriter()
      w.bytes([0xaa, 0xbb])
      expect(w.build()).toEqual(new Uint8Array([0xaa, 0xbb]))
    })
  })

  describe('chaining', () => {
    it('should support method chaining', () => {
      const result = createWriter().uint8(0x01).uint16LE(0x0203).uint32LE(0x04050607).build()
      expect(result).toEqual(new Uint8Array([0x01, 0x03, 0x02, 0x07, 0x06, 0x05, 0x04]))
    })
  })

  describe('protocol building', () => {
    it('should build [status:uint8][id:uint16LE][data]', () => {
      const w = createWriter()
      w.uint8(0x00) // status OK
      w.uint16LE(0x1234) // id
      w.bytes([0xde, 0xad]) // data
      expect(w.build()).toEqual(new Uint8Array([0x00, 0x34, 0x12, 0xde, 0xad]))
    })
  })
})

describe('Reader/Writer roundtrip', () => {
  it('should roundtrip uint8', () => {
    const original = 0x42
    const w = createWriter().uint8(original)
    const r = createReader(w.build())
    expect(r.uint8()).toBe(original)
  })

  it('should roundtrip int8', () => {
    const original = -42
    const w = createWriter().int8(original)
    const r = createReader(w.build())
    expect(r.int8()).toBe(original)
  })

  it('should roundtrip uint16LE', () => {
    const original = 0x1234
    const w = createWriter().uint16LE(original)
    const r = createReader(w.build())
    expect(r.uint16LE()).toBe(original)
  })

  it('should roundtrip int16LE', () => {
    const original = -1234
    const w = createWriter().int16LE(original)
    const r = createReader(w.build())
    expect(r.int16LE()).toBe(original)
  })

  it('should roundtrip uint32LE', () => {
    const original = 0xdeadbeef
    const w = createWriter().uint32LE(original)
    const r = createReader(w.build())
    expect(r.uint32LE()).toBe(original)
  })

  it('should roundtrip int32LE', () => {
    const original = -123456789
    const w = createWriter().int32LE(original)
    const r = createReader(w.build())
    expect(r.int32LE()).toBe(original)
  })

  it('should roundtrip uintLE (variable length)', () => {
    const original = 0x123456
    const w = createWriter().uintLE(original, 3)
    const r = createReader(w.build())
    expect(r.uintLE(3)).toBe(original)
  })

  it('should roundtrip intLE (variable length negative)', () => {
    const original = -1000
    const w = createWriter().intLE(original, 3)
    const r = createReader(w.build())
    expect(r.intLE(3)).toBe(original)
  })

  it('should roundtrip 64-bit bigint', () => {
    const original = 0x123456789abcdefn
    const w = createWriter().uintLE(original, 8)
    const r = createReader(w.build())
    expect(r.uintLE(8)).toBe(original)
  })

  it('should roundtrip complex packet', () => {
    const cmd = 0x10
    const id = 0xabcd
    const payload = new Uint8Array([0x01, 0x02, 0x03])

    const w = createWriter().uint8(cmd).uint16LE(id).uint8(payload.length).bytes(payload)

    const r = createReader(w.build())
    expect(r.uint8()).toBe(cmd)
    expect(r.uint16LE()).toBe(id)
    const len = r.uint8()
    expect(r.bytes(len)).toEqual(payload)
  })
})
