/**
 * Convert tab — a scratchpad for turning values between the representations this app
 * deals in, so hex can be pasted straight into a defaultValue, a variable, or a test
 * vector, and hex read out of the terminal can be made sense of.
 *
 * One byte buffer is the single source of truth; every field renders it, rather than
 * fields syncing to each other. Hex, text and binary are alternate spellings of the
 * same bytes, so they appear once. Byte order changes only the decimal reading, so LE
 * and BE are shown side by side instead of behind a selector.
 *
 * The field being typed in keeps its raw text until it loses focus — reformatting
 * mid-keystroke would move the caret and make input impossible (the same reason
 * HexByteInput defers to blur). Text and the decimal fields seed their draft on focus
 * so a lossy rendering ("-" for overflow, "·" for unprintable bytes) can never be
 * typed back into the buffer.
 */

import { useState } from 'react'
import { Copy } from 'lucide-react'
import {
  bytesToDecimal,
  decimalToBytes,
  decodeText,
  encodeText,
  formatBinary,
  formatHex,
  parseBinary,
  parseHex,
  toPrintable,
  type Endian,
} from '../lib/convert'

type Field = 'hex' | 'text' | 'binary' | 'decLE' | 'decBE'

/** Shown when the buffer reads past u32 — no number would be meaningful there. */
const OVERFLOW = '-'

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Clipboard API can be unavailable in the webview; fall back to a scratch selection.
    const el = document.createElement('textarea')
    el.value = text
    document.body.appendChild(el)
    el.select()
    try {
      document.execCommand('copy')
    } finally {
      document.body.removeChild(el)
    }
  }
}

function CopyButton({ value }: { value: string }) {
  return (
    <button className="convert-copy" onClick={() => void copy(value)} disabled={!value} title="Copy" aria-label="Copy">
      <Copy size={13} />
    </button>
  )
}

export function ConvertPanel() {
  const [bytes, setBytes] = useState<Uint8Array>(() => new Uint8Array())
  const [focus, setFocus] = useState<Field | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { text, editable } = decodeText(bytes)

  /** Show the raw draft for the focused field; derive every other from the buffer. */
  const shown = (field: Field, derived: string) => (focus === field ? draft : derived)

  const edit = (field: Field, raw: string, next: Uint8Array) => {
    setFocus(field)
    setDraft(raw)
    setError(null)
    setBytes(next)
  }

  const editDecimal = (field: Field, raw: string, endian: Endian) => {
    setFocus(field)
    setDraft(raw)
    const result = decimalToBytes(raw, endian, bytes.length)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setError(null)
    setBytes(result.bytes)
  }

  const blur = () => {
    setFocus(null)
    setError(null)
  }

  const decLE = bytesToDecimal(bytes, 'LE')
  const decBE = bytesToDecimal(bytes, 'BE')

  return (
    <div className="convert-panel">
      {/* Grid children, ordered to fill row by row: Hex | Decimal (LE), then
          Text | Decimal (BE). Binary spans both columns — 8 bits per byte outruns
          a half-width field long before the other rows do. */}
      <label className="convert-row">
        <span>Hex</span>
        <input
          className="convert-input"
          value={shown('hex', formatHex(bytes))}
          placeholder="48 65 6C 6C 6F"
          onChange={e => edit('hex', e.target.value, parseHex(e.target.value))}
          onBlur={blur}
        />
        <CopyButton value={formatHex(bytes)} />
      </label>

      <label className="convert-row">
        <span>Decimal (LE)</span>
        <input
          className="convert-input"
          value={shown('decLE', decLE ?? OVERFLOW)}
          placeholder="60"
          onFocus={() => {
            setFocus('decLE')
            setDraft(decLE ?? '')
          }}
          onChange={e => editDecimal('decLE', e.target.value, 'LE')}
          onBlur={blur}
        />
        <CopyButton value={decLE ?? ''} />
      </label>

      <label className="convert-row">
        <span>Text</span>
        <input
          className="convert-input"
          value={shown('text', editable ? text : toPrintable(text))}
          placeholder="Hello"
          title={editable ? undefined : 'These bytes are not text; typing here replaces the buffer'}
          onFocus={() => {
            setFocus('text')
            setDraft(editable ? text : '')
          }}
          onChange={e => edit('text', e.target.value, encodeText(e.target.value))}
          onBlur={blur}
        />
        <CopyButton value={text} />
      </label>

      <label className="convert-row">
        <span>Decimal (BE)</span>
        <input
          className="convert-input"
          value={shown('decBE', decBE ?? OVERFLOW)}
          placeholder="15360"
          onFocus={() => {
            setFocus('decBE')
            setDraft(decBE ?? '')
          }}
          onChange={e => editDecimal('decBE', e.target.value, 'BE')}
          onBlur={blur}
        />
        <CopyButton value={decBE ?? ''} />
      </label>

      <label className="convert-row convert-row--wide">
        <span>Binary</span>
        <input
          className="convert-input"
          value={shown('binary', formatBinary(bytes))}
          placeholder="01001000 01100101"
          onChange={e => edit('binary', e.target.value, parseBinary(e.target.value))}
          onBlur={blur}
        />
        <CopyButton value={formatBinary(bytes)} />
      </label>

      {error && <p className="convert-error">{error}</p>}
    </div>
  )
}
