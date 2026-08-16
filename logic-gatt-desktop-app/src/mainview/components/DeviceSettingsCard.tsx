import { useState } from 'react'
import type { DeviceSettings } from '../types'
import { Card, CardHeader, CardBody } from './Card'
import { HexByteInput } from './HexByteInput'

// Common BLE appearance codes
const APPEARANCE_OPTIONS = [
  { value: 0x0000, label: 'None' },
  { value: 0x0040, label: 'Generic Phone' },
  { value: 0x0080, label: 'Generic Computer' },
  { value: 0x00c0, label: 'Generic Watch' },
  { value: 0x0100, label: 'Generic Clock' },
  { value: 0x0180, label: 'Generic Display' },
  { value: 0x0200, label: 'Generic Remote Control' },
  { value: 0x0340, label: 'Generic Sensor' },
  { value: 0x03c0, label: 'Generic Heart Rate' },
  { value: 0x0480, label: 'Generic Thermometer' },
]

interface DeviceSettingsCardProps {
  settings: DeviceSettings
  onChange: (settings: DeviceSettings) => void
}

export function DeviceSettingsCard({ settings, onChange }: DeviceSettingsCardProps) {
  const [collapsed, setCollapsed] = useState(false)

  const nameBytes = new TextEncoder().encode(settings.deviceName).length
  const nameError = nameBytes > 29

  return (
    <Card className="device-settings-card">
      <CardHeader title="Device Settings" collapsed={collapsed} onToggleCollapse={() => setCollapsed(!collapsed)} />
      {!collapsed && (
        <CardBody>
          <div className="device-field-row">
            <div className="device-field">
              <label className="device-field-label">Name</label>
              <input
                type="text"
                className={`device-name-input ${nameError ? 'input--error' : ''}`}
                value={settings.deviceName}
                onChange={e => onChange({ ...settings, deviceName: e.target.value })}
                placeholder="Device name"
                maxLength={29}
              />
              <span className="device-field-hint">{nameBytes}/29</span>
            </div>
            <div className="device-field device-field--appearance">
              <label className="device-field-label">Appearance</label>
              <select
                className="select"
                value={settings.appearance}
                onChange={e => onChange({ ...settings, appearance: parseInt(e.target.value, 10) })}
              >
                {APPEARANCE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
                {!APPEARANCE_OPTIONS.some(o => o.value === settings.appearance) && (
                  <option value={settings.appearance}>
                    Custom (0x{settings.appearance.toString(16).padStart(4, '0')})
                  </option>
                )}
              </select>
            </div>
          </div>
          <div className="device-field">
            <label className="device-field-label">Mfr Data</label>
            <HexByteInput
              value={settings.manufacturerData}
              onChange={v => onChange({ ...settings, manufacturerData: v })}
              placeholder="FF FF FF (optional)"
            />
          </div>
        </CardBody>
      )}
    </Card>
  )
}
