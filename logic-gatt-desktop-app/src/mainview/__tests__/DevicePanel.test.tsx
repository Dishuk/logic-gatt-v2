/**
 * Tests for DevicePanel — the left panel's two tabs (Schema, State) and the live values
 * the State tab shows.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { SettingsProvider } from '../hooks/useSettings'
import { DevicePanel } from '../components/DevicePanel'
import { createSessionState } from '../lib/sessionState'
import type { DeviceSettings, Service, UserVariable } from '../types'

const deviceSettings: DeviceSettings = { deviceName: 'test-device', appearance: 0, manufacturerData: '' }

function service(id: string, uuid: string): Service {
  return { id, uuid, tag: `Service ${id}`, characteristics: [] }
}

function createProps(overrides: { services?: Service[]; variables?: UserVariable[]; setVariables?: () => void } = {}) {
  return {
    project: {
      deviceSettings,
      setDeviceSettings: vi.fn(),
      services: overrides.services ?? [],
      setServices: vi.fn(),
      addService: vi.fn(),
      updateService: vi.fn(),
      removeService: vi.fn(),
      variables: overrides.variables ?? [],
      setVariables: overrides.setVariables ?? vi.fn(),
    },
    session: createSessionState(overrides.variables ?? []),
    running: false,
  }
}

function renderPanel(props: ReturnType<typeof createProps>) {
  return render(
    <SettingsProvider>
      <DevicePanel {...props} />
    </SettingsProvider>
  )
}

const counter: UserVariable = { id: 'v1', name: 'counter', type: 'u16', initialValue: '7' }

describe('DevicePanel', () => {
  describe('tabs', () => {
    it('shows the service count on the Schema tab', () => {
      renderPanel(createProps({ services: [service('1', 'uuid-1'), service('2', 'uuid-2')] }))

      expect(screen.getByRole('button', { name: 'Schema (2/8)' })).toBeInTheDocument()
    })

    it('starts on Schema', () => {
      renderPanel(createProps())

      expect(screen.getByRole('button', { name: 'Schema (0/8)' })).toHaveClass('tab--active')
      expect(screen.getByRole('button', { name: 'State' })).not.toHaveClass('tab--active')
    })

    it('switches to State when clicked', () => {
      renderPanel(createProps())

      fireEvent.click(screen.getByRole('button', { name: 'State' }))

      expect(screen.getByRole('button', { name: 'State' })).toHaveClass('tab--active')
    })

    it('reveals State the first time a run starts, then leaves the choice alone', () => {
      const props = createProps()
      const { rerender } = renderPanel(props)

      rerender(
        <SettingsProvider>
          <DevicePanel {...props} running={true} />
        </SettingsProvider>
      )
      expect(screen.getByRole('button', { name: /^State/ })).toHaveClass('tab--active')

      // Back to Schema by hand; a later run must not yank the panel away again.
      fireEvent.click(screen.getByRole('button', { name: 'Schema (0/8)' }))
      rerender(
        <SettingsProvider>
          <DevicePanel {...props} running={false} />
        </SettingsProvider>
      )
      rerender(
        <SettingsProvider>
          <DevicePanel {...props} running={true} />
        </SettingsProvider>
      )
      expect(screen.getByRole('button', { name: 'Schema (0/8)' })).toHaveClass('tab--active')
    })
  })

  describe('state tab', () => {
    it('lists authored variables as the values a run would start from', () => {
      renderPanel(createProps({ variables: [counter] }))

      fireEvent.click(screen.getByRole('button', { name: 'State' }))

      expect(screen.getByText('counter')).toBeInTheDocument()
      expect(screen.getAllByText('7').length).toBeGreaterThan(0)
    })

    it('shows a live value once a function has written one', () => {
      const props = createProps({ variables: [counter] })
      props.session.set('counter', '42')
      renderPanel(props)

      fireEvent.click(screen.getByRole('button', { name: 'State' }))

      expect(screen.getByText('42')).toBeInTheDocument()
    })

    it('resets live values back to the authored ones', () => {
      const props = createProps({ variables: [counter] })
      props.session.set('counter', '42')
      renderPanel(props)
      fireEvent.click(screen.getByRole('button', { name: 'State' }))

      fireEvent.click(screen.getByRole('button', { name: 'Reset all' }))

      expect(props.session.get('counter')).toBe('7')
      expect(props.session.isDirty()).toBe(false)
    })

    it('writes a live value into the project only when asked', () => {
      const setVariables = vi.fn()
      const props = createProps({ variables: [counter], setVariables })
      props.session.set('counter', '42')
      renderPanel(props)
      fireEvent.click(screen.getByRole('button', { name: 'State' }))

      expect(setVariables).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Save all as initial' }))

      const updater = setVariables.mock.calls[0][0]
      expect(updater([counter])).toEqual([{ ...counter, initialValue: '42' }])
    })

    it('marks a diverged value so it stands out from the unchanged ones', () => {
      const props = createProps({ variables: [counter, { id: 'v2', name: 'other', type: 'u8', initialValue: '1' }] })
      props.session.set('counter', '42')
      const { container } = renderPanel(props)

      fireEvent.click(screen.getByRole('button', { name: 'State' }))

      expect(container.querySelectorAll('.state-var--dirty')).toHaveLength(1)
    })

    it('hides unchanged variables when Changed only is on', () => {
      const props = createProps({ variables: [counter, { id: 'v2', name: 'other', type: 'u8', initialValue: '1' }] })
      props.session.set('counter', '42')
      renderPanel(props)
      fireEvent.click(screen.getByRole('button', { name: 'State' }))

      fireEvent.click(screen.getByRole('button', { name: 'Changed only' }))

      expect(screen.getByText('counter')).toBeInTheDocument()
      expect(screen.queryByText('other')).not.toBeInTheDocument()
    })

    it('says so when the filter is on and nothing has changed', () => {
      renderPanel(createProps({ variables: [counter] }))
      fireEvent.click(screen.getByRole('button', { name: 'State' }))

      fireEvent.click(screen.getByRole('button', { name: 'Changed only' }))

      expect(screen.getByText(/Nothing has changed yet/)).toBeInTheDocument()
      expect(screen.queryByText('counter')).not.toBeInTheDocument()
    })

    it('offers no reset actions while nothing has diverged', () => {
      renderPanel(createProps({ variables: [counter] }))

      fireEvent.click(screen.getByRole('button', { name: 'State' }))

      expect(screen.getByRole('button', { name: 'Reset all' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Save all as initial' })).toBeDisabled()
    })

    it('explains itself when the project has no variables', () => {
      renderPanel(createProps())

      fireEvent.click(screen.getByRole('button', { name: 'State' }))

      expect(within(screen.getByText(/No variables defined/)).queryByRole('textbox')).toBeNull()
    })
  })
})
