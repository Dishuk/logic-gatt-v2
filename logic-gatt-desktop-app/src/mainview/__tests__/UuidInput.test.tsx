/**
 * Tests for UuidInput component.
 * Tests UUID formatting, caret positioning, and component behavior.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { UuidInput } from '../components/UuidInput'

// Mock requestAnimationFrame since jsdom doesn't support it properly
vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
  cb(0)
  return 0
})

describe('formatUuid helper (via component behavior)', () => {
  it('should format hex into UUID pattern', () => {
    const onChange = vi.fn()
    render(<UuidInput value="" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '12345678123412341234123456789abc' } })

    expect(onChange).toHaveBeenCalledWith('12345678-1234-1234-1234-123456789abc')
  })

  it('should handle partial input', () => {
    const onChange = vi.fn()
    render(<UuidInput value="" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '1234' } })

    expect(onChange).toHaveBeenCalledWith('1234')
  })

  it('should add dashes at correct positions', () => {
    const onChange = vi.fn()
    render(<UuidInput value="" onChange={onChange} />)

    const input = screen.getByRole('textbox')

    // First 8 chars - no dash yet
    fireEvent.change(input, { target: { value: '12345678' } })
    expect(onChange).toHaveBeenLastCalledWith('12345678')

    // 9 chars - first dash
    fireEvent.change(input, { target: { value: '123456789' } })
    expect(onChange).toHaveBeenLastCalledWith('12345678-9')

    // 12 chars - two dashes
    fireEvent.change(input, { target: { value: '123456781234' } })
    expect(onChange).toHaveBeenLastCalledWith('12345678-1234')

    // 13 chars - second group complete
    fireEvent.change(input, { target: { value: '1234567812341' } })
    expect(onChange).toHaveBeenLastCalledWith('12345678-1234-1')
  })

  it('should filter non-hex characters', () => {
    const onChange = vi.fn()
    render(<UuidInput value="" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'ghij-klmn-1234' } })

    // Only hex chars remain: 1234
    expect(onChange).toHaveBeenCalledWith('1234')
  })

  it('should limit to 32 hex chars (36 with dashes)', () => {
    const onChange = vi.fn()
    render(<UuidInput value="" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    // 36 hex chars - should truncate to 32
    const longInput = '123456781234123412341234567890abcdef'
    fireEvent.change(input, { target: { value: longInput } })

    // Should be truncated to 32 hex chars: 8+4+4+4+12 = 32
    expect(onChange).toHaveBeenCalledWith('12345678-1234-1234-1234-1234567890ab')
  })

  it('should handle input with existing dashes', () => {
    const onChange = vi.fn()
    render(<UuidInput value="" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '1234-5678' } })

    // Dashes are stripped and reformatted
    expect(onChange).toHaveBeenCalledWith('12345678')
  })
})

describe('UuidInput component', () => {
  it('should render with initial value', () => {
    render(<UuidInput value="12345678-1234-1234-1234-123456789abc" onChange={() => {}} />)

    const input = screen.getByRole('textbox')
    expect(input).toHaveValue('12345678-1234-1234-1234-123456789abc')
  })

  it('should show placeholder', () => {
    render(<UuidInput value="" onChange={() => {}} placeholder="Enter UUID" />)

    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('placeholder', 'Enter UUID')
  })

  it('should use default placeholder', () => {
    render(<UuidInput value="" onChange={() => {}} />)

    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('placeholder', 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx')
  })

  it('should have maxLength of 36', () => {
    render(<UuidInput value="" onChange={() => {}} />)

    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('maxLength', '36')
  })

  it('should apply custom className', () => {
    render(<UuidInput value="" onChange={() => {}} className="custom-class" />)

    const input = screen.getByRole('textbox')
    expect(input.className).toContain('custom-class')
  })

  it('should apply error class when isDuplicate', () => {
    render(<UuidInput value="" onChange={() => {}} isDuplicate={true} />)

    const input = screen.getByRole('textbox')
    expect(input.className).toContain('input--error')
  })

  it('should not apply error class when not duplicate', () => {
    render(<UuidInput value="" onChange={() => {}} isDuplicate={false} />)

    const input = screen.getByRole('textbox')
    expect(input.className).not.toContain('input--error')
  })

  it('should call onChange on each keystroke', () => {
    const onChange = vi.fn()
    render(<UuidInput value="" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'a' } })
    fireEvent.change(input, { target: { value: 'ab' } })
    fireEvent.change(input, { target: { value: 'abc' } })

    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('should handle controlled value updates', () => {
    const { rerender } = render(<UuidInput value="1234" onChange={() => {}} />)

    const input = screen.getByRole('textbox')
    expect(input).toHaveValue('1234')

    rerender(<UuidInput value="5678" onChange={() => {}} />)
    expect(input).toHaveValue('5678')
  })
})

describe('hexCountAt helper (via component caret behavior)', () => {
  // These test the caret positioning logic indirectly
  // The actual caret position is set via requestAnimationFrame

  it('should count hex chars before dashes', () => {
    const onChange = vi.fn()
    render(<UuidInput value="" onChange={onChange} />)

    const input = screen.getByRole('textbox') as HTMLInputElement

    // Simulate typing with caret position
    Object.defineProperty(input, 'selectionStart', { value: 5, writable: true })
    fireEvent.change(input, { target: { value: '12345678-9' } })

    // onChange should still be called correctly
    expect(onChange).toHaveBeenCalled()
  })
})

describe('UuidInput edge cases', () => {
  it('should handle clearing input to empty string', () => {
    const onChange = vi.fn()
    render(<UuidInput value="1234" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    // Simulate user clearing the input
    fireEvent.change(input, { target: { value: '' } })

    expect(onChange).toHaveBeenCalledWith('')
  })

  it('should handle lowercase input', () => {
    const onChange = vi.fn()
    render(<UuidInput value="" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'abcdef' } })

    expect(onChange).toHaveBeenCalledWith('abcdef')
  })

  it('should handle mixed case input', () => {
    const onChange = vi.fn()
    render(<UuidInput value="" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'AaBbCcDd' } })

    expect(onChange).toHaveBeenCalledWith('AaBbCcDd')
  })

  it('should handle pasting full UUID', () => {
    const onChange = vi.fn()
    render(<UuidInput value="" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, {
      target: { value: '12345678-1234-1234-1234-123456789abc' },
    })

    expect(onChange).toHaveBeenCalledWith('12345678-1234-1234-1234-123456789abc')
  })

  it('should handle pasting UUID without dashes', () => {
    const onChange = vi.fn()
    render(<UuidInput value="" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, {
      target: { value: '12345678123412341234123456789abc' },
    })

    expect(onChange).toHaveBeenCalledWith('12345678-1234-1234-1234-123456789abc')
  })

  it('should strip non-hex when pasting', () => {
    const onChange = vi.fn()
    render(<UuidInput value="" onChange={onChange} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, {
      target: { value: '1234-5678-GHIJ-KLMN' },
    })

    // Only hex chars: 12345678
    expect(onChange).toHaveBeenCalledWith('12345678')
  })

  it('should handle rapid typing', () => {
    const onChange = vi.fn()
    render(<UuidInput value="" onChange={onChange} />)

    const input = screen.getByRole('textbox')

    for (let i = 0; i < 10; i++) {
      fireEvent.change(input, { target: { value: 'a'.repeat(i + 1) } })
    }

    expect(onChange).toHaveBeenCalledTimes(10)
  })
})

describe('UuidInput with isDuplicate prop', () => {
  it('should toggle error class based on isDuplicate', () => {
    const { rerender } = render(<UuidInput value="" onChange={() => {}} isDuplicate={false} />)

    const input = screen.getByRole('textbox')
    expect(input.className).not.toContain('input--error')

    rerender(<UuidInput value="" onChange={() => {}} isDuplicate={true} />)
    expect(input.className).toContain('input--error')

    rerender(<UuidInput value="" onChange={() => {}} isDuplicate={false} />)
    expect(input.className).not.toContain('input--error')
  })
})
