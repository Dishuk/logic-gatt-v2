/**
 * Terminal tests, focused on the unread marker.
 *
 * A failed Upload & Run only ever reports itself as a device-log line, so with another
 * tab showing the button looks inert. The dot is what makes that recoverable.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useLogger } from '../hooks/useLogger'
import { Terminal } from '../components/Terminal'

vi.mock('../lib/rpc', () => ({
  rpc: { request: { openLogsFolder: vi.fn().mockResolvedValue(null) } },
}))

/** Drives a real pair of loggers, exposing their `log` to the test. */
function Harness({ onReady }: { onReady: (api: { device: (m: string) => void; fn: (m: string) => void }) => void }) {
  const deviceLogger = useLogger()
  const fnLogger = useLogger()
  onReady({ device: deviceLogger.log, fn: fnLogger.log })
  return <Terminal deviceLogger={deviceLogger} fnLogger={fnLogger} />
}

function setup() {
  let api = { device: (_: string) => {}, fn: (_: string) => {} }
  render(<Harness onReady={a => (api = a)} />)
  return {
    logDevice: (m: string) => act(() => api.device(m)),
    logFn: (m: string) => act(() => api.fn(m)),
    tab: (name: RegExp) => screen.getByRole('button', { name }),
    hasDot: (name: RegExp) => within(screen.getByRole('button', { name })).queryByLabelText('New lines') !== null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('unread log marker', () => {
  it('starts with no dots', () => {
    const t = setup()
    expect(t.hasDot(/Device/)).toBe(false)
    expect(t.hasDot(/Functions/)).toBe(false)
  })

  it('does not mark the tab that is already showing', () => {
    const t = setup()
    t.logDevice('Validation failed')
    expect(t.hasDot(/Device/)).toBe(false)
  })

  it('marks Device when a line arrives while Convert is showing', () => {
    const t = setup()
    fireEvent.click(t.tab(/Convert/))

    t.logDevice('Validation failed:')

    expect(t.hasDot(/Device/)).toBe(true)
  })

  it('marks Device when a line arrives while Functions is showing', () => {
    const t = setup()
    fireEvent.click(t.tab(/Functions/))

    t.logDevice('Validation failed:')

    expect(t.hasDot(/Device/)).toBe(true)
  })

  it('marks Functions independently of Device', () => {
    const t = setup()
    fireEvent.click(t.tab(/Convert/))

    t.logFn('console.log output')

    expect(t.hasDot(/Functions/)).toBe(true)
    expect(t.hasDot(/Device/)).toBe(false)
  })

  it('clears the dot once the tab is opened', () => {
    const t = setup()
    fireEvent.click(t.tab(/Convert/))
    t.logDevice('Validation failed:')
    expect(t.hasDot(/Device/)).toBe(true)

    fireEvent.click(t.tab(/Device/))

    expect(t.hasDot(/Device/)).toBe(false)
  })

  it('marks again after returning to Convert', () => {
    const t = setup()
    fireEvent.click(t.tab(/Convert/))
    t.logDevice('first')
    fireEvent.click(t.tab(/Device/))
    fireEvent.click(t.tab(/Convert/))
    expect(t.hasDot(/Device/)).toBe(false)

    t.logDevice('second')

    expect(t.hasDot(/Device/)).toBe(true)
  })

  it('still marks lines that arrive after the log was cleared', () => {
    const t = setup()
    t.logDevice('one')
    t.logDevice('two')
    // Clear while Device is showing, then leave.
    fireEvent.click(screen.getByTitle('Clear terminal'))
    fireEvent.click(t.tab(/Convert/))

    t.logDevice('after the clear')

    expect(t.hasDot(/Device/)).toBe(true)
  })
})

describe('convert tab', () => {
  it('replaces the log view with the converter', () => {
    const t = setup()
    t.logDevice('a device line')
    expect(screen.getByText(/a device line/)).toBeInTheDocument()

    fireEvent.click(t.tab(/Convert/))

    expect(screen.queryByText(/a device line/)).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('48 65 6C 6C 6F')).toBeInTheDocument()
  })
})
