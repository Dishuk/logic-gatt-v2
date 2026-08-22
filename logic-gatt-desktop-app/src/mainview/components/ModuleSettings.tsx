import { useEffect, useState } from 'react'
import type { ModuleSettingDef, PluginInfo } from '../../shared/wire'
import { rpc } from '../lib/rpc'
import { useSettings } from '../hooks/useSettings'
import { Card, CardHeader, CardBody } from './Card'

/** Settings sections contributed by transport modules, one Card per module. */
export function ModuleSettings() {
  const { settings, setModuleSetting } = useSettings()
  const [modules, setModules] = useState<PluginInfo[]>([])

  useEffect(() => {
    rpc.request
      .listModules()
      .then(list => setModules(list.filter(m => m.settings && m.settings.length > 0)))
      .catch(() => setModules([]))
  }, [])

  const platform = navigator.userAgent.includes('Windows')
    ? 'win32'
    : navigator.userAgent.includes('Linux')
      ? 'linux'
      : 'darwin'

  const applicable = (def: ModuleSettingDef) => !def.platforms || def.platforms.includes(platform)

  return (
    <>
      {modules.map(mod => {
        const defs = (mod.settings ?? []).filter(applicable)
        if (defs.length === 0) return null
        const values = settings.modules[mod.id] ?? {}
        return (
          <Card key={mod.id}>
            <CardHeader title={mod.name} noBorder />
            <CardBody>
              {defs.map(def => {
                const value = values[def.id] ?? def.default
                return (
                  <div key={def.id} className="module-setting">
                    {def.type === 'boolean' ? (
                      <label className="settings-checkbox">
                        <input
                          type="checkbox"
                          checked={value === true}
                          onChange={e => setModuleSetting(mod.id, def.id, e.target.checked)}
                        />
                        {def.label}
                      </label>
                    ) : (
                      <label className="module-setting-field">
                        <span>{def.label}</span>
                        <input
                          className="input"
                          type={def.type === 'number' ? 'number' : 'text'}
                          value={String(value)}
                          onChange={e =>
                            setModuleSetting(
                              mod.id,
                              def.id,
                              def.type === 'number' ? Number(e.target.value) : e.target.value
                            )
                          }
                        />
                      </label>
                    )}
                    {def.description && <p className="settings-hint">{def.description}</p>}
                  </div>
                )
              })}
            </CardBody>
          </Card>
        )
      })}
    </>
  )
}
