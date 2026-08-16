import { useState, useMemo } from 'react'
import {
  TriggerKind,
  StepKind,
  type Scenario,
  type Trigger,
  type Step,
  type Schema,
  type UserFunction,
  type Characteristic,
} from '../types'
import { Card, CardHeader, CardBody } from './Card'
import { X, GripVertical, Play } from 'lucide-react'
import type { DragEndEvent } from '@dnd-kit/core'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface ScenariosPanelProps {
  scenarios: Scenario[]
  onScenariosChange: (scenarios: Scenario[]) => void
  onRunScenario?: (scenario: Scenario) => void
  isRunning?: boolean
  services: Schema
  functions: UserFunction[]
}

// --- Validation ---

interface ScenarioErrors {
  name?: string
  trigger?: string
  steps: (string | undefined)[]
  general?: string
}

function findChar(services: Schema, serviceUuid: string, charUuid: string): Characteristic | undefined {
  return services.find(s => s.uuid === serviceUuid)?.characteristics.find(c => c.uuid === charUuid)
}

function validateScenario(scenario: Scenario, services: Schema, functions: UserFunction[]): ScenarioErrors {
  const errors: ScenarioErrors = { steps: [] }
  const fnNames = new Set(functions.map(f => f.name).filter(Boolean))

  if (!scenario.name.trim()) {
    errors.name = 'Scenario name is required'
  }

  const t = scenario.trigger
  if (t.kind === TriggerKind.CharWrite || t.kind === TriggerKind.CharRead) {
    if (!t.serviceUuid) {
      errors.trigger = 'Select a service'
    } else if (!t.charUuid) {
      errors.trigger = 'Select a characteristic'
    } else {
      const ch = findChar(services, t.serviceUuid, t.charUuid)
      if (!ch) {
        errors.trigger = 'Characteristic not found in schema'
      } else if (t.kind === TriggerKind.CharWrite && !ch.properties.write) {
        errors.trigger = `Characteristic "${ch.tag || ch.uuid}" does not have the Write property enabled`
      } else if (t.kind === TriggerKind.CharRead && !ch.properties.read) {
        errors.trigger = `Characteristic "${ch.tag || ch.uuid}" does not have the Read property enabled`
      }
    }
  } else if (t.kind === TriggerKind.Timer) {
    if (!t.intervalMs || t.intervalMs <= 0) {
      errors.trigger = 'Interval must be greater than 0'
    }
  }

  if (scenario.steps.length === 0) {
    errors.general = 'Add at least one step'
  }

  for (const step of scenario.steps) {
    let err: string | undefined
    if (step.kind === StepKind.CallFunction) {
      if (!step.functionName) {
        err = 'Select a function'
      } else if (!fnNames.has(step.functionName)) {
        err = `Function "${step.functionName}" does not exist`
      }
    } else if (step.kind === StepKind.Notify) {
      if (!step.serviceUuid) {
        err = 'Select a service'
      } else if (!step.charUuid) {
        err = 'Select a characteristic'
      } else {
        const ch = findChar(services, step.serviceUuid, step.charUuid)
        if (!ch) {
          err = 'Characteristic not found in schema'
        } else if (!ch.properties.notify) {
          err = `Characteristic "${ch.tag || ch.uuid}" does not have the Notify property enabled`
        }
      }
    } else if (step.kind === StepKind.Respond) {
      if (scenario.trigger.kind !== TriggerKind.CharRead && scenario.trigger.kind !== TriggerKind.CharWrite) {
        err = 'Respond step requires a characteristic trigger (Char Read or Char Write)'
      }
    }
    errors.steps.push(err)
  }

  return errors
}

function hasErrors(e: ScenarioErrors): boolean {
  return !!(e.name || e.trigger || e.general || e.steps.some(Boolean))
}

const TRIGGER_HINTS: Record<TriggerKind, string> = {
  [TriggerKind.CharWrite]: 'Runs when a BLE client writes to the characteristic',
  [TriggerKind.CharRead]: 'Runs when a BLE client reads the characteristic',
  [TriggerKind.Timer]: 'Runs on a time interval',
  [TriggerKind.Startup]: 'Runs once on device boot',
  [TriggerKind.Manual]: 'Runs only via Run button or ctx.runScenario()',
}

// --- Components ---

function triggerSummary(t: Trigger): string {
  switch (t.kind) {
    case TriggerKind.CharWrite:
      return `Write ${t.charUuid ? t.charUuid.slice(0, 8) + '...' : '??'}`
    case TriggerKind.CharRead:
      return `Read ${t.charUuid ? t.charUuid.slice(0, 8) + '...' : '??'}`
    case TriggerKind.Timer:
      return `Timer ${t.intervalMs}ms${t.repeat ? ' (repeat)' : ''}`
    case TriggerKind.Startup:
      return 'Startup'
    case TriggerKind.Manual:
      return 'Manual'
  }
}

function defaultTrigger(): Trigger {
  return { kind: TriggerKind.Startup }
}

function defaultStep(): Step {
  return { kind: StepKind.Respond }
}

function ErrorMsg({ msg }: { msg?: string }) {
  if (!msg) return null
  return <div className="scenario-error">{msg}</div>
}

function TriggerEditor({
  trigger,
  onChange,
  error,
  services,
}: {
  trigger: Trigger
  onChange: (t: Trigger) => void
  error?: string
  services: Schema
}) {
  return (
    <div className="scenario-section">
      <div className="scenario-section-title">
        Trigger
        <select
          className="select"
          value={trigger.kind}
          onChange={e => {
            const kind = e.target.value as TriggerKind
            if (kind === TriggerKind.Startup) onChange({ kind: TriggerKind.Startup })
            else if (kind === TriggerKind.Manual) onChange({ kind: TriggerKind.Manual })
            else if (kind === TriggerKind.Timer) onChange({ kind: TriggerKind.Timer, intervalMs: 1000, repeat: false })
            else onChange({ kind, serviceUuid: '', charUuid: '' })
          }}
        >
          <option value={TriggerKind.CharWrite}>Char Write</option>
          <option value={TriggerKind.CharRead}>Char Read</option>
          <option value={TriggerKind.Timer}>Timer</option>
          <option value={TriggerKind.Startup}>Startup</option>
          <option value={TriggerKind.Manual}>Manual</option>
        </select>
        <span className="info-icon" title={TRIGGER_HINTS[trigger.kind]}>
          ?
        </span>
      </div>
      {(trigger.kind === TriggerKind.CharWrite || trigger.kind === TriggerKind.CharRead) && (
        <div className="scenario-field-row">
          <label className="scenario-field-label">Service</label>
          <select
            className={`select${error ? ' select--error' : ''}`}
            value={trigger.serviceUuid}
            onChange={e => {
              onChange({ ...trigger, serviceUuid: e.target.value, charUuid: '' })
            }}
          >
            <option value="">-- Select --</option>
            {services.map(s => (
              <option key={s.id} value={s.uuid} title={s.tag ? `${s.tag} (${s.uuid})` : s.uuid}>
                {s.tag || s.uuid || '(unnamed)'}
              </option>
            ))}
          </select>
          <label className="scenario-field-label">Char</label>
          <select
            className={`select${error ? ' select--error' : ''}`}
            value={trigger.charUuid}
            onChange={e => onChange({ ...trigger, charUuid: e.target.value })}
          >
            <option value="">-- Select --</option>
            {services
              .find(s => s.uuid === trigger.serviceUuid)
              ?.characteristics.map(c => (
                <option key={c.id} value={c.uuid} title={c.tag ? `${c.tag} (${c.uuid})` : c.uuid}>
                  {c.tag || c.uuid || '(unnamed)'}
                </option>
              ))}
          </select>
        </div>
      )}
      {trigger.kind === TriggerKind.Timer && (
        <div className="scenario-field-row">
          <input
            type="number"
            className={`var-value-input input--narrow${error ? ' input--error' : ''}`}
            value={trigger.intervalMs}
            onChange={e => onChange({ ...trigger, intervalMs: Number(e.target.value) })}
            min={1}
          />
          <span className="hint">ms</span>
          <label className="inline-label">
            <input
              type="checkbox"
              checked={trigger.repeat}
              onChange={e => onChange({ ...trigger, repeat: e.target.checked })}
            />
            Repeat
          </label>
        </div>
      )}
      <ErrorMsg msg={error} />
    </div>
  )
}

function SortableStepRow({
  step,
  stepId,
  index,
  onChange,
  onRemove,
  error,
  services,
  functions,
}: {
  step: Step
  stepId: string
  index: number
  onChange: (s: Step) => void
  onRemove: () => void
  error?: string
  services: Schema
  functions: UserFunction[]
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stepId })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0,
    position: 'relative' as const,
  }

  return (
    <div ref={setNodeRef} style={style} className={`step-row${error ? ' step-row--error' : ''}`}>
      <div className="step-row-main">
        <span className="step-drag-handle" {...attributes} {...listeners}>
          <GripVertical size={14} />
        </span>
        <span className="step-number">{index + 1}</span>
        <select
          className="select"
          value={step.kind}
          onChange={e => {
            const kind = e.target.value as StepKind
            if (kind === StepKind.Respond) onChange({ kind: StepKind.Respond })
            else if (kind === StepKind.CallFunction) onChange({ kind: StepKind.CallFunction, functionName: '' })
            else onChange({ kind: StepKind.Notify, serviceUuid: '', charUuid: '' })
          }}
        >
          <option value={StepKind.CallFunction}>Call Function</option>
          <option value={StepKind.Notify}>Notify</option>
          <option value={StepKind.Respond}>Respond</option>
        </select>
        {step.kind === StepKind.CallFunction && (
          <>
            <label className="scenario-field-label">Function</label>
            <select
              className={`select${error ? ' select--error' : ''}`}
              value={step.functionName}
              onChange={e => onChange({ ...step, functionName: e.target.value })}
            >
              <option value="">-- Select --</option>
              {functions.map(f => (
                <option key={f.id} value={f.name}>
                  {f.name || '(unnamed)'}
                </option>
              ))}
            </select>
          </>
        )}
        {step.kind === StepKind.Notify && (
          <>
            <label className="scenario-field-label">Service</label>
            <select
              className={`select select--uuid${error ? ' select--error' : ''}`}
              value={step.serviceUuid}
              onChange={e => onChange({ ...step, serviceUuid: e.target.value, charUuid: '' })}
            >
              <option value="">-- Select --</option>
              {services.map(s => (
                <option key={s.id} value={s.uuid} title={s.tag ? `${s.tag} (${s.uuid})` : s.uuid}>
                  {s.tag || s.uuid || '(unnamed)'}
                </option>
              ))}
            </select>
            <label className="scenario-field-label">Char</label>
            <select
              className={`select select--uuid${error ? ' select--error' : ''}`}
              value={step.charUuid}
              onChange={e => onChange({ ...step, charUuid: e.target.value })}
            >
              <option value="">-- Select --</option>
              {services
                .find(s => s.uuid === step.serviceUuid)
                ?.characteristics.filter(c => c.properties.notify)
                .map(c => (
                  <option key={c.id} value={c.uuid} title={c.tag ? `${c.tag} (${c.uuid})` : c.uuid}>
                    {c.tag || c.uuid || '(unnamed)'}
                  </option>
                ))}
            </select>
          </>
        )}
        <button className="remove-btn ml-auto" onClick={onRemove}>
          <X size={14} />
        </button>
      </div>
      {error && <div className="scenario-error">{error}</div>}
    </div>
  )
}

interface ScenarioCardProps {
  scenario: Scenario
  errors: ScenarioErrors
  onChange: (s: Scenario) => void
  onRemove: () => void
  onRun?: () => void
  canRun?: boolean
  services: Schema
  functions: UserFunction[]
}

function SortableScenarioCard({
  scenario,
  errors,
  onChange,
  onRemove,
  onRun,
  canRun,
  services,
  functions,
}: ScenarioCardProps) {
  const [collapsed, setCollapsed] = useState(true)
  const errored = hasErrors(errors)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: scenario.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0,
    position: 'relative' as const,
  }

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Generate stable IDs for steps based on scenario id and index
  const stepIds = scenario.steps.map((_, i) => `${scenario.id}-step-${i}`)

  function updateStep(i: number, step: Step) {
    onChange({ ...scenario, steps: scenario.steps.map((s, j) => (j === i ? step : s)) })
  }

  function removeStep(i: number) {
    onChange({ ...scenario, steps: scenario.steps.filter((_, j) => j !== i) })
  }

  function addStep() {
    onChange({ ...scenario, steps: [...scenario.steps, defaultStep()] })
  }

  function handleStepDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = stepIds.indexOf(active.id as string)
      const newIndex = stepIds.indexOf(over.id as string)
      onChange({ ...scenario, steps: arrayMove(scenario.steps, oldIndex, newIndex) })
    }
  }

  return (
    <div ref={setNodeRef} style={style}>
      <Card className={errored ? 'card--error' : ''}>
        <CardHeader collapsed={collapsed} onToggleCollapse={() => setCollapsed(!collapsed)} variant="code">
          <span className="card-drag-handle" {...attributes} {...listeners}>
            <GripVertical size={14} />
          </span>
          <span className="fn-keyword">scenario </span>
          <input
            className={`fn-name-input${errors.name ? ' input--error' : ''}`}
            value={scenario.name}
            onChange={e => onChange({ ...scenario, name: e.target.value })}
            placeholder="name"
            onClick={e => e.stopPropagation()}
          />
          <span className="scenario-card-info">{triggerSummary(scenario.trigger)}</span>
          {errored && (
            <span className="scenario-card-error-badge" title={collectErrorSummary(errors)}>
              !
            </span>
          )}
          {scenario.trigger.kind !== TriggerKind.Manual && (
            <label className="scenario-toggle ml-auto" onClick={e => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={scenario.enabled}
                onChange={e => onChange({ ...scenario, enabled: e.target.checked })}
              />
              <span className="scenario-toggle-slider" />
            </label>
          )}
          {scenario.trigger.kind === TriggerKind.Manual && <span className="ml-auto" />}
          <button
            className="run-btn"
            onClick={e => {
              e.stopPropagation()
              onRun?.()
            }}
            disabled={!canRun}
            title={canRun ? 'Run scenario' : 'Connect device to run'}
          >
            <Play size={14} />
          </button>
          <button className="remove-btn" onClick={onRemove}>
            <X size={14} />
          </button>
        </CardHeader>
        {!collapsed && (
          <CardBody>
            <TriggerEditor
              trigger={scenario.trigger}
              onChange={trigger => onChange({ ...scenario, trigger })}
              error={errors.trigger}
              services={services}
            />
            <div className="scenario-section">
              <div className="scenario-section-title">Steps</div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleStepDragEnd}>
                <SortableContext items={stepIds} strategy={verticalListSortingStrategy}>
                  {scenario.steps.map((step, i) => (
                    <SortableStepRow
                      key={stepIds[i]}
                      step={step}
                      stepId={stepIds[i]}
                      index={i}
                      onChange={s => updateStep(i, s)}
                      onRemove={() => removeStep(i)}
                      error={errors.steps[i]}
                      services={services}
                      functions={functions}
                    />
                  ))}
                </SortableContext>
              </DndContext>
              <button className="add-btn" onClick={addStep}>
                + Add Step
              </button>
              <ErrorMsg msg={errors.general} />
            </div>
          </CardBody>
        )}
      </Card>
    </div>
  )
}

export function ScenariosPanel({
  scenarios,
  onScenariosChange,
  onRunScenario,
  isRunning,
  services,
  functions,
}: ScenariosPanelProps) {
  const allErrors = useMemo(() => {
    const map = new Map<string, ScenarioErrors>()
    for (const s of scenarios) {
      map.set(s.id, validateScenario(s, services, functions))
    }
    return map
  }, [scenarios, services, functions])

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = scenarios.findIndex(s => s.id === active.id)
      const newIndex = scenarios.findIndex(s => s.id === over.id)
      onScenariosChange(arrayMove(scenarios, oldIndex, newIndex))
    }
  }

  function addScenario() {
    const s: Scenario = {
      id: crypto.randomUUID(),
      name: '',
      enabled: true,
      trigger: defaultTrigger(),
      steps: [],
    }
    onScenariosChange([...scenarios, s])
  }

  function updateScenario(updated: Scenario) {
    onScenariosChange(scenarios.map(s => (s.id === updated.id ? updated : s)))
  }

  function removeScenario(id: string) {
    onScenariosChange(scenarios.filter(s => s.id !== id))
  }

  return (
    <div className="scenario-list">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={scenarios.map(s => s.id)} strategy={verticalListSortingStrategy}>
          {scenarios.map(s => (
            <SortableScenarioCard
              key={s.id}
              scenario={s}
              errors={allErrors.get(s.id) ?? { steps: [] }}
              onChange={updateScenario}
              onRemove={() => removeScenario(s.id)}
              onRun={() => onRunScenario?.(s)}
              canRun={isRunning}
              services={services}
              functions={functions}
            />
          ))}
        </SortableContext>
      </DndContext>
      <button className="add-btn" onClick={addScenario}>
        + Add Scenario
      </button>
    </div>
  )
}

function collectErrorSummary(e: ScenarioErrors): string {
  const msgs: string[] = []
  if (e.name) msgs.push(e.name)
  if (e.trigger) msgs.push(e.trigger)
  if (e.general) msgs.push(e.general)
  for (let i = 0; i < e.steps.length; i++) {
    if (e.steps[i]) msgs.push(`Step ${i + 1}: ${e.steps[i]}`)
  }
  return msgs.join('\n')
}
