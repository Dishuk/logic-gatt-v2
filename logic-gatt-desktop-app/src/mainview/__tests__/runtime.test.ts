/**
 * Integration tests for runtime scenario execution.
 * Tests the pipeline logic, trigger matching, and step execution.
 */

import { describe, it, expect, vi } from 'vitest'
import { TriggerKind, StepKind, type Schema, type Scenario, type UserFunction } from '../types'

// Test helpers that mirror runtime.ts logic
function indicesToUuids(
  schema: Schema,
  svcIdx: number,
  chrIdx: number
): { serviceUuid: string; charUuid: string } | null {
  if (svcIdx >= schema.length) return null
  const svc = schema[svcIdx]
  if (chrIdx >= svc.characteristics.length) return null
  return { serviceUuid: svc.uuid, charUuid: svc.characteristics[chrIdx].uuid }
}

function uuidsToIndices(
  schema: Schema,
  serviceUuid: string,
  charUuid: string
): { svcIdx: number; chrIdx: number } | null {
  for (let s = 0; s < schema.length; s++) {
    if (schema[s].uuid !== serviceUuid) continue
    for (let c = 0; c < schema[s].characteristics.length; c++) {
      if (schema[s].characteristics[c].uuid === charUuid) return { svcIdx: s, chrIdx: c }
    }
  }
  return null
}

// Test schema
const testSchema: Schema = [
  {
    id: 'svc-1',
    uuid: 'service-uuid-1',
    tag: 'Test Service',
    characteristics: [
      {
        id: 'char-1',
        uuid: 'char-uuid-1',
        tag: 'Char 1',
        properties: { read: true, write: true, notify: true },
        defaultValue: '',
      },
      {
        id: 'char-2',
        uuid: 'char-uuid-2',
        tag: 'Char 2',
        properties: { read: true, write: false, notify: false },
        defaultValue: '',
      },
    ],
  },
  {
    id: 'svc-2',
    uuid: 'service-uuid-2',
    tag: 'Second Service',
    characteristics: [
      {
        id: 'char-3',
        uuid: 'char-uuid-3',
        tag: 'Char 3',
        properties: { read: false, write: true, notify: true },
        defaultValue: '',
      },
    ],
  },
]

describe('indicesToUuids', () => {
  it('should map valid indices to UUIDs', () => {
    const result = indicesToUuids(testSchema, 0, 0)
    expect(result).toEqual({
      serviceUuid: 'service-uuid-1',
      charUuid: 'char-uuid-1',
    })
  })

  it('should map second service indices', () => {
    const result = indicesToUuids(testSchema, 1, 0)
    expect(result).toEqual({
      serviceUuid: 'service-uuid-2',
      charUuid: 'char-uuid-3',
    })
  })

  it('should map second characteristic', () => {
    const result = indicesToUuids(testSchema, 0, 1)
    expect(result).toEqual({
      serviceUuid: 'service-uuid-1',
      charUuid: 'char-uuid-2',
    })
  })

  it('should return null for invalid service index', () => {
    const result = indicesToUuids(testSchema, 99, 0)
    expect(result).toBeNull()
  })

  it('should return null for invalid characteristic index', () => {
    const result = indicesToUuids(testSchema, 0, 99)
    expect(result).toBeNull()
  })

  it('should handle empty schema', () => {
    const result = indicesToUuids([], 0, 0)
    expect(result).toBeNull()
  })
})

describe('uuidsToIndices', () => {
  it('should map valid UUIDs to indices', () => {
    const result = uuidsToIndices(testSchema, 'service-uuid-1', 'char-uuid-1')
    expect(result).toEqual({ svcIdx: 0, chrIdx: 0 })
  })

  it('should map second service UUIDs', () => {
    const result = uuidsToIndices(testSchema, 'service-uuid-2', 'char-uuid-3')
    expect(result).toEqual({ svcIdx: 1, chrIdx: 0 })
  })

  it('should map second characteristic', () => {
    const result = uuidsToIndices(testSchema, 'service-uuid-1', 'char-uuid-2')
    expect(result).toEqual({ svcIdx: 0, chrIdx: 1 })
  })

  it('should return null for unknown service UUID', () => {
    const result = uuidsToIndices(testSchema, 'unknown-service', 'char-uuid-1')
    expect(result).toBeNull()
  })

  it('should return null for unknown characteristic UUID', () => {
    const result = uuidsToIndices(testSchema, 'service-uuid-1', 'unknown-char')
    expect(result).toBeNull()
  })

  it('should return null for mismatched service/char UUIDs', () => {
    // char-uuid-3 belongs to service-uuid-2, not service-uuid-1
    const result = uuidsToIndices(testSchema, 'service-uuid-1', 'char-uuid-3')
    expect(result).toBeNull()
  })

  it('should handle empty schema', () => {
    const result = uuidsToIndices([], 'any-uuid', 'any-char')
    expect(result).toBeNull()
  })
})

describe('scenario trigger matching', () => {
  const scenarios: Scenario[] = [
    {
      id: 'scenario-1',
      name: 'Write Handler',
      enabled: true,
      trigger: {
        kind: TriggerKind.CharWrite,
        serviceUuid: 'service-uuid-1',
        charUuid: 'char-uuid-1',
      },
      steps: [{ kind: StepKind.CallFunction, functionName: 'echo' }],
    },
    {
      id: 'scenario-2',
      name: 'Read Handler',
      enabled: true,
      trigger: {
        kind: TriggerKind.CharRead,
        serviceUuid: 'service-uuid-1',
        charUuid: 'char-uuid-2',
      },
      steps: [{ kind: StepKind.Respond }],
    },
    {
      id: 'scenario-3',
      name: 'Disabled Scenario',
      enabled: false,
      trigger: {
        kind: TriggerKind.CharWrite,
        serviceUuid: 'service-uuid-1',
        charUuid: 'char-uuid-1',
      },
      steps: [{ kind: StepKind.CallFunction, functionName: 'disabled' }],
    },
  ]

  function findMatchingScenarios(
    scenarios: Scenario[],
    triggerKind: TriggerKind.CharWrite | TriggerKind.CharRead,
    serviceUuid: string,
    charUuid: string
  ): Scenario[] {
    return scenarios.filter(s => {
      if (!s.enabled) return false
      const t = s.trigger
      return t.kind === triggerKind && t.serviceUuid === serviceUuid && t.charUuid === charUuid
    })
  }

  it('should match write trigger', () => {
    const matches = findMatchingScenarios(scenarios, TriggerKind.CharWrite, 'service-uuid-1', 'char-uuid-1')
    expect(matches).toHaveLength(1)
    expect(matches[0].name).toBe('Write Handler')
  })

  it('should match read trigger', () => {
    const matches = findMatchingScenarios(scenarios, TriggerKind.CharRead, 'service-uuid-1', 'char-uuid-2')
    expect(matches).toHaveLength(1)
    expect(matches[0].name).toBe('Read Handler')
  })

  it('should not match disabled scenarios', () => {
    // Both scenario-1 and scenario-3 have the same trigger, but 3 is disabled
    const matches = findMatchingScenarios(scenarios, TriggerKind.CharWrite, 'service-uuid-1', 'char-uuid-1')
    expect(matches).toHaveLength(1)
    expect(matches.every(s => s.enabled)).toBe(true)
  })

  it('should not match wrong trigger kind', () => {
    const matches = findMatchingScenarios(scenarios, TriggerKind.CharRead, 'service-uuid-1', 'char-uuid-1')
    expect(matches).toHaveLength(0)
  })

  it('should not match wrong UUID', () => {
    const matches = findMatchingScenarios(scenarios, TriggerKind.CharWrite, 'service-uuid-1', 'wrong-uuid')
    expect(matches).toHaveLength(0)
  })

  it('should return empty for no matches', () => {
    const matches = findMatchingScenarios(scenarios, TriggerKind.CharWrite, 'unknown', 'unknown')
    expect(matches).toHaveLength(0)
  })
})

describe('scenario step execution', () => {
  // Simulate step execution logic

  interface StepResult {
    executed: boolean
    data: Uint8Array | null
  }

  async function executeCallFunctionStep(
    functionName: string,
    functions: UserFunction[],
    input: Uint8Array,
    executeSync: (fn: UserFunction, input: Uint8Array) => Uint8Array | null
  ): Promise<StepResult> {
    const fn = functions.find(f => f.name === functionName)
    if (!fn) {
      return { executed: false, data: null }
    }
    const result = executeSync(fn, input)
    return { executed: true, data: result }
  }

  const testFunctions: UserFunction[] = [
    { id: '1', name: 'echo', body: 'return input;' },
    { id: '2', name: 'double', body: 'return new Uint8Array([...input, ...input]);' },
  ]

  it('should execute function step with matching function', async () => {
    const mockExecute = vi.fn().mockReturnValue(new Uint8Array([0xaa, 0xbb]))
    const result = await executeCallFunctionStep('echo', testFunctions, new Uint8Array([0xaa, 0xbb]), mockExecute)

    expect(result.executed).toBe(true)
    expect(mockExecute).toHaveBeenCalled()
    expect(mockExecute.mock.calls[0][0].name).toBe('echo')
  })

  it('should fail for unknown function', async () => {
    const mockExecute = vi.fn()
    const result = await executeCallFunctionStep('nonexistent', testFunctions, new Uint8Array(), mockExecute)

    expect(result.executed).toBe(false)
    expect(result.data).toBeNull()
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('should handle function returning null', async () => {
    const mockExecute = vi.fn().mockReturnValue(null)
    const result = await executeCallFunctionStep('echo', testFunctions, new Uint8Array([0x01]), mockExecute)

    expect(result.executed).toBe(true)
    expect(result.data).toBeNull()
  })
})

describe('pipeline execution flow', () => {
  // Test the full pipeline flow with multiple steps

  interface PipelineContext {
    buffer: Uint8Array | null
    logs: string[]
    notifications: Array<{ svcIdx: number; chrIdx: number; data: Uint8Array }>
    response: Uint8Array | null
  }

  function executePipeline(
    steps: Array<{ kind: StepKind; functionName?: string; serviceUuid?: string; charUuid?: string }>,
    schema: Schema,
    functions: UserFunction[],
    initialInput: Uint8Array,
    executeFunction: (fn: UserFunction, input: Uint8Array) => Uint8Array | null,
    triggerKind: TriggerKind.CharWrite | TriggerKind.CharRead = TriggerKind.CharWrite,
    _triggerServiceUuid = '',
    _triggerCharUuid = ''
  ): PipelineContext {
    const ctx: PipelineContext = {
      buffer: initialInput,
      logs: [],
      notifications: [],
      response: null,
    }

    for (const step of steps) {
      switch (step.kind) {
        case StepKind.CallFunction: {
          const fn = functions.find(f => f.name === step.functionName)
          if (!fn) {
            ctx.logs.push(`function "${step.functionName}" not found`)
            ctx.buffer = null
            break
          }
          ctx.buffer = executeFunction(fn, ctx.buffer ?? new Uint8Array())
          if (!ctx.buffer) {
            ctx.logs.push(`function "${step.functionName}" returned null`)
          }
          break
        }
        case StepKind.Notify: {
          if (!ctx.buffer) {
            ctx.logs.push('notify: no data')
            break
          }
          const idx = uuidsToIndices(schema, step.serviceUuid!, step.charUuid!)
          if (!idx) {
            ctx.logs.push('notify: char not found')
            break
          }
          ctx.notifications.push({
            svcIdx: idx.svcIdx,
            chrIdx: idx.chrIdx,
            data: ctx.buffer,
          })
          break
        }
        case StepKind.Respond: {
          if (triggerKind !== TriggerKind.CharRead) {
            ctx.logs.push('respond: only valid for char-read')
            break
          }
          if (!ctx.buffer) {
            ctx.logs.push('respond: no data')
            break
          }
          ctx.response = ctx.buffer
          break
        }
      }

      // Stop pipeline if buffer is null after call-function
      if (!ctx.buffer && step.kind === StepKind.CallFunction) break
    }

    return ctx
  }

  const testFunctions: UserFunction[] = [
    { id: '1', name: 'echo', body: 'return input;' },
    { id: '2', name: 'addPrefix', body: 'return new Uint8Array([0xFF, ...input]);' },
  ]

  it('should execute single call-function step', () => {
    const mockExecute = vi.fn().mockReturnValue(new Uint8Array([0xaa]))
    const ctx = executePipeline(
      [{ kind: StepKind.CallFunction, functionName: 'echo' }],
      testSchema,
      testFunctions,
      new Uint8Array([0xaa]),
      mockExecute
    )

    expect(ctx.buffer).toEqual(new Uint8Array([0xaa]))
    expect(mockExecute).toHaveBeenCalledTimes(1)
  })

  it('should chain multiple function calls', () => {
    const mockExecute = vi
      .fn()
      .mockReturnValueOnce(new Uint8Array([0xaa]))
      .mockReturnValueOnce(new Uint8Array([0xff, 0xaa]))

    const ctx = executePipeline(
      [
        { kind: StepKind.CallFunction, functionName: 'echo' },
        { kind: StepKind.CallFunction, functionName: 'addPrefix' },
      ],
      testSchema,
      testFunctions,
      new Uint8Array([0xaa]),
      mockExecute
    )

    expect(ctx.buffer).toEqual(new Uint8Array([0xff, 0xaa]))
    expect(mockExecute).toHaveBeenCalledTimes(2)
  })

  it('should execute notify step', () => {
    const mockExecute = vi.fn().mockReturnValue(new Uint8Array([0xbb, 0xcc]))

    const ctx = executePipeline(
      [
        { kind: StepKind.CallFunction, functionName: 'echo' },
        { kind: StepKind.Notify, serviceUuid: 'service-uuid-1', charUuid: 'char-uuid-1' },
      ],
      testSchema,
      testFunctions,
      new Uint8Array([0xbb, 0xcc]),
      mockExecute
    )

    expect(ctx.notifications).toHaveLength(1)
    expect(ctx.notifications[0]).toEqual({
      svcIdx: 0,
      chrIdx: 0,
      data: new Uint8Array([0xbb, 0xcc]),
    })
  })

  it('should execute respond step for char-read', () => {
    const mockExecute = vi.fn().mockReturnValue(new Uint8Array([0xdd]))

    const ctx = executePipeline(
      [{ kind: StepKind.CallFunction, functionName: 'echo' }, { kind: StepKind.Respond }],
      testSchema,
      testFunctions,
      new Uint8Array([0xdd]),
      mockExecute,
      TriggerKind.CharRead
    )

    expect(ctx.response).toEqual(new Uint8Array([0xdd]))
  })

  it('should ignore respond step for char-write', () => {
    const mockExecute = vi.fn().mockReturnValue(new Uint8Array([0xdd]))

    const ctx = executePipeline(
      [{ kind: StepKind.CallFunction, functionName: 'echo' }, { kind: StepKind.Respond }],
      testSchema,
      testFunctions,
      new Uint8Array([0xdd]),
      mockExecute,
      TriggerKind.CharWrite
    )

    expect(ctx.response).toBeNull()
    expect(ctx.logs).toContain('respond: only valid for char-read')
  })

  it('should stop pipeline when function returns null', () => {
    const mockExecute = vi.fn().mockReturnValue(null)

    const ctx = executePipeline(
      [
        { kind: StepKind.CallFunction, functionName: 'echo' },
        { kind: StepKind.CallFunction, functionName: 'addPrefix' },
        { kind: StepKind.Notify, serviceUuid: 'service-uuid-1', charUuid: 'char-uuid-1' },
      ],
      testSchema,
      testFunctions,
      new Uint8Array([0xaa]),
      mockExecute
    )

    // Should stop after first function returns null
    expect(mockExecute).toHaveBeenCalledTimes(1)
    expect(ctx.buffer).toBeNull()
    expect(ctx.notifications).toHaveLength(0)
  })

  it('should log error for unknown function', () => {
    const mockExecute = vi.fn()

    const ctx = executePipeline(
      [{ kind: StepKind.CallFunction, functionName: 'nonexistent' }],
      testSchema,
      testFunctions,
      new Uint8Array([0xaa]),
      mockExecute
    )

    expect(ctx.logs).toContain('function "nonexistent" not found')
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('should not reach notify when call-function returns null (pipeline stops)', () => {
    const mockExecute = vi.fn().mockReturnValue(null)

    const ctx = executePipeline(
      [
        { kind: StepKind.CallFunction, functionName: 'echo' },
        { kind: StepKind.Notify, serviceUuid: 'service-uuid-1', charUuid: 'char-uuid-1' },
      ],
      testSchema,
      testFunctions,
      new Uint8Array([0xaa]),
      mockExecute
    )

    // Pipeline stops after call-function returns null, notify is never reached
    expect(ctx.logs).toContain('function "echo" returned null')
    expect(ctx.notifications).toHaveLength(0)
    expect(ctx.buffer).toBeNull()
  })

  it('should log error for notify with invalid char', () => {
    const mockExecute = vi.fn().mockReturnValue(new Uint8Array([0xaa]))

    const ctx = executePipeline(
      [
        { kind: StepKind.CallFunction, functionName: 'echo' },
        { kind: StepKind.Notify, serviceUuid: 'unknown-svc', charUuid: 'unknown-char' },
      ],
      testSchema,
      testFunctions,
      new Uint8Array([0xaa]),
      mockExecute
    )

    expect(ctx.logs).toContain('notify: char not found')
    expect(ctx.notifications).toHaveLength(0)
  })
})
