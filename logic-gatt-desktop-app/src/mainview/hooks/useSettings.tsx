import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export interface Settings {
  editorTheme: string
  resetVariablesOnDisconnect: boolean
}

const DEFAULT_SETTINGS: Settings = {
  editorTheme: 'Default Dark',
  resetVariablesOnDisconnect: true,
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

  return <SettingsContext.Provider value={{ settings, setSetting }}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
