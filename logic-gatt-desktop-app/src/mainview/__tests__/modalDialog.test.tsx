/**
 * Tests for the shared modal behaviour (`hooks/useModalDialog`).
 *
 * Escape used to work in three of the app's six modals and not the other three, so the
 * point of these is that every modal built on the hook behaves the same way.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useModalDialog } from '../hooks/useModalDialog'

function Dialog({ onClose, label = 'Test' }: { onClose: () => void; label?: string }) {
  const panelRef = useModalDialog<HTMLDivElement>(onClose)
  return (
    <div className="help-overlay" onClick={onClose}>
      <div
        className="confirm-modal"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        <button>first</button>
        <button>middle</button>
        <button>last</button>
      </div>
    </div>
  )
}

const escape = () => fireEvent.keyDown(document, { key: 'Escape' })

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('closing', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<Dialog onClose={onClose} />)

    escape()

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores other keys', () => {
    const onClose = vi.fn()
    render(<Dialog onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'a' })
    fireEvent.keyDown(document, { key: 'Enter' })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('stops listening once unmounted', () => {
    const onClose = vi.fn()
    const { unmount } = render(<Dialog onClose={onClose} />)

    unmount()
    escape()

    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls the latest callback, not the one from the first render', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Dialog onClose={first} />)

    rerender(<Dialog onClose={second} />)
    escape()

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('closes only the innermost dialog when two are open', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    render(
      <>
        <Dialog onClose={outer} label="outer" />
        <Dialog onClose={inner} label="inner" />
      </>
    )

    escape()

    // Escape belongs to the frontmost dialog; the one behind it stays put.
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })
})

describe('focus', () => {
  it('moves focus into the dialog on open', () => {
    render(<Dialog onClose={vi.fn()} />)

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }))
  })

  it('puts focus back where it was on close', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)

    const { unmount } = render(<Dialog onClose={vi.fn()} />)
    expect(document.activeElement).not.toBe(opener)

    unmount()

    expect(document.activeElement).toBe(opener)
  })

  it('wraps Tab from the last control back to the first', () => {
    render(<Dialog onClose={vi.fn()} />)
    const last = screen.getByRole('button', { name: 'last' })
    last.focus()

    fireEvent.keyDown(document, { key: 'Tab' })

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }))
  })

  it('wraps Shift+Tab from the first control to the last', () => {
    render(<Dialog onClose={vi.fn()} />)
    const first = screen.getByRole('button', { name: 'first' })
    first.focus()

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'last' }))
  })

  it('leaves Tab alone in the middle of the dialog', () => {
    render(<Dialog onClose={vi.fn()} />)
    const middle = screen.getByRole('button', { name: 'middle' })
    middle.focus()

    fireEvent.keyDown(document, { key: 'Tab' })

    // Not intercepted — the browser's own order applies.
    expect(document.activeElement).toBe(middle)
  })
})

describe('semantics', () => {
  it('exposes the panel as a modal dialog', () => {
    render(<Dialog onClose={vi.fn()} label="Save project as" />)

    const dialog = screen.getByRole('dialog', { name: 'Save project as' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })
})
