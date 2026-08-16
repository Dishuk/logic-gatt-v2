import { useState } from 'react'
import type { UserFunction, UserVariable, UserTest } from '../types'
import { executeFunction } from '../lib/executor'
import { Card, CardHeader, CardBody } from './Card'
import { HexByteInput } from './HexByteInput'
import { ArrowRight, GripVertical } from 'lucide-react'
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

interface TestPanelProps {
  functions: UserFunction[]
  variables: UserVariable[]
  tests: UserTest[]
  onVariablesChange: (vars: UserVariable[]) => void
  onTestsChange: (tests: UserTest[]) => void
  fnLog: (msg: string) => void
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '')
  const bytes = []
  for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16))
  return new Uint8Array(bytes)
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ')
}

function normalizeHex(hex: string): string {
  return hex.replace(/[^0-9a-fA-F]/g, '').toUpperCase()
}

type TestResult = { output: string; pass: boolean }

async function runTest(
  test: UserTest,
  functions: UserFunction[],
  variables: UserVariable[],
  onVariablesChange: (vars: UserVariable[]) => void,
  fnLog: (msg: string) => void
): Promise<TestResult | null> {
  const fn = functions.find(f => f.id === test.functionId)
  if (!fn) return null
  const input = hexToBytes(test.inputHex)
  const ctx = {
    log: fnLog,
    getVar: () => undefined,
    setVar: () => {},
  }
  fnLog(`--- Run ${fn.name}(${bytesToHex(input) || 'empty'}) ---`)
  const result = await executeFunction(fn, input, ctx, variables, onVariablesChange)
  const out = result.output
  const outputHex = out ? bytesToHex(out) || '(empty)' : 'null'
  fnLog(`Result: [${outputHex}]`)

  let pass: boolean
  if (test.expectedHex.trim()) {
    pass = out !== null && normalizeHex(outputHex) === normalizeHex(test.expectedHex)
    fnLog(pass ? 'PASS' : `FAIL (expected ${test.expectedHex})`)
  } else {
    // No expected value = expecting null or empty output
    pass = out === null || out.length === 0
    fnLog(pass ? 'PASS' : `FAIL (expected null/empty, got ${outputHex})`)
  }
  return { output: outputHex, pass }
}

function SortableTestEntry({
  test,
  functions,
  result,
  isRunning,
  onRun,
  onClear,
  onChange,
  onRemove,
}: {
  test: UserTest
  functions: UserFunction[]
  result: TestResult | null
  isRunning: boolean
  onRun: () => void
  onClear: () => void
  onChange: (t: UserTest) => void
  onRemove: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const selectedFn = functions.find(f => f.id === test.functionId)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: test.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0,
    position: 'relative' as const,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <Card>
        <CardHeader
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed(!collapsed)}
          variant="code"
          onRemove={onRemove}
        >
          <span className="card-drag-handle" {...attributes} {...listeners}>
            <GripVertical size={14} />
          </span>
          <span className="fn-keyword">test </span>
          <input
            className="fn-name-input"
            value={test.name}
            onChange={e => onChange({ ...test, name: e.target.value })}
            placeholder="name"
            onClick={e => e.stopPropagation()}
          />
          <span className="fn-signature">
            <ArrowRight size={14} className="fn-arrow" />
            {collapsed ? (
              <span className="hint">{selectedFn?.name || '(no fn)'}</span>
            ) : (
              <select
                className="select"
                value={test.functionId}
                onChange={e => onChange({ ...test, functionId: e.target.value })}
                onClick={e => e.stopPropagation()}
              >
                <option value="">-- fn --</option>
                {functions
                  .filter(f => f.name)
                  .map(f => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
              </select>
            )}
          </span>
        </CardHeader>
        {!collapsed && (
          <CardBody className="test-card-body">
            <div className="test-row">
              <label className="test-label">Input</label>
              <HexByteInput
                value={test.inputHex}
                onChange={v => onChange({ ...test, inputHex: v })}
                placeholder="FF FF FF (optional)"
              />
            </div>
            <div className="test-row">
              <label className="test-label">Expect</label>
              <HexByteInput
                value={test.expectedHex}
                onChange={v => onChange({ ...test, expectedHex: v })}
                placeholder="FF FF FF (optional)"
              />
            </div>
            <div className="test-row">
              <label className="test-label">Output</label>
              <code
                className={`test-output${result?.pass === true ? ' test-output--pass' : result?.pass === false ? ' test-output--fail' : ''}`}
              >
                {result ? result.output : '\u00A0'}
              </code>
              <div className="test-buttons">
                <button onClick={onRun} disabled={!test.functionId || isRunning}>
                  {isRunning ? 'Running...' : 'Run'}
                </button>
                {result && (
                  <button className="btn-clear" onClick={onClear}>
                    Clear
                  </button>
                )}
              </div>
            </div>
          </CardBody>
        )}
      </Card>
    </div>
  )
}

export function TestPanel({ functions, variables, tests, onVariablesChange, onTestsChange, fnLog }: TestPanelProps) {
  const [results, setResults] = useState<Map<string, TestResult>>(new Map())
  const [running, setRunning] = useState<Set<string>>(new Set())
  const [runningAll, setRunningAll] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = tests.findIndex(t => t.id === active.id)
      const newIndex = tests.findIndex(t => t.id === over.id)
      onTestsChange(arrayMove(tests, oldIndex, newIndex))
    }
  }

  function addTest() {
    onTestsChange([...tests, { id: crypto.randomUUID(), name: '', functionId: '', inputHex: '', expectedHex: '' }])
  }

  async function runSingle(test: UserTest) {
    setRunning(prev => new Set(prev).add(test.id))
    try {
      const result = await runTest(test, functions, variables, onVariablesChange, fnLog)
      if (result) {
        setResults(prev => new Map(prev).set(test.id, result))
      }
    } finally {
      setRunning(prev => {
        const next = new Set(prev)
        next.delete(test.id)
        return next
      })
    }
  }

  function clearSingle(testId: string) {
    setResults(prev => {
      const next = new Map(prev)
      next.delete(testId)
      return next
    })
  }

  async function runAll() {
    setRunningAll(true)
    const newResults = new Map<string, TestResult>()
    for (const test of tests) {
      const result = await runTest(test, functions, variables, onVariablesChange, fnLog)
      if (result) {
        newResults.set(test.id, result)
      }
    }
    setResults(newResults)
    setRunningAll(false)
  }

  function clearAll() {
    setResults(new Map())
  }

  const hasResults = results.size > 0
  const runnableTests = tests.filter(t => t.functionId)
  const isAnyRunning = running.size > 0 || runningAll

  // Calculate stats
  const allResults = Array.from(results.values())
  const passed = allResults.filter(r => r.pass).length
  const total = allResults.length

  return (
    <div className="test-panel">
      {tests.length > 0 && (
        <div className="test-row test-actions">
          <span
            className={`test-stats${total === 0 ? '' : passed === total ? ' test-stats--pass' : ' test-stats--fail'}`}
          >
            {total > 0 ? `${passed}/${total} passed` : `${tests.length} test${tests.length !== 1 ? 's' : ''}`}
          </span>
          <div className="test-buttons">
            <button onClick={runAll} disabled={runnableTests.length === 0 || isAnyRunning}>
              {runningAll ? 'Running...' : 'Run All'}
            </button>
            <button className="btn-clear" onClick={clearAll} disabled={!hasResults}>
              Clear All
            </button>
          </div>
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={tests.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tests.map((t, i) => (
            <SortableTestEntry
              key={t.id}
              test={t}
              functions={functions}
              result={results.get(t.id) ?? null}
              isRunning={running.has(t.id) || runningAll}
              onRun={() => runSingle(t)}
              onClear={() => clearSingle(t.id)}
              onChange={updated => onTestsChange(tests.map((x, j) => (j === i ? updated : x)))}
              onRemove={() => onTestsChange(tests.filter((_, j) => j !== i))}
            />
          ))}
        </SortableContext>
      </DndContext>
      <button className="add-btn" onClick={addTest}>
        + Add Test
      </button>
    </div>
  )
}
