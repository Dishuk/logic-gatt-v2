import { describe, it, expect } from 'vitest'
import { validateSchema, formatValidationErrors } from '../lib/validation'
import { TriggerKind, StepKind } from '../types'
import type { Service, DeviceSettings } from '../types'

const validUuid = '12345678-1234-1234-1234-123456789abc'
const validUuid2 = '12345678-1234-1234-1234-123456789abd'
const validUuid3 = '12345678-1234-1234-1234-123456789abe'

function createService(overrides?: Partial<Service>): Service {
  return {
    id: crypto.randomUUID(),
    uuid: validUuid,
    tag: 'Test Service',
    characteristics: [
      {
        id: crypto.randomUUID(),
        uuid: validUuid2,
        tag: 'Test Char',
        properties: { read: true, write: false, notify: false },
        defaultValue: '',
      },
    ],
    ...overrides,
  }
}

function createDeviceSettings(overrides?: Partial<DeviceSettings>): DeviceSettings {
  return {
    deviceName: 'test-device',
    appearance: 0,
    manufacturerData: '',
    ...overrides,
  }
}

describe('validateSchema', () => {
  describe('device settings', () => {
    it('should pass with valid device settings', () => {
      const result = validateSchema([createService()], createDeviceSettings(), [], [], [])
      expect(result.valid).toBe(true)
    })

    it('should fail when device name is empty', () => {
      const result = validateSchema([createService()], createDeviceSettings({ deviceName: '' }), [], [], [])
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('Device name is required'))).toBe(true)
    })

    it('should fail when device name exceeds 29 bytes', () => {
      const result = validateSchema([createService()], createDeviceSettings({ deviceName: 'a'.repeat(30) }), [], [], [])
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('too long'))).toBe(true)
    })

    it('should fail with invalid manufacturer data hex', () => {
      const result = validateSchema([createService()], createDeviceSettings({ manufacturerData: 'ZZ XX' }), [], [], [])
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('Invalid hex'))).toBe(true)
    })

    it('should fail when manufacturer data exceeds 24 bytes', () => {
      const result = validateSchema(
        [createService()],
        createDeviceSettings({ manufacturerData: Array(25).fill('AA').join(' ') }),
        [],
        [],
        []
      )
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('Manufacturer data too long'))).toBe(true)
    })
  })

  describe('services', () => {
    it('should fail when no services provided', () => {
      const result = validateSchema([], createDeviceSettings(), [], [], [])
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('At least one service'))).toBe(true)
    })

    it('should fail when too many services', () => {
      const services = Array(9)
        .fill(null)
        .map((_, i) =>
          createService({
            uuid: `1234567${i}-1234-1234-1234-123456789abc`,
            characteristics: [
              {
                id: crypto.randomUUID(),
                uuid: `1234567${i}-1234-1234-1234-123456789abd`,
                tag: '',
                properties: { read: true, write: false, notify: false },
                defaultValue: '',
              },
            ],
          })
        )
      const result = validateSchema(services, createDeviceSettings(), [], [], [])
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('Too many services'))).toBe(true)
    })

    it('should fail with empty service UUID', () => {
      const result = validateSchema([createService({ uuid: '' })], createDeviceSettings(), [], [], [])
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('UUID is required'))).toBe(true)
    })

    it('should fail with invalid service UUID format', () => {
      const result = validateSchema([createService({ uuid: 'not-a-uuid' })], createDeviceSettings(), [], [], [])
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('Invalid UUID format'))).toBe(true)
    })

    it('should fail with duplicate service UUIDs', () => {
      const result = validateSchema(
        [
          createService({
            characteristics: [
              {
                id: '1',
                uuid: validUuid2,
                tag: '',
                properties: { read: true, write: false, notify: false },
                defaultValue: '',
              },
            ],
          }),
          createService({
            characteristics: [
              {
                id: '2',
                uuid: validUuid3,
                tag: '',
                properties: { read: true, write: false, notify: false },
                defaultValue: '',
              },
            ],
          }),
        ],
        createDeviceSettings(),
        [],
        [],
        []
      )
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('Duplicate UUID'))).toBe(true)
    })
  })

  describe('characteristics', () => {
    it('should fail with too many characteristics', () => {
      const chars = Array(17)
        .fill(null)
        .map((_, i) => ({
          id: crypto.randomUUID(),
          uuid: `1234567${i.toString().padStart(1, '0')}-1234-1234-1234-123456789abc`,
          tag: '',
          properties: { read: true, write: false, notify: false },
          defaultValue: '',
        }))
      const result = validateSchema([createService({ characteristics: chars })], createDeviceSettings(), [], [], [])
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('Too many characteristics'))).toBe(true)
    })

    it('should fail with no properties enabled', () => {
      const result = validateSchema(
        [
          createService({
            characteristics: [
              {
                id: '1',
                uuid: validUuid2,
                tag: '',
                properties: { read: false, write: false, notify: false },
                defaultValue: '',
              },
            ],
          }),
        ],
        createDeviceSettings(),
        [],
        [],
        []
      )
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('At least one property'))).toBe(true)
    })

    it('should fail with invalid default value hex', () => {
      const result = validateSchema(
        [
          createService({
            characteristics: [
              {
                id: '1',
                uuid: validUuid2,
                tag: '',
                properties: { read: true, write: false, notify: false },
                defaultValue: 'ZZ',
              },
            ],
          }),
        ],
        createDeviceSettings(),
        [],
        [],
        []
      )
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('Invalid hex format'))).toBe(true)
    })

    it('should fail with duplicate characteristic UUID', () => {
      const result = validateSchema(
        [
          createService({
            characteristics: [
              {
                id: '1',
                uuid: validUuid2,
                tag: '',
                properties: { read: true, write: false, notify: false },
                defaultValue: '',
              },
              {
                id: '2',
                uuid: validUuid2,
                tag: '',
                properties: { read: true, write: false, notify: false },
                defaultValue: '',
              },
            ],
          }),
        ],
        createDeviceSettings(),
        [],
        [],
        []
      )
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('Duplicate UUID'))).toBe(true)
    })
  })

  describe('functions', () => {
    it('should pass with valid function', () => {
      const result = validateSchema(
        [createService()],
        createDeviceSettings(),
        [{ id: '1', name: 'myFunc', body: 'return input;' }],
        [],
        []
      )
      expect(result.valid).toBe(true)
    })

    it('should fail with empty function name', () => {
      const result = validateSchema(
        [createService()],
        createDeviceSettings(),
        [{ id: '1', name: '', body: '' }],
        [],
        []
      )
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('Name is required'))).toBe(true)
    })

    it('should fail with invalid function name', () => {
      const result = validateSchema(
        [createService()],
        createDeviceSettings(),
        [{ id: '1', name: '123invalid', body: '' }],
        [],
        []
      )
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('Invalid name'))).toBe(true)
    })

    it('should fail with duplicate function names', () => {
      const result = validateSchema(
        [createService()],
        createDeviceSettings(),
        [
          { id: '1', name: 'myFunc', body: '' },
          { id: '2', name: 'myFunc', body: '' },
        ],
        [],
        []
      )
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('Duplicate name'))).toBe(true)
    })
  })

  describe('variables', () => {
    it('should pass with valid variable', () => {
      const result = validateSchema(
        [createService()],
        createDeviceSettings(),
        [],
        [{ id: '1', name: 'myVar', type: 'u8', initialValue: '42' }],
        []
      )
      expect(result.valid).toBe(true)
    })

    it('should fail with empty variable name', () => {
      const result = validateSchema(
        [createService()],
        createDeviceSettings(),
        [],
        [{ id: '1', name: '', type: 'u8', initialValue: '' }],
        []
      )
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('Name is required'))).toBe(true)
    })

    it('should fail with invalid hex initial value', () => {
      const result = validateSchema(
        [createService()],
        createDeviceSettings(),
        [],
        [{ id: '1', name: 'myVar', type: 'hex', initialValue: 'ZZ' }],
        []
      )
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('Invalid hex format'))).toBe(true)
    })

    it('should fail with duplicate variable names', () => {
      const result = validateSchema(
        [createService()],
        createDeviceSettings(),
        [],
        [
          { id: '1', name: 'myVar', type: 'u8', initialValue: '' },
          { id: '2', name: 'myVar', type: 'u8', initialValue: '' },
        ],
        []
      )
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('Duplicate name'))).toBe(true)
    })
  })

  describe('scenarios', () => {
    it('should pass with valid char-write scenario', () => {
      const result = validateSchema(
        [createService()],
        createDeviceSettings(),
        [{ id: '1', name: 'handler', body: '' }],
        [],
        [
          {
            id: '1',
            name: 'On Write',
            enabled: true,
            trigger: { kind: TriggerKind.CharWrite, serviceUuid: validUuid, charUuid: validUuid2 },
            steps: [{ kind: StepKind.CallFunction, functionName: 'handler' }],
          },
        ]
      )
      expect(result.valid).toBe(true)
    })

    it('should fail with unknown service UUID in trigger', () => {
      const result = validateSchema(
        [createService()],
        createDeviceSettings(),
        [],
        [],
        [
          {
            id: '1',
            name: 'Bad Trigger',
            enabled: true,
            trigger: { kind: TriggerKind.CharWrite, serviceUuid: validUuid3, charUuid: validUuid2 },
            steps: [],
          },
        ]
      )
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('unknown service UUID'))).toBe(true)
    })

    it('should fail with unknown char UUID in trigger', () => {
      const result = validateSchema(
        [createService()],
        createDeviceSettings(),
        [],
        [],
        [
          {
            id: '1',
            name: 'Bad Trigger',
            enabled: true,
            trigger: { kind: TriggerKind.CharWrite, serviceUuid: validUuid, charUuid: validUuid3 },
            steps: [],
          },
        ]
      )
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('unknown characteristic UUID'))).toBe(true)
    })

    it('should fail with negative timer interval', () => {
      const result = validateSchema(
        [createService()],
        createDeviceSettings(),
        [],
        [],
        [
          {
            id: '1',
            name: 'Bad Timer',
            enabled: true,
            trigger: { kind: TriggerKind.Timer, intervalMs: -100, repeat: false },
            steps: [],
          },
        ]
      )
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('Timer interval must be positive'))).toBe(true)
    })

    it('should fail with unknown function in call-function step', () => {
      const result = validateSchema(
        [createService()],
        createDeviceSettings(),
        [],
        [],
        [
          {
            id: '1',
            name: 'Bad Step',
            enabled: true,
            trigger: { kind: TriggerKind.Startup },
            steps: [{ kind: StepKind.CallFunction, functionName: 'nonexistent' }],
          },
        ]
      )
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('unknown function'))).toBe(true)
    })

    it('should fail when notify step references char without notify property', () => {
      const result = validateSchema(
        [
          createService({
            characteristics: [
              {
                id: '1',
                uuid: validUuid2,
                tag: '',
                properties: { read: true, write: true, notify: false },
                defaultValue: '',
              },
            ],
          }),
        ],
        createDeviceSettings(),
        [],
        [],
        [
          {
            id: '1',
            name: 'Bad Notify',
            enabled: true,
            trigger: { kind: TriggerKind.Startup },
            steps: [{ kind: StepKind.Notify, serviceUuid: validUuid, charUuid: validUuid2 }],
          },
        ]
      )
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('does not have notify property'))).toBe(true)
    })

    it('should pass when notify step references char with notify property', () => {
      const result = validateSchema(
        [
          createService({
            characteristics: [
              {
                id: '1',
                uuid: validUuid2,
                tag: '',
                properties: { read: true, write: true, notify: true },
                defaultValue: '',
              },
            ],
          }),
        ],
        createDeviceSettings(),
        [],
        [],
        [
          {
            id: '1',
            name: 'Good Notify',
            enabled: true,
            trigger: { kind: TriggerKind.Startup },
            steps: [{ kind: StepKind.Notify, serviceUuid: validUuid, charUuid: validUuid2 }],
          },
        ]
      )
      expect(result.valid).toBe(true)
    })
  })
})

describe('formatValidationErrors', () => {
  it('should return empty string for valid result', () => {
    const result = formatValidationErrors({ valid: true, errors: [] })
    expect(result).toBe('')
  })

  it('should format errors as bullet points', () => {
    const result = formatValidationErrors({
      valid: false,
      errors: [
        { path: 'a', message: 'Error 1' },
        { path: 'b', message: 'Error 2' },
      ],
    })
    expect(result).toBe('• Error 1\n• Error 2')
  })
})
