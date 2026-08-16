import type { ChangeEvent } from 'react'
import { useRef, useCallback } from 'react'

function formatUuid(raw: string): string {
  const hex = raw.replace(/[^0-9a-fA-F]/g, '').slice(0, 32)
  const parts = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)]
  return parts.filter(Boolean).join('-')
}

/** Count hex chars (non-dash) up to a position in a formatted UUID string. */
function hexCountAt(str: string, pos: number): number {
  let count = 0
  for (let i = 0; i < pos && i < str.length; i++) {
    if (str[i] !== '-') count++
  }
  return count
}

/** Convert a hex-char index back to a position in a formatted UUID string. */
function posFromHexCount(str: string, hexCount: number): number {
  let count = 0
  for (let i = 0; i < str.length; i++) {
    if (str[i] !== '-') {
      if (count === hexCount) return i
      count++
    }
  }
  return str.length
}

interface UuidInputProps {
  value: string
  onChange: (value: string) => void
  isDuplicate?: boolean
  placeholder?: string
  className?: string
}

export function UuidInput({ value, onChange, isDuplicate, placeholder, className }: UuidInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const el = e.target
      const rawValue = e.target.value
      const caretPos = el.selectionStart ?? rawValue.length

      // Count hex chars before caret in the raw (pre-format) value
      const hexBefore = hexCountAt(rawValue, caretPos)

      const formatted = formatUuid(rawValue)
      onChange(formatted)

      // Restore caret after React re-renders
      requestAnimationFrame(() => {
        if (inputRef.current) {
          const newPos = posFromHexCount(formatted, hexBefore)
          inputRef.current.setSelectionRange(newPos, newPos)
        }
      })
    },
    [onChange]
  )

  return (
    <input
      ref={inputRef}
      className={`${className ?? 'uuid-input'}${isDuplicate ? ' input--error' : ''}`}
      type="text"
      placeholder={placeholder ?? 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}
      value={value}
      onChange={handleChange}
      maxLength={36}
    />
  )
}
