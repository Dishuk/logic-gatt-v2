/**
 * File menu — the document actions (New, Open, Save, Save As) plus the bundled
 * examples, grouped into one dropdown so the top bar keeps only the verbs used
 * constantly (Connect, Upload & Run).
 */

import { useEffect, useRef, useState } from 'react'
import type { UseProjectFile } from '../hooks/useProjectFile'
import type { ExampleProject } from './TopBar'

interface FileMenuProps {
  files: UseProjectFile
  /** Save is pointless on an unmodified document that already has a file. */
  saveDisabled: boolean
  examples: ExampleProject[]
}

export function FileMenu({ files, saveDisabled, examples }: FileMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  /** Every item closes the menu before acting. */
  const run = (action: () => void) => () => {
    setOpen(false)
    action()
  }

  return (
    <div className="menu-root" ref={rootRef}>
      <button
        className={`menubar-item${open ? ' menubar-item--open' : ''}`}
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        File
      </button>

      {open && (
        <div className="menu-panel" role="menu">
          <button className="menu-item" role="menuitem" onClick={run(files.requestNew)}>
            New Project
          </button>
          <button className="menu-item" role="menuitem" onClick={run(files.requestOpen)}>
            Open…
          </button>

          <div className="menu-separator" />

          <button className="menu-item" role="menuitem" onClick={run(() => void files.save())} disabled={saveDisabled}>
            Save
            <span className="menu-shortcut">Ctrl+S</span>
          </button>
          <button className="menu-item" role="menuitem" onClick={run(files.saveAs)}>
            Save As…
          </button>

          {examples.length > 0 && (
            <>
              <div className="menu-separator" />
              <div className="menu-label">Examples</div>
              {examples.map(ex => (
                <button
                  key={ex.preset}
                  className="menu-item"
                  role="menuitem"
                  title={ex.description}
                  onClick={run(() => files.requestExample(ex.preset, ex.name))}
                >
                  {ex.name}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
