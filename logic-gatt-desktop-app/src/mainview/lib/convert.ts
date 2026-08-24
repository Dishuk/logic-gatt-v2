/**
 * Value conversions for the Convert tab.
 *
 * Everything is a view of one byte buffer. Hex, text and binary are alternate
 * spellings of those bytes; decimal is the buffer read as one integer, which is the
 * only place byte order changes the answer — so both readings are shown at once
 * rather than hidden behind a selector.
 *
 * Formats match what the rest of the app produces so results paste straight into hex
 * fields: uppercase space-separated byte pairs (see `hexDump` in lib/runtime.ts and
 * `toSpaced` in components/HexByteInput.tsx), and UTF-8 for text (the encoding
 * `validation.ts` and the function API already use).
 *
 * Parsing tolerates partial input because these run on every keystroke: a trailing
 * half-byte is ignored rather than treated as a whole one, mirroring `parseHexBytes`.
 */

export type Endian = 'LE' | 'BE'

// --- hex ---

export function parseHex(raw: string): Uint8Array {
  const clean = raw.replace(/[^0-9a-fA-F]/g, '')
  const out: number[] = []
  for (let i = 0; i + 2 <= clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16))
  return new Uint8Array(out)
}

export function formatHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ')
}

// --- binary ---

export function parseBinary(raw: string): Uint8Array {
  const clean = raw.replace(/[^01]/g, '')
  const out: number[] = []
  for (let i = 0; i + 8 <= clean.length; i += 8) out.push(parseInt(clean.slice(i, i + 8), 2))
  return new Uint8Array(out)
}

export function formatBinary(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(2).padStart(8, '0'))
    .join(' ')
}

// --- text ---

export function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** Middle dot, standing in for bytes that have no printable form. */
const DOT = String.fromCharCode(0xb7)

/** Control characters have no typeable representation, so text round-tripping is unsafe. */
function isControlChar(codePoint: number): boolean {
  return codePoint < 0x20 || codePoint === 0x7f
}

/**
 * Decode bytes as UTF-8 for display.
 *
 * `editable` reports whether the text can be typed back without changing the bytes.
 * It cannot when the buffer is not valid UTF-8 (decoding yields U+FFFD, and encoding
 * that back produces EF BF BD — different bytes) or when it contains control
 * characters that have no typeable representation. In those cases the field shows
 * the decoding but must not be used as an input, or editing would corrupt the buffer.
 */
export function decodeText(bytes: Uint8Array): { text: string; editable: boolean } {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return { text: new TextDecoder('utf-8').decode(bytes), editable: false }
  }
  return { text, editable: ![...text].some(ch => isControlChar(ch.codePointAt(0) ?? 0)) }
}

/** Printable rendering for the text preview: control bytes shown as a placeholder. */
export function toPrintable(text: string): string {
  return [...text].map(ch => (isControlChar(ch.codePointAt(0) ?? 0) ? DOT : ch)).join('')
}

// --- decimal ---
//
// BigInt internally so a long buffer is compared exactly rather than through a double
// that has already lost digits by the time it is checked against the limit.

/** Largest value shown as a number; past this the buffer is reported as overflowing. */
export const DECIMAL_MAX = 0xffffffffn

/**
 * Read the whole buffer as one unsigned integer, or `null` when it exceeds u32 —
 * which the UI renders as "overflow" rather than a number nothing consumes.
 * An empty buffer reads as 0.
 */
export function bytesToDecimal(bytes: Uint8Array, endian: Endian): string | null {
  const ordered = endian === 'LE' ? Array.from(bytes).reverse() : Array.from(bytes)
  let value = 0n
  for (const b of ordered) value = (value << 8n) | BigInt(b)
  return value > DECIMAL_MAX ? null : value.toString()
}

/**
 * Turn a decimal string into bytes.
 *
 * `minLength` keeps the buffer's current width where the value fits, so typing into
 * the decimal field of a two-byte buffer yields two bytes rather than silently
 * narrowing it; a value needing more room grows the buffer instead of overflowing.
 */
export function decimalToBytes(
  raw: string,
  endian: Endian,
  minLength: number
): { bytes: Uint8Array } | { error: string } {
  const clean = raw.trim()
  if (!clean) return { bytes: new Uint8Array(minLength) }
  if (!/^\d+$/.test(clean)) return { error: 'Decimal digits only.' }

  let value = BigInt(clean)
  // Matches the display limit, so a value that can be typed can also be read back.
  if (value > DECIMAL_MAX) return { error: `Value exceeds u32 (max ${DECIMAL_MAX}).` }
  const be: number[] = []
  while (value > 0n) {
    be.unshift(Number(value & 0xffn))
    value >>= 8n
  }
  if (be.length === 0) be.push(0)
  while (be.length < minLength) be.unshift(0)

  return { bytes: new Uint8Array(endian === 'LE' ? be.reverse() : be) }
}
