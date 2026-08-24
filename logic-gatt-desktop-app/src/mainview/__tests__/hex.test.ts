/**
 * Tests for `@shared/hex` — the single reader/writer of hex byte strings.
 *
 * The point of the module is that every path agrees, so the last block checks the
 * callers that used to disagree rather than only the functions themselves.
 */

import { describe, it, expect } from 'vitest'
import { formatHex, hexEquals, normalizeHex, parseHex } from '@shared/hex'
import { parseVarValue, serializeVarValue } from '../lib/sandbox'

describe('parseHex', () => {
  it('reads spaced pairs', () => {
    expect([...parseHex('AB CD')]).toEqual([0xab, 0xcd])
  })

  it('reads unspaced pairs the same way', () => {
    expect([...parseHex('ABCD')]).toEqual([0xab, 0xcd])
  })

  it('is case-insensitive', () => {
    expect([...parseHex('ab cd')]).toEqual([...parseHex('AB CD')])
  })

  it('treats any non-hex character as a separator', () => {
    expect([...parseHex('AB-CD:EF')]).toEqual([0xab, 0xcd, 0xef])
  })

  it('ignores a trailing half-byte', () => {
    expect([...parseHex('AB C')]).toEqual([0xab])
    expect([...parseHex('ABC')]).toEqual([0xab])
  })

  it('reads an empty or digitless string as no bytes', () => {
    expect([...parseHex('')]).toEqual([])
    expect([...parseHex('   ')]).toEqual([])
    expect([...parseHex('null')]).toEqual([])
  })

  it('keeps 0x00 rather than dropping it', () => {
    expect([...parseHex('00 01 00')]).toEqual([0, 1, 0])
  })
})

describe('formatHex', () => {
  it('writes uppercase space-separated pairs', () => {
    expect(formatHex(new Uint8Array([0xab, 0x0c]))).toBe('AB 0C')
  })

  it('pads single-digit bytes', () => {
    expect(formatHex(new Uint8Array([0, 1, 15]))).toBe('00 01 0F')
  })

  it('writes an empty buffer as an empty string', () => {
    expect(formatHex(new Uint8Array())).toBe('')
  })

  it('round-trips with parseHex', () => {
    const bytes = new Uint8Array([0x00, 0x7f, 0x80, 0xff])
    expect([...parseHex(formatHex(bytes))]).toEqual([...bytes])
  })
})

describe('normalizeHex', () => {
  it('spaces and upper-cases what was typed', () => {
    expect(normalizeHex('abcd')).toBe('AB CD')
  })

  it('pads a lone trailing digit into a whole byte instead of dropping it', () => {
    expect(normalizeHex('ABC')).toBe('AB 0C')
    expect(normalizeHex('C')).toBe('0C')
  })

  it('produces something parseHex reads back unchanged', () => {
    // The bargain the module documents: committed values hold no partial byte.
    for (const typed of ['ABC', 'abcde', '1', 'AB CD E']) {
      const committed = normalizeHex(typed)
      expect(formatHex(parseHex(committed))).toBe(committed)
    }
  })

  it('leaves an empty field empty', () => {
    expect(normalizeHex('')).toBe('')
  })
})

describe('hexEquals', () => {
  it('ignores spacing and case', () => {
    expect(hexEquals('abcd', 'AB CD')).toBe(true)
  })

  it('separates different bytes', () => {
    expect(hexEquals('AB CD', 'AB CE')).toBe(false)
  })

  it('does not read prose as hex digits', () => {
    // "(empty)" contains an 'e'; comparing display strings made it equal to "0E".
    expect(hexEquals('(empty)', '0E')).toBe(false)
  })
})

describe('every reader agrees', () => {
  // Each of these used to be parsed by its own copy, and two of the copies disagreed.
  const cases = ['AB CD', 'ABCD', 'ab cd', '00', 'AB C', '']

  it('gives the sandbox the same bytes as the runtime', () => {
    for (const raw of cases) {
      expect([...(parseVarValue('hex', raw) as Uint8Array)]).toEqual([...parseHex(raw)])
    }
  })

  it('serializes variables in the shared form', () => {
    const bytes = new Uint8Array([0xab, 0x0c])
    expect(serializeVarValue('hex', bytes)).toBe(formatHex(bytes))
  })

  it('reads unspaced hex as bytes, not as one huge number', () => {
    // The upload path used to split on whitespace and parseInt each token, so
    // "0102" became parseInt("0102", 16) & 0xff === 0x02 — one byte, not two.
    expect([...parseHex('0102')]).toEqual([0x01, 0x02])
  })
})
