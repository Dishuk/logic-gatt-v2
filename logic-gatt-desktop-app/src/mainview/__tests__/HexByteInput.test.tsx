/**
 * Tests for HexByteInput component.
 * Tests hex formatting, input filtering, and component behavior.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HexByteInput } from '../components/HexByteInput'

// Test the pure formatting function logic
describe('toSpaced helper (via component behavior)', () => {
  it('should format hex with spaces on blur', () => {
    const onChange = vi.fn()
    render(<HexByteInput value="" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'AABBCC' } })
    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledWith('AA BB CC')
  })

  it('should handle single byte', () => {
    const onChange = vi.fn()
    render(<HexByteInput value="" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'FF' } })
    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledWith('FF')
  })

  it('should handle odd number of chars', () => {
    const onChange = vi.fn()
    render(<HexByteInput value="" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'ABC' } })
    fireEvent.blur(input)

    // ABC -> AB C (pairs with last char alone)
    expect(onChange).toHaveBeenCalledWith('AB C')
  })

  it('should convert to uppercase', () => {
    const onChange = vi.fn()
    render(<HexByteInput value="" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'aabbcc' } })
    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledWith('AA BB CC')
  })

  it('should filter non-hex characters', () => {
    const onChange = vi.fn()
    render(<HexByteInput value="" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'GG-HH:ZZ' } })
    fireEvent.blur(input)

    // Only valid hex chars remain (none in this case)
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('should handle empty input', () => {
    const onChange = vi.fn()
    render(<HexByteInput value="" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledWith('')
  })
})

describe('HexByteInput component', () => {
  it('should render with initial value', () => {
    render(<HexByteInput value="AA BB CC" onChange={() => {}} />)

    const input = screen.getByRole('textbox')
    expect(input).toHaveValue('AA BB CC')
  })

  it('should show placeholder', () => {
    render(<HexByteInput value="" onChange={() => {}} placeholder="Enter hex" />)

    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('placeholder', 'Enter hex')
  })

  it('should use default placeholder', () => {
    render(<HexByteInput value="" onChange={() => {}} />)

    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('placeholder', 'FF FF FF')
  })

  it('should strip spaces on focus', () => {
    render(<HexByteInput value="AA BB CC" onChange={() => {}} />)

    const input = screen.getByRole('textbox')
    fireEvent.focus(input)

    // After focus, spaces should be stripped for editing
    expect(input).toHaveValue('AABBCC')
  })

  it('should filter invalid chars during typing', () => {
    const onChange = vi.fn()
    render(<HexByteInput value="" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'ABghXY12' } })

    // Only A, B, 1, 2 are valid hex
    expect(input).toHaveValue('AB12')
  })

  it('should apply focused class when focused', () => {
    render(<HexByteInput value="" onChange={() => {}} />)

    const input = screen.getByRole('textbox')

    expect(input.className).not.toContain('hex-input--focused')
    fireEvent.focus(input)
    expect(input.className).toContain('hex-input--focused')
    fireEvent.blur(input)
    expect(input.className).not.toContain('hex-input--focused')
  })

  it('should not call onChange during typing', () => {
    const onChange = vi.fn()
    render(<HexByteInput value="" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'AA' } })
    fireEvent.change(input, { target: { value: 'AABB' } })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('should call onChange on blur', () => {
    const onChange = vi.fn()
    render(<HexByteInput value="" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'AABB' } })
    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('should handle controlled value changes', () => {
    const { rerender } = render(<HexByteInput value="AA" onChange={() => {}} />)

    const input = screen.getByRole('textbox')
    expect(input).toHaveValue('AA')

    rerender(<HexByteInput value="BB CC" onChange={() => {}} />)
    expect(input).toHaveValue('BB CC')
  })

  it('should preserve entered value until blur', () => {
    const onChange = vi.fn()
    const { rerender } = render(<HexByteInput value="AA" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'AABBCC' } })

    // Even if parent tries to change value, focused state preserves raw input
    rerender(<HexByteInput value="DD" onChange={onChange} />)
    expect(input).toHaveValue('AABBCC')
  })
})

describe('HexByteInput edge cases', () => {
  it('should handle rapid focus/blur cycles', () => {
    const onChange = vi.fn()
    render(<HexByteInput value="AA BB" onChange={onChange} />)

    const input = screen.getByRole('textbox')

    fireEvent.focus(input)
    fireEvent.blur(input)
    fireEvent.focus(input)
    fireEvent.blur(input)

    // Should call onChange twice, once per blur
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('should handle mixed case input', () => {
    const onChange = vi.fn()
    render(<HexByteInput value="" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'AaBbCc' } })
    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledWith('AA BB CC')
  })

  it('should handle value with existing spaces', () => {
    const onChange = vi.fn()
    render(<HexByteInput value="AA BB" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    fireEvent.focus(input)

    // On focus, strips spaces
    expect(input).toHaveValue('AABB')

    fireEvent.change(input, { target: { value: 'AABBCC' } })
    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledWith('AA BB CC')
  })
})
