/**
 * Schema validation before upload.
 * Catches errors early instead of failing mid-upload.
 */

import {
  TriggerKind,
  StepKind,
  type Schema,
  type DeviceSettings,
  type UserFunction,
  type UserVariable,
  type Scenario,
} from '../types'
import {
  MAX_SERVICES,
  MAX_CHARS_PER_SERVICE,
  MAX_DEVICE_NAME_BYTES,
  MAX_MANUFACTURER_DATA_BYTES,
  BLE_ADV_PACKET_MAX,
  calculateAdvPacketSize,
} from './constants'

export interface ValidationError {
  path: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const HEX_TOKEN_REGEX = /^[0-9a-fA-F]{1,2}$/
const IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/

function isValidUuid(uuid: string): boolean {
  return UUID_REGEX.test(uuid)
}

function isValidHex(hex: string): boolean {
  if (!hex.trim()) return true // empty is valid
  const tokens = hex.trim().split(/\s+/)
  return tokens.every(t => HEX_TOKEN_REGEX.test(t))
}

function isValidIdentifier(name: string): boolean {
  return IDENTIFIER_REGEX.test(name)
}

function getUtf8ByteLength(str: string): number {
  return new TextEncoder().encode(str).length
}

export function validateSchema(
  services: Schema,
  deviceSettings: DeviceSettings,
  functions: UserFunction[],
  variables: UserVariable[],
  scenarios: Scenario[]
): ValidationResult {
  const errors: ValidationError[] = []

  // Device settings validation
  if (!deviceSettings.deviceName.trim()) {
    errors.push({ path: 'deviceSettings.deviceName', message: 'Device name is required' })
  } else if (getUtf8ByteLength(deviceSettings.deviceName) > MAX_DEVICE_NAME_BYTES) {
    errors.push({
      path: 'deviceSettings.deviceName',
      message: `Device name too long: ${getUtf8ByteLength(deviceSettings.deviceName)} bytes (max ${MAX_DEVICE_NAME_BYTES})`,
    })
  }

  let mfrDataBytes = 0
  if (deviceSettings.manufacturerData.trim()) {
    if (!isValidHex(deviceSettings.manufacturerData)) {
      errors.push({ path: 'deviceSettings.manufacturerData', message: 'Invalid hex format' })
    } else {
      const tokens = deviceSettings.manufacturerData.trim().split(/\s+/).filter(Boolean)
      mfrDataBytes = tokens.length
      if (mfrDataBytes > MAX_MANUFACTURER_DATA_BYTES) {
        errors.push({
          path: 'deviceSettings.manufacturerData',
          message: `Manufacturer data too long: ${mfrDataBytes} bytes (max ${MAX_MANUFACTURER_DATA_BYTES})`,
        })
      }
    }
  }

  // Count 16-bit service UUIDs (standard Bluetooth UUIDs like 0x180D)
  const shortUuidPattern = /^0000[0-9a-f]{4}-0000-1000-8000-00805f9b34fb$/i
  const numShortUuids = services.filter(svc => shortUuidPattern.test(svc.uuid)).length

  // Validate total advertising packet size
  const nameBytes = getUtf8ByteLength(deviceSettings.deviceName)
  const advPacketSize = calculateAdvPacketSize(
    nameBytes,
    deviceSettings.appearance ?? 0,
    mfrDataBytes,
    Math.min(numShortUuids, 2) // Only first 2 UUIDs are advertised
  )
  if (advPacketSize > BLE_ADV_PACKET_MAX) {
    errors.push({
      path: 'deviceSettings',
      message: `Advertising data too large: ${advPacketSize} bytes (max ${BLE_ADV_PACKET_MAX}). Reduce device name, disable appearance, or remove manufacturer data.`,
    })
  }

  // Services validation
  if (services.length === 0) {
    errors.push({ path: 'services', message: 'At least one service is required' })
  }

  if (services.length > MAX_SERVICES) {
    errors.push({ path: 'services', message: `Too many services: ${services.length} (max ${MAX_SERVICES})` })
  }

  // Track all UUIDs for duplicate detection
  const allUuids = new Map<string, string>() // uuid -> path

  for (let svcIdx = 0; svcIdx < services.length; svcIdx++) {
    const svc = services[svcIdx]
    const svcPath = `services[${svcIdx}]`
    const svcLabel = svc.tag || `Service ${svcIdx + 1}`

    // Service UUID
    if (!svc.uuid.trim()) {
      errors.push({ path: `${svcPath}.uuid`, message: `${svcLabel}: UUID is required` })
    } else if (!isValidUuid(svc.uuid)) {
      errors.push({ path: `${svcPath}.uuid`, message: `${svcLabel}: Invalid UUID format` })
    } else {
      const normalizedUuid = svc.uuid.toLowerCase()
      if (allUuids.has(normalizedUuid)) {
        errors.push({
          path: `${svcPath}.uuid`,
          message: `${svcLabel}: Duplicate UUID (also used in ${allUuids.get(normalizedUuid)})`,
        })
      } else {
        allUuids.set(normalizedUuid, svcLabel)
      }
    }

    // Characteristics
    if (svc.characteristics.length > MAX_CHARS_PER_SERVICE) {
      errors.push({
        path: `${svcPath}.characteristics`,
        message: `${svcLabel}: Too many characteristics: ${svc.characteristics.length} (max ${MAX_CHARS_PER_SERVICE})`,
      })
    }

    for (let chrIdx = 0; chrIdx < svc.characteristics.length; chrIdx++) {
      const chr = svc.characteristics[chrIdx]
      const chrPath = `${svcPath}.characteristics[${chrIdx}]`
      const chrLabel = chr.tag || `Char ${chrIdx + 1}`
      const fullLabel = `${svcLabel} > ${chrLabel}`

      // Characteristic UUID
      if (!chr.uuid.trim()) {
        errors.push({ path: `${chrPath}.uuid`, message: `${fullLabel}: UUID is required` })
      } else if (!isValidUuid(chr.uuid)) {
        errors.push({ path: `${chrPath}.uuid`, message: `${fullLabel}: Invalid UUID format` })
      } else {
        const normalizedUuid = chr.uuid.toLowerCase()
        if (allUuids.has(normalizedUuid)) {
          errors.push({
            path: `${chrPath}.uuid`,
            message: `${fullLabel}: Duplicate UUID (also used in ${allUuids.get(normalizedUuid)})`,
          })
        } else {
          allUuids.set(normalizedUuid, fullLabel)
        }
      }

      // Properties
      if (!chr.properties.read && !chr.properties.write && !chr.properties.notify) {
        errors.push({
          path: `${chrPath}.properties`,
          message: `${fullLabel}: At least one property (read/write/notify) must be enabled`,
        })
      }

      // Default value
      if (chr.defaultValue.trim() && !isValidHex(chr.defaultValue)) {
        errors.push({ path: `${chrPath}.defaultValue`, message: `${fullLabel}: Invalid hex format in default value` })
      }
    }
  }

  // Functions validation
  const fnNames = new Set<string>()
  for (let i = 0; i < functions.length; i++) {
    const fn = functions[i]
    const fnPath = `functions[${i}]`

    if (!fn.name.trim()) {
      errors.push({ path: `${fnPath}.name`, message: `Function ${i + 1}: Name is required` })
    } else if (!isValidIdentifier(fn.name)) {
      errors.push({
        path: `${fnPath}.name`,
        message: `Function "${fn.name}": Invalid name (must start with letter/underscore, contain only letters/digits/underscores)`,
      })
    } else if (fnNames.has(fn.name)) {
      errors.push({ path: `${fnPath}.name`, message: `Function "${fn.name}": Duplicate name` })
    } else {
      fnNames.add(fn.name)
    }
  }

  // Variables validation
  const varNames = new Set<string>()
  for (let i = 0; i < variables.length; i++) {
    const v = variables[i]
    const vPath = `variables[${i}]`

    if (!v.name.trim()) {
      errors.push({ path: `${vPath}.name`, message: `Variable ${i + 1}: Name is required` })
    } else if (!isValidIdentifier(v.name)) {
      errors.push({
        path: `${vPath}.name`,
        message: `Variable "${v.name}": Invalid name (must start with letter/underscore, contain only letters/digits/underscores)`,
      })
    } else if (varNames.has(v.name)) {
      errors.push({ path: `${vPath}.name`, message: `Variable "${v.name}": Duplicate name` })
    } else {
      varNames.add(v.name)
    }

    // Validate initial value based on type
    if (v.type === 'hex' && v.initialValue.trim() && !isValidHex(v.initialValue)) {
      errors.push({ path: `${vPath}.initialValue`, message: `Variable "${v.name}": Invalid hex format` })
    }
  }

  // Build lookup for valid service/char pairs
  const validChars = new Map<string, Set<string>>() // serviceUuid -> Set<charUuid>
  const notifyChars = new Map<string, Set<string>>() // serviceUuid -> Set<charUuid with notify>
  for (const svc of services) {
    const svcUuid = svc.uuid.toLowerCase()
    validChars.set(svcUuid, new Set())
    notifyChars.set(svcUuid, new Set())
    for (const chr of svc.characteristics) {
      const chrUuid = chr.uuid.toLowerCase()
      validChars.get(svcUuid)!.add(chrUuid)
      if (chr.properties.notify) {
        notifyChars.get(svcUuid)!.add(chrUuid)
      }
    }
  }

  // Scenarios validation
  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i]
    const scenPath = `scenarios[${i}]`
    const scenLabel = scenario.name || `Scenario ${i + 1}`

    if (!scenario.name.trim()) {
      errors.push({ path: `${scenPath}.name`, message: `Scenario ${i + 1}: Name is required` })
    }

    // Validate trigger
    const trigger = scenario.trigger
    if (trigger.kind === TriggerKind.CharWrite || trigger.kind === TriggerKind.CharRead) {
      const svcUuid = trigger.serviceUuid.toLowerCase()
      const chrUuid = trigger.charUuid.toLowerCase()
      const charSet = validChars.get(svcUuid)
      if (!charSet) {
        errors.push({
          path: `${scenPath}.trigger`,
          message: `${scenLabel}: Trigger references unknown service UUID`,
        })
      } else if (!charSet.has(chrUuid)) {
        errors.push({
          path: `${scenPath}.trigger`,
          message: `${scenLabel}: Trigger references unknown characteristic UUID`,
        })
      }
    } else if (trigger.kind === TriggerKind.Timer) {
      if (trigger.intervalMs <= 0) {
        errors.push({
          path: `${scenPath}.trigger`,
          message: `${scenLabel}: Timer interval must be positive`,
        })
      }
    }

    // Validate steps
    for (let j = 0; j < scenario.steps.length; j++) {
      const step = scenario.steps[j]
      const stepPath = `${scenPath}.steps[${j}]`

      if (step.kind === StepKind.CallFunction) {
        if (!fnNames.has(step.functionName)) {
          errors.push({
            path: stepPath,
            message: `${scenLabel} step ${j + 1}: References unknown function "${step.functionName}"`,
          })
        }
      } else if (step.kind === StepKind.Notify) {
        const svcUuid = step.serviceUuid.toLowerCase()
        const chrUuid = step.charUuid.toLowerCase()
        const charSet = validChars.get(svcUuid)
        if (!charSet) {
          errors.push({
            path: stepPath,
            message: `${scenLabel} step ${j + 1}: Notify references unknown service UUID`,
          })
        } else if (!charSet.has(chrUuid)) {
          errors.push({
            path: stepPath,
            message: `${scenLabel} step ${j + 1}: Notify references unknown characteristic UUID`,
          })
        } else if (!notifyChars.get(svcUuid)!.has(chrUuid)) {
          errors.push({
            path: stepPath,
            message: `${scenLabel} step ${j + 1}: Characteristic does not have notify property enabled`,
          })
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/** Format validation errors for display */
export function formatValidationErrors(result: ValidationResult): string {
  if (result.valid) return ''
  return result.errors.map(e => `• ${e.message}`).join('\n')
}
