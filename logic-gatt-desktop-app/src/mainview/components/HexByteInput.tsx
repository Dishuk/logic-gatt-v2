import type { ChangeEvent, FocusEvent } from 'react'
import { useState, useRef } from 'react'

interface HexByteInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

/** Normalise raw hex string into space-separated uppercase byte pairs */
function toSpaced(raw: string): string {
  const hex = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase()
  const pairs: string[] = []
  for (let i = 0; i < hex.length; i += 2) pairs.push(hex.slice(i, i + 2))
  return pairs.join(' ')
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
    onChange(toSpaced(raw))
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
