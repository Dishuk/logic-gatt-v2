import type { ChangeEvent, FocusEvent } from 'react'
import { useState, useRef } from 'react'
import { normalizeHex } from '@shared/hex'

interface HexByteInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function HexByteInput({ value, onChange, placeholder }: HexByteInputProps) {
  const [focused, setFocused] = useState(false)
  const [raw, setRaw] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  function handleFocus() {
    // Strip spaces so user edits a plain hex string
    setRaw(value.replace(/ /g, ''))
    setFocused(true)
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const filtered = e.target.value.replace(/[^0-9a-fA-F]/g, '').toUpperCase()
    setRaw(filtered)
  }

  function handleBlur(_e: FocusEvent<HTMLInputElement>) {
    // Commits whole bytes only, padding a lone trailing digit (see @shared/hex), so a
    // stored value never holds a partial byte for the readers to disagree over.
    onChange(normalizeHex(raw))
    setFocused(false)
  }

  return (
    <input
      ref={ref}
      className={`hex-input${focused ? ' hex-input--focused' : ''}`}
      type="text"
      placeholder={placeholder ?? 'FF FF FF'}
      value={focused ? raw : value}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
    />
  )
}
