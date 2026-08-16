export interface DeviceSettings {
  deviceName: string
  appearance: number
  manufacturerData: string // hex string
}

export interface Characteristic {
  id: string
  uuid: string
  tag: string
  properties: { read: boolean; write: boolean; notify: boolean }
  defaultValue: string
}

export interface Service {
  id: string
  uuid: string
  tag: string
  characteristics: Characteristic[]
}

export type Schema = Service[]

export type VarType = 'hex' | 'u8' | 'u16' | 'u32' | 'string'

// Enums for trigger and step kinds to prevent typos
export enum TriggerKind {
  CharWrite = 'char-write',
  CharRead = 'char-read',
  Timer = 'timer',
  Startup = 'startup',
  Manual = 'manual',
}

export enum StepKind {
  CallFunction = 'call-function',
  Notify = 'notify',
  Respond = 'respond',
}

export interface UserFunction {
  id: string
  name: string
  body: string
}

export interface UserVariable {
  id: string
  name: string
  type: VarType
  initialValue: string
}

export interface UserTest {
  id: string
  name: string
  functionId: string
  inputHex: string
  expectedHex: string
}

export interface CharTrigger {
  kind: TriggerKind.CharWrite | TriggerKind.CharRead
  serviceUuid: string
  charUuid: string
}

export interface TimerTrigger {
  kind: TriggerKind.Timer
  intervalMs: number
  repeat: boolean
}

export interface StartupTrigger {
  kind: TriggerKind.Startup
}

export interface ManualTrigger {
  kind: TriggerKind.Manual
}

export type Trigger = CharTrigger | TimerTrigger | StartupTrigger | ManualTrigger

export interface CallFunctionStep {
  kind: StepKind.CallFunction
  functionName: string
}

export interface NotifyStep {
  kind: StepKind.Notify
  serviceUuid: string
  charUuid: string
}

export interface RespondStep {
  kind: StepKind.Respond
}

export type Step = CallFunctionStep | NotifyStep | RespondStep

export interface Scenario {
  id: string
  name: string
  enabled: boolean
  trigger: Trigger
  steps: Step[]
}
