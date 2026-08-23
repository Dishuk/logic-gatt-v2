import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { rpc } from '../lib/rpc'

import type { ModuleSettingValues } from '../../shared/wire'

export interface Settings {
  editorTheme: string
  /** Live variable values go back to the authored ones on Upload & Run. */
  resetVariablesOnRun: boolean
  /** …and when the device link drops. */
  resetVariablesOnDisconnect: boolean
  /** Values for module-declared settings, keyed by module id. */
  modules: Record<string, ModuleSettingValues>
}

const DEFAULT_SETTINGS: Settings = {
  editorTheme: 'Default Dark',
  resetVariablesOnRun: true,
  resetVariablesOnDisconnect: true,
  modules: {},
}

const STORAGE_KEY = 'logicgatt-settings'

function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      return { ...DEFAULT_SETTINGS, ...parsed }
    }
  } catch {
    /* ignore - localStorage may be unavailable in private mode */
  }
  return DEFAULT_SETTINGS
}

function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* ignore - localStorage may be unavailable in private mode */
  }
}

interface SettingsContextValue {
  settings: Settings
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  /** Update one module-declared setting and push the module's full value set to Bun. */
  setModuleSetting: (moduleId: string, id: string, value: boolean | string | number) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings)

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  function setModuleSetting(moduleId: string, id: string, value: boolean | string | number) {
    setSettings(prev => {
      const values = { ...(prev.modules[moduleId] ?? {}), [id]: value }
      void rpc.request.setModuleSettings({ moduleId, values }).catch(() => {})
      return { ...prev, modules: { ...prev.modules, [moduleId]: values } }
    })
  }

  // Modules start with host defaults, so replay stored values once on mount.
  useEffect(() => {
    for (const [moduleId, values] of Object.entries(settings.modules)) {
      void rpc.request.setModuleSettings({ moduleId, values }).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <SettingsContext.Provider value={{ settings, setSetting, setModuleSetting }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
