/**
 * Project state management hook.
 * Handles services, functions, variables, tests, and scenarios.
 */

import { useState, useRef, useEffect } from 'react'
import type { Schema, Service, UserFunction, UserVariable, UserTest, Scenario, DeviceSettings } from '../types'
import type { ProjectData } from '../lib/schemaIO'
import { importProject, downloadProject, pickAndImportProject, DEFAULT_DEVICE_SETTINGS } from '../lib/schemaIO'
import { MAX_SERVICES } from '../lib/constants'
import { rpc } from '../lib/rpc'

function genId() {
  return crypto.randomUUID()
}

function createEmptyService(): Service {
  return { id: genId(), uuid: '', tag: '', characteristics: [] }
}

function emptyProject(): ProjectData {
  return {
    deviceSettings: { ...DEFAULT_DEVICE_SETTINGS },
    services: [],
    functions: [],
    variables: [],
    tests: [],
    scenarios: [],
  }
}

export function useProject(log: (msg: string) => void) {
  const [isLoading, setIsLoading] = useState(true)
  const [project, setProject] = useState<ProjectData>(emptyProject)

  // Destructure for convenience
  const { deviceSettings, services, functions, variables, tests, scenarios } = project

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
        setProject(importProject(JSON.stringify(json)))
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

  // Setters that update individual parts of project
  const setDeviceSettings = (ds: DeviceSettings) => setProject(p => ({ ...p, deviceSettings: ds }))
  const setServices = (s: Schema) => setProject(p => ({ ...p, services: s }))
  const setFunctions = (f: UserFunction[]) => setProject(p => ({ ...p, functions: f }))
  const setVariables = (v: UserVariable[]) => setProject(p => ({ ...p, variables: v }))
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

  // Import/Export
  async function handleImport() {
    try {
      const imported = await pickAndImportProject()
      setProject(imported)
      log(
        `Imported: ${imported.services.length} service(s), ${imported.functions.length} function(s), ${imported.variables.length} variable(s), ${imported.tests.length} test(s), ${imported.scenarios.length} scenario(s)`
      )
    } catch (err) {
      if ((err as Error).message !== 'No file selected') {
        log(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  function handleExport() {
    downloadProject(project)
    log('Project exported')
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

    // Service helpers
    addService,
    updateService,
    removeService,

    // Import/Export
    handleImport,
    handleExport,
  }
}
