/**
 * Settings dialog. Reached from the menu bar rather than a Code Editor tab — these
 * are app-wide preferences, not part of authoring a project, and are rarely opened.
 */

import { useEffect, useMemo } from 'react'
import type { Extension } from '@codemirror/state'
import { useSettings } from '../hooks/useSettings'
import { themes, themeNames } from '../themes'
import { Card, CardHeader, CardBody } from './Card'
import { CodeBlock } from './CodeBlock'
import { ModuleSettings } from './ModuleSettings'
import { SettingsSection } from './SettingsSection'

const PREVIEW_CODE = `// Theme preview
  const counter = ctx.getVar("count");
  ctx.setVar("count", counter + 1);

  if (input.length > 0) {
    console.log("Received:", input);
  }

  return new Uint8Array([0xAC, 0x4B]);
`

function ThemePreview({ theme }: { theme: Extension }) {
  return <CodeBlock code={PREVIEW_CODE} theme={theme} className="theme-preview" />
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { settings, setSetting } = useSettings()
  const themeExtension = useMemo(() => themes[settings.editorTheme] ?? themes['Default Dark'], [settings.editorTheme])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="settings-content">
          <SettingsSection title="General" subtitle="Applies to the whole app.">
            <Card>
              <CardHeader title="Editor Theme" noBorder />
              <CardBody>
                <select
                  className="select w-full"
                  value={settings.editorTheme}
                  onChange={e => setSetting('editorTheme', e.target.value)}
                >
                  {themeNames.map(name => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <ThemePreview theme={themeExtension} />
              </CardBody>
            </Card>
          </SettingsSection>
          <ModuleSettings />
        </div>
      </div>
    </div>
  )
}
