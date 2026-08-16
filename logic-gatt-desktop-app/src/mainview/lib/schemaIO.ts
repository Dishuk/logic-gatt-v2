import {
  TriggerKind,
  StepKind,
  type Schema,
  type Service,
  type Characteristic,
  type UserFunction,
  type UserVariable,
  type UserTest,
  type Scenario,
  type Trigger,
  type Step,
  type VarType,
  type DeviceSettings,
} from '../types'

export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = {
  deviceName: 'logic-gatt-emu',
  appearance: 0,
  manufacturerData: '',
}

/** Full project export format */
export interface ProjectData {
  deviceSettings: DeviceSettings
  services: Schema
  functions: UserFunction[]
  variables: UserVariable[]
  tests: UserTest[]
  scenarios: Scenario[]
}

/** Strip runtime-only `id` fields for a clean service export. */
function stripServiceIds(schema: Schema): unknown[] {
  return schema.map(s => ({
    uuid: s.uuid,
    tag: s.tag,
    characteristics: s.characteristics.map(c => ({
      uuid: c.uuid,
      tag: c.tag,
      properties: { ...c.properties },
      defaultValue: c.defaultValue,
    })),
  }))
}

/** Strip IDs from functions */
function stripFunctionIds(fns: UserFunction[]): unknown[] {
  return fns.map(f => ({ name: f.name, body: f.body }))
}

/** Strip IDs from variables */
function stripVariableIds(vars: UserVariable[]): unknown[] {
  return vars.map(v => ({ name: v.name, type: v.type, initialValue: v.initialValue }))
}

/** Strip IDs from tests - keep functionId as functionName reference */
function stripTestIds(tests: UserTest[], functions: UserFunction[]): unknown[] {
  return tests.map(t => {
    const fn = functions.find(f => f.id === t.functionId)
    return {
      name: t.name,
      functionName: fn?.name ?? '',
      inputHex: t.inputHex,
      expectedHex: t.expectedHex,
    }
  })
}

/** Strip IDs from scenarios */
function stripScenarioIds(scenarios: Scenario[]): unknown[] {
  return scenarios.map(s => ({
    name: s.name,
    enabled: s.enabled,
    trigger: s.trigger,
    steps: s.steps,
  }))
}

export function exportProject(data: ProjectData): string {
  return JSON.stringify(
    {
      deviceSettings: data.deviceSettings,
      services: stripServiceIds(data.services),
      functions: stripFunctionIds(data.functions),
      variables: stripVariableIds(data.variables),
      tests: stripTestIds(data.tests, data.functions),
      scenarios: stripScenarioIds(data.scenarios),
    },
    null,
    2
  )
}

export function downloadProject(data: ProjectData) {
  const blob = new Blob([exportProject(data)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'gatt-project.json'
  a.click()
  URL.revokeObjectURL(url)
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseChar(raw: unknown): Characteristic | null {
  if (!isObj(raw)) return null
  const uuid = typeof raw.uuid === 'string' ? raw.uuid : ''
  const tag = typeof raw.tag === 'string' ? raw.tag : ''
  const defaultValue = typeof raw.defaultValue === 'string' ? raw.defaultValue : ''
  const props = isObj(raw.properties) ? raw.properties : {}
  return {
    id: crypto.randomUUID(),
    uuid,
    tag,
    properties: {
      read: props.read === true,
      write: props.write === true,
      notify: props.notify === true,
    },
    defaultValue,
  }
}

function parseService(raw: unknown): Service | null {
  if (!isObj(raw)) return null
  const uuid = typeof raw.uuid === 'string' ? raw.uuid : ''
  const tag = typeof raw.tag === 'string' ? raw.tag : ''
  const chars = Array.isArray(raw.characteristics)
    ? (raw.characteristics.map(parseChar).filter(Boolean) as Characteristic[])
    : []
  return { id: crypto.randomUUID(), uuid, tag, characteristics: chars }
}

function parseFunction(raw: unknown): UserFunction | null {
  if (!isObj(raw)) return null
  const name = typeof raw.name === 'string' ? raw.name : ''
  const body = typeof raw.body === 'string' ? raw.body : ''
  if (!name) return null
  return { id: crypto.randomUUID(), name, body }
}

const VALID_VAR_TYPES: VarType[] = ['hex', 'u8', 'u16', 'u32', 'string']

function parseVariable(raw: unknown): UserVariable | null {
  if (!isObj(raw)) return null
  const name = typeof raw.name === 'string' ? raw.name : ''
  const type = VALID_VAR_TYPES.includes(raw.type as VarType) ? (raw.type as VarType) : 'hex'
  const initialValue = typeof raw.initialValue === 'string' ? raw.initialValue : ''
  if (!name) return null
  return { id: crypto.randomUUID(), name, type, initialValue }
}

function parseTest(raw: unknown, functions: UserFunction[]): UserTest | null {
  if (!isObj(raw)) return null
  const name = typeof raw.name === 'string' ? raw.name : ''
  const functionName = typeof raw.functionName === 'string' ? raw.functionName : ''
  const inputHex = typeof raw.inputHex === 'string' ? raw.inputHex : ''
  const expectedHex = typeof raw.expectedHex === 'string' ? raw.expectedHex : ''
  if (!name) return null
  const fn = functions.find(f => f.name === functionName)
  return { id: crypto.randomUUID(), name, functionId: fn?.id ?? '', inputHex, expectedHex }
}

function parseTrigger(raw: unknown): Trigger | null {
  if (!isObj(raw)) return null
  const kind = raw.kind
  if (kind === TriggerKind.CharWrite || kind === TriggerKind.CharRead) {
    return {
      kind,
      serviceUuid: typeof raw.serviceUuid === 'string' ? raw.serviceUuid : '',
      charUuid: typeof raw.charUuid === 'string' ? raw.charUuid : '',
    }
  }
  if (kind === TriggerKind.Timer) {
    return {
      kind: TriggerKind.Timer,
      intervalMs: typeof raw.intervalMs === 'number' ? raw.intervalMs : 1000,
      repeat: raw.repeat === true,
    }
  }
  if (kind === TriggerKind.Startup) {
    return { kind: TriggerKind.Startup }
  }
  if (kind === TriggerKind.Manual) {
    return { kind: TriggerKind.Manual }
  }
  return null
}

function parseStep(raw: unknown): Step | null {
  if (!isObj(raw)) return null
  const kind = raw.kind
  if (kind === StepKind.CallFunction) {
    return {
      kind: StepKind.CallFunction,
      functionName: typeof raw.functionName === 'string' ? raw.functionName : '',
    }
  }
  if (kind === StepKind.Notify) {
    return {
      kind: StepKind.Notify,
      serviceUuid: typeof raw.serviceUuid === 'string' ? raw.serviceUuid : '',
      charUuid: typeof raw.charUuid === 'string' ? raw.charUuid : '',
    }
  }
  if (kind === StepKind.Respond) {
    return { kind: StepKind.Respond }
  }
  return null
}

function parseScenario(raw: unknown): Scenario | null {
  if (!isObj(raw)) return null
  const name = typeof raw.name === 'string' ? raw.name : ''
  const enabled = raw.enabled !== false
  const trigger = parseTrigger(raw.trigger)
  const steps = Array.isArray(raw.steps) ? (raw.steps.map(parseStep).filter(Boolean) as Step[]) : []
  if (!name || !trigger) return null
  return { id: crypto.randomUUID(), name, enabled, trigger, steps }
}

function parseDeviceSettings(raw: unknown): DeviceSettings {
  if (!isObj(raw)) return { ...DEFAULT_DEVICE_SETTINGS }
  // Accept both "deviceName" and legacy "name" key
  const name =
    typeof raw.deviceName === 'string'
      ? raw.deviceName
      : typeof raw.name === 'string'
        ? raw.name
        : DEFAULT_DEVICE_SETTINGS.deviceName
  return {
    deviceName: name,
    appearance: typeof raw.appearance === 'number' ? raw.appearance : DEFAULT_DEVICE_SETTINGS.appearance,
    manufacturerData:
      typeof raw.manufacturerData === 'string' ? raw.manufacturerData : DEFAULT_DEVICE_SETTINGS.manufacturerData,
  }
}

/** Import from new project format or legacy services-only format */
export function importProject(json: string): ProjectData {
  const parsed = JSON.parse(json)

  // Legacy format: array of services
  if (Array.isArray(parsed)) {
    const services = parsed.map(parseService).filter(Boolean) as Service[]
    if (services.length === 0) throw new Error('No valid services found')
    return {
      deviceSettings: { ...DEFAULT_DEVICE_SETTINGS },
      services,
      functions: [],
      variables: [],
      tests: [],
      scenarios: [],
    }
  }

  // New format: object with services, functions, variables, tests, scenarios
  if (!isObj(parsed)) throw new Error('Invalid project format')

  const deviceSettings = parseDeviceSettings(parsed.deviceSettings)

  const services = Array.isArray(parsed.services)
    ? (parsed.services.map(parseService).filter(Boolean) as Service[])
    : []

  const functions = Array.isArray(parsed.functions)
    ? (parsed.functions.map(parseFunction).filter(Boolean) as UserFunction[])
    : []

  const variables = Array.isArray(parsed.variables)
    ? (parsed.variables.map(parseVariable).filter(Boolean) as UserVariable[])
    : []

  const tests = Array.isArray(parsed.tests)
    ? (parsed.tests.map((t: unknown) => parseTest(t, functions)).filter(Boolean) as UserTest[])
    : []

  const scenarios = Array.isArray(parsed.scenarios)
    ? (parsed.scenarios.map(parseScenario).filter(Boolean) as Scenario[])
    : []

  return { deviceSettings, services, functions, variables, tests, scenarios }
}

export function pickAndImportProject(): Promise<ProjectData> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return reject(new Error('No file selected'))
      try {
        const text = await file.text()
        resolve(importProject(text))
      } catch (err) {
        reject(err)
      }
    }
    input.click()
  })
}
