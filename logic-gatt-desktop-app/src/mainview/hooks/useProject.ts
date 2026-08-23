/**
 * Project state management hook.
 * Handles services, functions, variables, tests, and scenarios, plus the document
 * identity (which file it came from and whether it has unsaved edits).
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import type { Schema, Service, UserFunction, UserTest, Scenario, DeviceSettings, SetVariables } from '../types'
import type { ProjectData } from '../lib/schemaIO'
import { parseProject, serializeProject, DEFAULT_DEVICE_SETTINGS } from '../lib/schemaIO'
import { MAX_SERVICES } from '../lib/constants'
import { rpc } from '../lib/rpc'

export const UNTITLED_NAME = 'Untitled'

function genId() {
  return crypto.randomUUID()
}

function createEmptyService(): Service {
  return { id: genId(), uuid: '', tag: '', characteristics: [] }
}

export function emptyProject(): ProjectData {
  return {
    deviceSettings: { ...DEFAULT_DEVICE_SETTINGS },
    services: [],
    functions: [],
    variables: [],
    tests: [],
    scenarios: [],
  }
}

/** Trailing path segment, for the name shown in the top bar. */
function baseName(path: string): string {
  const segment = path.split(/[\\/]/).pop() ?? path
  return segment || path
}

/**
 * @param onProjectLoad Called whenever the whole project is replaced (preset, open),
 *   so session state can start over instead of carrying values across projects.
 */
export function useProject(log: (msg: string) => void, onProjectLoad?: (data: ProjectData) => void) {
  const [isLoading, setIsLoading] = useState(true)
  const [project, setProject] = useState<ProjectData>(emptyProject)
  const [currentPath, setCurrentPath] = useState<string | null>(null)
  // Serialization as of the last open/save. Compared against the live document to
  // decide dirtiness — parsing normalizes (defaults filled, invalid entries dropped),
  // so the raw file text would never match and every open would look modified.
  const [savedSnapshot, setSavedSnapshot] = useState<string>(() => serializeProject(emptyProject()))

  const onProjectLoadRef = useRef(onProjectLoad)
  onProjectLoadRef.current = onProjectLoad

  // Both are stable so the file-operation callbacks built on them are too — otherwise
  // every keystroke would rebuild them and re-register the Ctrl+S listener.

  /** Replace the whole document and treat it as freshly saved. */
  const loadProject = useCallback((data: ProjectData, path: string | null = null) => {
    setProject(data)
    setCurrentPath(path)
    setSavedSnapshot(serializeProject(data))
    onProjectLoadRef.current?.(data)
  }, [])

  /**
   * Record that `snapshot` — the exact text handed to the write — is now on disk at
   * `path`. Taking the caller's text rather than re-serializing keeps the two in step:
   * an edit made while the write was in flight correctly leaves the document dirty.
   */
  const markSaved = useCallback((path: string, snapshot: string) => {
    setCurrentPath(path)
    setSavedSnapshot(snapshot)
  }, [])

  // Destructure for convenience
  const { deviceSettings, services, functions, variables, tests, scenarios } = project

  const isDirty = useMemo(() => serializeProject(project) !== savedSnapshot, [project, savedSnapshot])
  const projectName = currentPath ? baseName(currentPath) : UNTITLED_NAME

  // Load default preset from the Bun main process on mount. The ref guard makes this
  // run exactly once: React StrictMode double-invokes mount effects in dev, which
  // otherwise fires getPreset twice and logs "Default project loaded" twice.
  const didLoad = useRef(false)
  useEffect(() => {
    if (didLoad.current) return
    didLoad.current = true
    rpc.request
      .getPreset({ name: 'default' })
      .then(json => {
        loadProject(parseProject(JSON.stringify(json)))
        log('Default project loaded')
      })
      .catch(err => {
        console.error('Failed to load default preset:', err)
        log('Failed to load default preset, starting empty')
      })
      .finally(() => setIsLoading(false))
  }, [])

  // Refs for runtime access to latest state
  const scenariosRef = useRef(scenarios)
  scenariosRef.current = scenarios
  const functionsRef = useRef(functions)
  functionsRef.current = functions
  const variablesRef = useRef(variables)
  variablesRef.current = variables
  const projectRef = useRef(project)
  projectRef.current = project

  // Setters that update individual parts of project
  const setDeviceSettings = (ds: DeviceSettings) => setProject(p => ({ ...p, deviceSettings: ds }))
  const setServices = (s: Schema) => setProject(p => ({ ...p, services: s }))
  const setFunctions = (f: UserFunction[]) => setProject(p => ({ ...p, functions: f }))
  const setVariables: SetVariables = v =>
    setProject(p => ({ ...p, variables: typeof v === 'function' ? v(p.variables) : v }))
  const setTests = (t: UserTest[]) => setProject(p => ({ ...p, tests: t }))
  const setScenarios = (s: Scenario[]) => setProject(p => ({ ...p, scenarios: s }))

  // Service management
  function addService() {
    if (services.length >= MAX_SERVICES) return
    setServices([...services, createEmptyService()])
  }

  function updateService(id: string, updated: Service) {
    setServices(services.map(s => (s.id === id ? updated : s)))
  }

  function removeService(id: string) {
    setServices(services.filter(s => s.id !== id))
  }

  return {
    // State
    isLoading,
    deviceSettings,
    services,
    functions,
    variables,
    tests,
    scenarios,

    // Document identity
    currentPath,
    projectName,
    isDirty,

    // Setters
    setDeviceSettings,
    setServices,
    setFunctions,
    setVariables,
    setTests,
    setScenarios,

    // Refs for runtime
    scenariosRef,
    functionsRef,
    variablesRef,
    projectRef,

    // Service helpers
    addService,
    updateService,
    removeService,

    // Whole-project replacement (open, New, examples) and save bookkeeping
    loadProject,
    markSaved,
  }
}

export type UseProject = ReturnType<typeof useProject>
