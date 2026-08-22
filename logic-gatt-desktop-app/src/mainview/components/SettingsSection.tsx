import type { ReactNode } from 'react'

interface SettingsSectionProps {
  /** Who these settings belong to — "General", or a module's name. */
  title: string
  subtitle?: string
  children: ReactNode
}

/** A named group in the Settings tab, so every setting shows what it applies to. */
export function SettingsSection({ title, subtitle, children }: SettingsSectionProps) {
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">{title}</h3>
      {subtitle && <p className="settings-section-subtitle">{subtitle}</p>}
      <div className="settings-section-body">{children}</div>
    </section>
  )
}
