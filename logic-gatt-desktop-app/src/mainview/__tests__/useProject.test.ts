/**
 * Tests for useProject hook.
 * Tests project state management, service operations, and import/export.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useProject } from '../hooks/useProject'
import { TriggerKind } from '../types'
import type { Scenario } from '../types'
import defaultProjectJson from './fixtures/defaultProject.json'
import { rpc } from '../lib/rpc'

// The default preset now comes from the Bun main process over RPC.
vi.mock('../lib/rpc', () => ({
  rpc: { request: { getPreset: vi.fn() } },
}))
const mockGetPreset = vi.mocked(rpc.request.getPreset)

describe('useProject', () => {
  const mockLog = vi.fn()

  beforeEach(() => {
    mockLog.mockClear()
    mockGetPreset.mockReset()
    // Resolve the default preset object (useProject stringifies then imports it).
    mockGetPreset.mockResolvedValue(defaultProjectJson)
  })

  describe('initial state', () => {
    it('should load default project on init', async () => {
      const { result } = renderHook(() => useProject(mockLog))

      // Wait for async loading to complete
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Should have default services from defaultProject.json
      expect(result.current.services.length).toBeGreaterThan(0)
      expect(result.current.functions.length).toBeGreaterThan(0)
      expect(result.current.variables.length).toBeGreaterThan(0)
    })

    it('should have device settings', async () => {
      const { result } = renderHook(() => useProject(mockLog))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.deviceSettings).toBeDefined()
      expect(result.current.deviceSettings.deviceName).toBeDefined()
    })

    it('should provide refs for runtime access', () => {
      const { result } = renderHook(() => useProject(mockLog))

      expect(result.current.scenariosRef).toBeDefined()
      expect(result.current.functionsRef).toBeDefined()
      expect(result.current.variablesRef).toBeDefined()
    })

    it('should handle fetch failure gracefully', async () => {
      mockGetPreset.mockRejectedValue(new Error('HTTP 500'))

      const { result } = renderHook(() => useProject(mockLog))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Should start empty on error
      expect(result.current.services.length).toBe(0)
    })
  })

  describe('service management', () => {
    it('should add a new service', async () => {
      const { result } = renderHook(() => useProject(mockLog))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      const initialCount = result.current.services.length

      act(() => {
        result.current.addService()
      })

      expect(result.current.services.length).toBe(initialCount + 1)
    })

    it('should not add more than 8 services', async () => {
      const { result } = renderHook(() => useProject(mockLog))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Add services until we hit the limit
      act(() => {
        for (let i = 0; i < 15; i++) {
          result.current.addService()
        }
      })

      expect(result.current.services.length).toBeLessThanOrEqual(8)
    })

    it('should update a service', async () => {
      const { result } = renderHook(() => useProject(mockLog))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      const serviceId = result.current.services[0].id
      const newUuid = 'updated-uuid-12345678'

      act(() => {
        result.current.updateService(serviceId, {
          ...result.current.services[0],
          uuid: newUuid,
        })
      })

      const updatedService = result.current.services.find(s => s.id === serviceId)
      expect(updatedService?.uuid).toBe(newUuid)
    })

    it('should remove a service', async () => {
      const { result } = renderHook(() => useProject(mockLog))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      const initialCount = result.current.services.length
      const serviceId = result.current.services[0].id

      act(() => {
        result.current.removeService(serviceId)
      })

      expect(result.current.services.length).toBe(initialCount - 1)
      expect(result.current.services.find(s => s.id === serviceId)).toBeUndefined()
    })

    it('should generate unique IDs for new services', async () => {
      const { result } = renderHook(() => useProject(mockLog))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      act(() => {
        result.current.addService()
        result.current.addService()
      })

      const ids = result.current.services.map(s => s.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })
  })

  describe('setters', () => {
    it('should update device settings', () => {
      const { result } = renderHook(() => useProject(mockLog))

      act(() => {
        result.current.setDeviceSettings({
          deviceName: 'new-device-name',
          appearance: 0x1234,
          manufacturerData: 'AA BB',
        })
      })

      expect(result.current.deviceSettings.deviceName).toBe('new-device-name')
      expect(result.current.deviceSettings.appearance).toBe(0x1234)
    })

    it('should update functions', () => {
      const { result } = renderHook(() => useProject(mockLog))
      const newFunctions = [{ id: 'new-fn', name: 'testFn', body: 'return input;' }]

      act(() => {
        result.current.setFunctions(newFunctions)
      })

      expect(result.current.functions).toEqual(newFunctions)
    })

    it('should update variables', () => {
      const { result } = renderHook(() => useProject(mockLog))
      const newVariables = [{ id: 'new-var', name: 'testVar', type: 'u8' as const, initialValue: '42' }]

      act(() => {
        result.current.setVariables(newVariables)
      })

      expect(result.current.variables).toEqual(newVariables)
    })

    it('should update tests', () => {
      const { result } = renderHook(() => useProject(mockLog))
      const newTests = [{ id: 'test-1', name: 'Test 1', functionId: 'fn-1', inputHex: 'AA', expectedHex: 'BB' }]

      act(() => {
        result.current.setTests(newTests)
      })

      expect(result.current.tests).toEqual(newTests)
    })

    it('should update scenarios', () => {
      const { result } = renderHook(() => useProject(mockLog))
      const newScenarios: Scenario[] = [
        {
          id: 'scenario-1',
          name: 'Test Scenario',
          enabled: true,
          trigger: { kind: TriggerKind.Startup },
          steps: [],
        },
      ]

      act(() => {
        result.current.setScenarios(newScenarios)
      })

      expect(result.current.scenarios).toEqual(newScenarios)
    })
  })

  describe('refs sync', () => {
    it('should keep scenariosRef in sync with state', () => {
      const { result } = renderHook(() => useProject(mockLog))
      const newScenarios: Scenario[] = [
        {
          id: 'scenario-1',
          name: 'New Scenario',
          enabled: true,
          trigger: { kind: TriggerKind.Startup },
          steps: [],
        },
      ]

      act(() => {
        result.current.setScenarios(newScenarios)
      })

      expect(result.current.scenariosRef.current).toEqual(newScenarios)
    })

    it('should keep functionsRef in sync with state', () => {
      const { result } = renderHook(() => useProject(mockLog))
      const newFunctions = [{ id: 'fn-1', name: 'newFn', body: 'return null;' }]

      act(() => {
        result.current.setFunctions(newFunctions)
      })

      expect(result.current.functionsRef.current).toEqual(newFunctions)
    })

    it('should keep variablesRef in sync with state', () => {
      const { result } = renderHook(() => useProject(mockLog))
      const newVariables = [{ id: 'var-1', name: 'newVar', type: 'string' as const, initialValue: 'test' }]

      act(() => {
        result.current.setVariables(newVariables)
      })

      expect(result.current.variablesRef.current).toEqual(newVariables)
    })
  })
})

describe('useProject edge cases', () => {
  const mockLog = vi.fn()

  beforeEach(() => {
    mockLog.mockClear()
    mockGetPreset.mockReset()
    mockGetPreset.mockResolvedValue(defaultProjectJson)
  })

  it('should handle updating non-existent service gracefully', async () => {
    const { result } = renderHook(() => useProject(mockLog))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    const originalServices = [...result.current.services]

    act(() => {
      result.current.updateService('non-existent-id', {
        id: 'non-existent-id',
        uuid: 'test',
        tag: 'test',
        characteristics: [],
      })
    })

    // Should not change anything
    expect(result.current.services.length).toBe(originalServices.length)
  })

  it('should handle removing non-existent service gracefully', async () => {
    const { result } = renderHook(() => useProject(mockLog))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    const originalCount = result.current.services.length

    act(() => {
      result.current.removeService('non-existent-id')
    })

    expect(result.current.services.length).toBe(originalCount)
  })

  it('should create services with empty characteristics', () => {
    const { result } = renderHook(() => useProject(mockLog))

    act(() => {
      // Clear existing services first
      result.current.setServices([])
    })

    act(() => {
      result.current.addService()
    })

    const newService = result.current.services[0]
    expect(newService.characteristics).toEqual([])
    expect(newService.uuid).toBe('')
    expect(newService.tag).toBe('')
  })
})
