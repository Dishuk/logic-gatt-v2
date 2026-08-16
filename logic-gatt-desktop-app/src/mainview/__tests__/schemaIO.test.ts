/**
 * Tests for schema import/export functionality.
 * Tests project serialization, parsing, and validation.
 */

import { describe, it, expect } from 'vitest'
import { exportProject, importProject, DEFAULT_DEVICE_SETTINGS, type ProjectData } from '../lib/schemaIO'
import { validateSchema } from '../lib/validation'
import { buildContext, executeFunctionSync } from '../lib/executor'
import defaultProjectJson from './fixtures/defaultProject.json'
import heartRateMonitorJson from './fixtures/heartRateMonitor.json'
import { TriggerKind, StepKind } from '../types'
import type { Service, UserFunction, UserVariable, UserTest, Scenario } from '../types'

// Helper to create a minimal valid service
function createService(overrides?: Partial<Service>): Service {
  return {
    id: crypto.randomUUID(),
    uuid: '12345678-1234-1234-1234-123456789abc',
    tag: 'Test Service',
    characteristics: [],
    ...overrides,
  }
}

// Helper to create a minimal valid function
function createFunction(overrides?: Partial<UserFunction>): UserFunction {
  return {
    id: crypto.randomUUID(),
    name: 'testFn',
    body: 'return input;',
    ...overrides,
  }
}

// Helper to create a minimal valid variable
function createVariable(overrides?: Partial<UserVariable>): UserVariable {
  return {
    id: crypto.randomUUID(),
    name: 'testVar',
    type: 'u8',
    initialValue: '0',
    ...overrides,
  }
}

// Helper to create a minimal project
function createProject(overrides?: Partial<ProjectData>): ProjectData {
  return {
    deviceSettings: { ...DEFAULT_DEVICE_SETTINGS },
    services: [],
    functions: [],
    variables: [],
    tests: [],
    scenarios: [],
    ...overrides,
  }
}

describe('exportProject', () => {
  it('should export empty project', () => {
    const project = createProject()
    const json = exportProject(project)
    const parsed = JSON.parse(json)

    expect(parsed.deviceSettings).toEqual(DEFAULT_DEVICE_SETTINGS)
    expect(parsed.services).toEqual([])
    expect(parsed.functions).toEqual([])
    expect(parsed.variables).toEqual([])
    expect(parsed.tests).toEqual([])
    expect(parsed.scenarios).toEqual([])
  })

  it('should strip IDs from services', () => {
    const service = createService()
    const project = createProject({ services: [service] })
    const json = exportProject(project)
    const parsed = JSON.parse(json)

    expect(parsed.services[0].id).toBeUndefined()
    expect(parsed.services[0].uuid).toBe(service.uuid)
  })

  it('should strip IDs from functions', () => {
    const fn = createFunction()
    const project = createProject({ functions: [fn] })
    const json = exportProject(project)
    const parsed = JSON.parse(json)

    expect(parsed.functions[0].id).toBeUndefined()
    expect(parsed.functions[0].name).toBe(fn.name)
    expect(parsed.functions[0].body).toBe(fn.body)
  })

  it('should strip IDs from variables', () => {
    const variable = createVariable()
    const project = createProject({ variables: [variable] })
    const json = exportProject(project)
    const parsed = JSON.parse(json)

    expect(parsed.variables[0].id).toBeUndefined()
    expect(parsed.variables[0].name).toBe(variable.name)
    expect(parsed.variables[0].type).toBe(variable.type)
  })

  it('should convert test functionId to functionName', () => {
    const fn = createFunction({ name: 'myFunction' })
    const test: UserTest = {
      id: crypto.randomUUID(),
      name: 'test1',
      functionId: fn.id,
      inputHex: 'AA BB',
      expectedHex: 'CC DD',
    }
    const project = createProject({ functions: [fn], tests: [test] })
    const json = exportProject(project)
    const parsed = JSON.parse(json)

    expect(parsed.tests[0].id).toBeUndefined()
    expect(parsed.tests[0].functionId).toBeUndefined()
    expect(parsed.tests[0].functionName).toBe('myFunction')
  })

  it('should export scenarios without IDs', () => {
    const scenario: Scenario = {
      id: crypto.randomUUID(),
      name: 'Test Scenario',
      enabled: true,
      trigger: { kind: TriggerKind.Startup },
      steps: [{ kind: StepKind.Respond }],
    }
    const project = createProject({ scenarios: [scenario] })
    const json = exportProject(project)
    const parsed = JSON.parse(json)

    expect(parsed.scenarios[0].id).toBeUndefined()
    expect(parsed.scenarios[0].name).toBe('Test Scenario')
    expect(parsed.scenarios[0].trigger).toEqual({ kind: 'startup' })
  })

  it('should export device settings', () => {
    const project = createProject({
      deviceSettings: {
        deviceName: 'My Device',
        appearance: 0x1234,
        manufacturerData: 'AA BB CC',
      },
    })
    const json = exportProject(project)
    const parsed = JSON.parse(json)

    expect(parsed.deviceSettings.deviceName).toBe('My Device')
    expect(parsed.deviceSettings.appearance).toBe(0x1234)
    expect(parsed.deviceSettings.manufacturerData).toBe('AA BB CC')
  })

  it('should produce valid JSON', () => {
    const project = createProject({
      services: [createService()],
      functions: [createFunction()],
    })
    const json = exportProject(project)
    expect(() => JSON.parse(json)).not.toThrow()
  })

  it('should be pretty-printed', () => {
    const project = createProject()
    const json = exportProject(project)
    expect(json).toContain('\n')
    expect(json).toContain('  ')
  })
})

describe('importProject', () => {
  describe('new format', () => {
    it('should import empty project', () => {
      const json = JSON.stringify({
        deviceSettings: DEFAULT_DEVICE_SETTINGS,
        services: [],
        functions: [],
        variables: [],
        tests: [],
        scenarios: [],
      })
      const project = importProject(json)

      expect(project.deviceSettings).toEqual(DEFAULT_DEVICE_SETTINGS)
      expect(project.services).toEqual([])
      expect(project.functions).toEqual([])
    })

    it('should generate IDs for services', () => {
      const json = JSON.stringify({
        services: [{ uuid: 'aabbccdd-0000-0000-0000-000000000000', tag: 'Test', characteristics: [] }],
      })
      const project = importProject(json)

      expect(project.services[0].id).toBeDefined()
      expect(project.services[0].uuid).toBe('aabbccdd-0000-0000-0000-000000000000')
    })

    it('should generate IDs for functions', () => {
      const json = JSON.stringify({
        functions: [{ name: 'fn1', body: 'return input;' }],
      })
      const project = importProject(json)

      expect(project.functions[0].id).toBeDefined()
      expect(project.functions[0].name).toBe('fn1')
    })

    it('should link tests to functions by name', () => {
      const json = JSON.stringify({
        functions: [{ name: 'myFn', body: '' }],
        tests: [{ name: 'test1', functionName: 'myFn', inputHex: '', expectedHex: '' }],
      })
      const project = importProject(json)

      expect(project.tests[0].functionId).toBe(project.functions[0].id)
    })

    it('should handle test with missing function', () => {
      const json = JSON.stringify({
        functions: [],
        tests: [{ name: 'test1', functionName: 'nonexistent', inputHex: '', expectedHex: '' }],
      })
      const project = importProject(json)

      expect(project.tests[0].functionId).toBe('')
    })

    it('should parse variables with all types', () => {
      const json = JSON.stringify({
        variables: [
          { name: 'v1', type: 'hex', initialValue: 'AA BB' },
          { name: 'v2', type: 'u8', initialValue: '42' },
          { name: 'v3', type: 'u16', initialValue: '1000' },
          { name: 'v4', type: 'u32', initialValue: '100000' },
          { name: 'v5', type: 'string', initialValue: 'hello' },
        ],
      })
      const project = importProject(json)

      expect(project.variables.length).toBe(5)
      expect(project.variables[0].type).toBe('hex')
      expect(project.variables[1].type).toBe('u8')
      expect(project.variables[2].type).toBe('u16')
      expect(project.variables[3].type).toBe('u32')
      expect(project.variables[4].type).toBe('string')
    })

    it('should default invalid variable type to hex', () => {
      const json = JSON.stringify({
        variables: [{ name: 'v1', type: 'invalid', initialValue: '' }],
      })
      const project = importProject(json)

      expect(project.variables[0].type).toBe('hex')
    })

    it('should parse scenarios with char triggers', () => {
      const json = JSON.stringify({
        scenarios: [
          {
            name: 'Scenario 1',
            enabled: true,
            trigger: { kind: 'char-write', serviceUuid: 'svc', charUuid: 'chr' },
            steps: [],
          },
        ],
      })
      const project = importProject(json)

      expect(project.scenarios[0].trigger.kind).toBe('char-write')
      if (project.scenarios[0].trigger.kind === 'char-write') {
        expect(project.scenarios[0].trigger.serviceUuid).toBe('svc')
      }
    })

    it('should parse scenarios with timer triggers', () => {
      const json = JSON.stringify({
        scenarios: [
          {
            name: 'Timer Scenario',
            trigger: { kind: 'timer', intervalMs: 5000, repeat: true },
            steps: [],
          },
        ],
      })
      const project = importProject(json)

      expect(project.scenarios[0].trigger.kind).toBe('timer')
      if (project.scenarios[0].trigger.kind === 'timer') {
        expect(project.scenarios[0].trigger.intervalMs).toBe(5000)
        expect(project.scenarios[0].trigger.repeat).toBe(true)
      }
    })

    it('should parse scenario steps', () => {
      const json = JSON.stringify({
        scenarios: [
          {
            name: 'Scenario',
            trigger: { kind: 'startup' },
            steps: [
              { kind: 'call-function', functionName: 'fn1' },
              { kind: 'notify', serviceUuid: 'svc', charUuid: 'chr' },
              { kind: 'respond' },
            ],
          },
        ],
      })
      const project = importProject(json)

      expect(project.scenarios[0].steps.length).toBe(3)
      expect(project.scenarios[0].steps[0].kind).toBe('call-function')
      expect(project.scenarios[0].steps[1].kind).toBe('notify')
      expect(project.scenarios[0].steps[2].kind).toBe('respond')
    })

    it('should use default device settings when missing', () => {
      const json = JSON.stringify({ services: [] })
      const project = importProject(json)

      expect(project.deviceSettings).toEqual(DEFAULT_DEVICE_SETTINGS)
    })

    it('should parse partial device settings', () => {
      const json = JSON.stringify({
        deviceSettings: { deviceName: 'Custom Name' },
      })
      const project = importProject(json)

      expect(project.deviceSettings.deviceName).toBe('Custom Name')
      expect(project.deviceSettings.appearance).toBe(DEFAULT_DEVICE_SETTINGS.appearance)
    })
  })

  describe('legacy format', () => {
    it('should import array of services (legacy)', () => {
      const json = JSON.stringify([
        { uuid: 'svc1', tag: 'Service 1', characteristics: [] },
        { uuid: 'svc2', tag: 'Service 2', characteristics: [] },
      ])
      const project = importProject(json)

      expect(project.services.length).toBe(2)
      expect(project.functions).toEqual([])
      expect(project.variables).toEqual([])
      expect(project.deviceSettings).toEqual(DEFAULT_DEVICE_SETTINGS)
    })

    it('should throw for empty legacy array', () => {
      const json = JSON.stringify([])
      expect(() => importProject(json)).toThrow('No valid services found')
    })
  })

  describe('error handling', () => {
    it('should throw for invalid JSON', () => {
      expect(() => importProject('not json')).toThrow()
    })

    it('should throw for non-object/non-array', () => {
      expect(() => importProject('"just a string"')).toThrow('Invalid project format')
    })

    it('should skip invalid services', () => {
      const json = JSON.stringify({
        services: [{ uuid: 'valid', tag: 'Valid', characteristics: [] }, null, 'invalid', { uuid: 123 }],
      })
      const project = importProject(json)

      expect(project.services.length).toBe(2) // valid + {uuid: 123} converts to {uuid: ''}
    })

    it('should skip functions without name', () => {
      const json = JSON.stringify({
        functions: [{ name: 'valid', body: '' }, { body: 'no name' }, { name: '', body: '' }],
      })
      const project = importProject(json)

      expect(project.functions.length).toBe(1)
    })

    it('should skip variables without name', () => {
      const json = JSON.stringify({
        variables: [
          { name: 'valid', type: 'u8', initialValue: '0' },
          { type: 'u8', initialValue: '0' },
        ],
      })
      const project = importProject(json)

      expect(project.variables.length).toBe(1)
    })

    it('should skip scenarios without trigger', () => {
      const json = JSON.stringify({
        scenarios: [
          { name: 'valid', trigger: { kind: 'startup' }, steps: [] },
          { name: 'invalid', steps: [] },
        ],
      })
      const project = importProject(json)

      expect(project.scenarios.length).toBe(1)
    })

    it('should skip invalid step kinds', () => {
      const json = JSON.stringify({
        scenarios: [
          {
            name: 'Scenario',
            trigger: { kind: 'startup' },
            steps: [{ kind: 'respond' }, { kind: 'invalid-kind' }, null],
          },
        ],
      })
      const project = importProject(json)

      expect(project.scenarios[0].steps.length).toBe(1)
    })
  })

  describe('characteristic parsing', () => {
    it('should parse characteristics with properties', () => {
      const json = JSON.stringify({
        services: [
          {
            uuid: 'svc',
            tag: 'Service',
            characteristics: [
              {
                uuid: 'chr',
                tag: 'Char',
                properties: { read: true, write: true, notify: false },
                defaultValue: 'AA BB',
              },
            ],
          },
        ],
      })
      const project = importProject(json)

      const char = project.services[0].characteristics[0]
      expect(char.properties.read).toBe(true)
      expect(char.properties.write).toBe(true)
      expect(char.properties.notify).toBe(false)
      expect(char.defaultValue).toBe('AA BB')
    })

    it('should default properties to false', () => {
      const json = JSON.stringify({
        services: [
          {
            uuid: 'svc',
            characteristics: [{ uuid: 'chr', properties: {} }],
          },
        ],
      })
      const project = importProject(json)

      const char = project.services[0].characteristics[0]
      expect(char.properties.read).toBe(false)
      expect(char.properties.write).toBe(false)
      expect(char.properties.notify).toBe(false)
    })
  })
})

describe('roundtrip: export -> import', () => {
  it('should preserve services', () => {
    const original = createProject({
      services: [
        {
          id: crypto.randomUUID(),
          uuid: 'aabbccdd-0000-0000-0000-000000000000',
          tag: 'My Service',
          characteristics: [
            {
              id: crypto.randomUUID(),
              uuid: '11223344-0000-0000-0000-000000000000',
              tag: 'My Char',
              properties: { read: true, write: true, notify: true },
              defaultValue: 'FF',
            },
          ],
        },
      ],
    })

    const exported = exportProject(original)
    const imported = importProject(exported)

    expect(imported.services.length).toBe(1)
    expect(imported.services[0].uuid).toBe(original.services[0].uuid)
    expect(imported.services[0].tag).toBe(original.services[0].tag)
    expect(imported.services[0].characteristics[0].properties).toEqual(
      original.services[0].characteristics[0].properties
    )
  })

  it('should preserve functions', () => {
    const original = createProject({
      functions: [
        { id: '1', name: 'echo', body: 'return input;' },
        { id: '2', name: 'reverse', body: 'return input.reverse();' },
      ],
    })

    const exported = exportProject(original)
    const imported = importProject(exported)

    expect(imported.functions.length).toBe(2)
    expect(imported.functions[0].name).toBe('echo')
    expect(imported.functions[1].name).toBe('reverse')
  })

  it('should preserve variables', () => {
    const original = createProject({
      variables: [
        { id: '1', name: 'buf', type: 'hex', initialValue: 'AA BB CC' },
        { id: '2', name: 'count', type: 'u32', initialValue: '42' },
      ],
    })

    const exported = exportProject(original)
    const imported = importProject(exported)

    expect(imported.variables.length).toBe(2)
    expect(imported.variables[0].name).toBe('buf')
    expect(imported.variables[0].type).toBe('hex')
    expect(imported.variables[1].type).toBe('u32')
  })

  it('should preserve test-function relationships', () => {
    const fn: UserFunction = { id: crypto.randomUUID(), name: 'myFn', body: '' }
    const test: UserTest = {
      id: crypto.randomUUID(),
      name: 'test1',
      functionId: fn.id,
      inputHex: 'AA',
      expectedHex: 'BB',
    }
    const original = createProject({ functions: [fn], tests: [test] })

    const exported = exportProject(original)
    const imported = importProject(exported)

    expect(imported.tests[0].functionId).toBe(imported.functions[0].id)
  })

  it('should preserve device settings', () => {
    const original = createProject({
      deviceSettings: {
        deviceName: 'My BLE Device',
        appearance: 0x1234,
        manufacturerData: 'DE AD BE EF',
      },
    })

    const exported = exportProject(original)
    const imported = importProject(exported)

    expect(imported.deviceSettings).toEqual(original.deviceSettings)
  })

  it('should preserve scenarios', () => {
    const original = createProject({
      scenarios: [
        {
          id: crypto.randomUUID(),
          name: 'On Write',
          enabled: true,
          trigger: { kind: TriggerKind.CharWrite, serviceUuid: 'svc', charUuid: 'chr' },
          steps: [
            { kind: StepKind.CallFunction, functionName: 'process' },
            { kind: StepKind.Notify, serviceUuid: 'svc', charUuid: 'chr' },
          ],
        },
      ],
    })

    const exported = exportProject(original)
    const imported = importProject(exported)

    expect(imported.scenarios[0].name).toBe('On Write')
    expect(imported.scenarios[0].steps.length).toBe(2)
  })
})

describe('example schemas', () => {
  describe('defaultProject.json', () => {
    it('should import without errors', () => {
      const project = importProject(JSON.stringify(defaultProjectJson))
      expect(project.services.length).toBeGreaterThan(0)
      expect(project.functions.length).toBeGreaterThan(0)
    })

    it('should pass validation', () => {
      const project = importProject(JSON.stringify(defaultProjectJson))
      const result = validateSchema(
        project.services,
        project.deviceSettings,
        project.functions,
        project.variables,
        project.scenarios
      )
      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })

    it('should have valid scenario references', () => {
      const project = importProject(JSON.stringify(defaultProjectJson))
      const functionNames = new Set(project.functions.map(f => f.name))

      for (const scenario of project.scenarios) {
        for (const step of scenario.steps) {
          if (step.kind === 'call-function') {
            expect(functionNames.has(step.functionName)).toBe(true)
          }
        }
      }
    })

    it('should pass all function tests', () => {
      const project = importProject(JSON.stringify(defaultProjectJson))

      for (const test of project.tests) {
        const fn = project.functions.find(f => f.id === test.functionId)
        expect(fn).toBeDefined()
        if (!fn) continue

        const ctx = buildContext(
          project.variables,
          () => {},
          () => {}
        )
        const inputBytes = test.inputHex
          ? new Uint8Array(
              test.inputHex
                .split(/\s+/)
                .filter(Boolean)
                .map(h => parseInt(h, 16))
            )
          : new Uint8Array()

        const result = executeFunctionSync(fn, inputBytes, ctx)

        const expectedBytes = test.expectedHex
          ? new Uint8Array(
              test.expectedHex
                .split(/\s+/)
                .filter(Boolean)
                .map(h => parseInt(h, 16))
            )
          : new Uint8Array()

        // null result is equivalent to empty output
        const actualBytes = result ?? new Uint8Array()
        expect(actualBytes).toEqual(expectedBytes)
      }
    })
  })

  describe('heartRateMonitor.json', () => {
    it('should import without errors', () => {
      const project = importProject(JSON.stringify(heartRateMonitorJson))
      expect(project.services.length).toBe(2) // HR Service + Battery Service
      expect(project.functions.length).toBeGreaterThan(0)
      expect(project.variables.length).toBeGreaterThan(0)
    })

    it('should pass validation', () => {
      const project = importProject(JSON.stringify(heartRateMonitorJson))
      const result = validateSchema(
        project.services,
        project.deviceSettings,
        project.functions,
        project.variables,
        project.scenarios
      )
      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })

    it('should have correct BLE UUIDs', () => {
      const project = importProject(JSON.stringify(heartRateMonitorJson))

      // Heart Rate Service UUID
      const hrService = project.services.find(s => s.uuid === '0000180d-0000-1000-8000-00805f9b34fb')
      expect(hrService).toBeDefined()
      expect(hrService?.tag).toBe('Heart Rate Service')

      // Battery Service UUID
      const batteryService = project.services.find(s => s.uuid === '0000180f-0000-1000-8000-00805f9b34fb')
      expect(batteryService).toBeDefined()
      expect(batteryService?.tag).toBe('Battery Service')
    })

    it('should have valid scenario references', () => {
      const project = importProject(JSON.stringify(heartRateMonitorJson))
      const functionNames = new Set(project.functions.map(f => f.name))

      for (const scenario of project.scenarios) {
        for (const step of scenario.steps) {
          if (step.kind === 'call-function') {
            expect(functionNames.has(step.functionName)).toBe(true)
          }
        }
      }
    })

    it('should pass all function tests', () => {
      const project = importProject(JSON.stringify(heartRateMonitorJson))

      for (const test of project.tests) {
        const fn = project.functions.find(f => f.id === test.functionId)
        expect(fn).toBeDefined()
        if (!fn) continue

        const ctx = buildContext(
          project.variables,
          () => {},
          () => {}
        )
        const inputBytes = test.inputHex
          ? new Uint8Array(
              test.inputHex
                .split(/\s+/)
                .filter(Boolean)
                .map(h => parseInt(h, 16))
            )
          : new Uint8Array()

        const result = executeFunctionSync(fn, inputBytes, ctx)

        const expectedBytes = test.expectedHex
          ? new Uint8Array(
              test.expectedHex
                .split(/\s+/)
                .filter(Boolean)
                .map(h => parseInt(h, 16))
            )
          : new Uint8Array()

        // null result is equivalent to empty output
        const actualBytes = result ?? new Uint8Array()
        expect(actualBytes).toEqual(expectedBytes)
      }
    })
  })
})
