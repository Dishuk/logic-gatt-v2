/**
 * Save As. Electrobun 1.18.1 has no save dialog, so the path is assembled from the
 * native directory picker plus a name typed here; Bun resolves and validates the two
 * (`resolveProjectPath`) and reports whether the target already exists, which turns
 * the Save button into an explicit Overwrite.
 */

import { useEffect, useState } from 'react'
import { useModalDialog } from '../hooks/useModalDialog'
import { rpc } from '../lib/rpc'

interface SaveAsModalProps {
  /** Seed for the name field — the current file name, or the untitled placeholder. */
  defaultName: string
  onSave: (path: string) => void
  onCancel: () => void
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function SaveAsModal({ defaultName, onSave, onCancel }: SaveAsModalProps) {
  const [dir, setDir] = useState<string | null>(null)
  const [name, setName] = useState(defaultName)
  const [error, setError] = useState<string | null>(null)
  const [overwritePath, setOverwritePath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const panelRef = useModalDialog<HTMLDivElement>(onCancel)

  // Any edit invalidates a pending overwrite confirmation.
  useEffect(() => setOverwritePath(null), [dir, name])

  const chooseFolder = async () => {
    setBusy(true)
    setError(null)
    try {
      const picked = await rpc.request.pickProjectDirectory()
      if (picked) setDir(picked)
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    if (!dir) {
      setError('A folder is required.')
      return
    }
    if (overwritePath) {
      onSave(overwritePath)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { path, exists } = await rpc.request.resolveProjectPath({ dir, name })
      if (exists) setOverwritePath(path)
      else onSave(path)
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="help-overlay" onClick={onCancel}>
      <div
        className="confirm-modal"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-as-title"
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="save-as-title">Save project as</h2>
          <button className="modal-close" onClick={onCancel}>
            &times;
          </button>
        </div>

        <div className="confirm-body">
          <label className="save-as-field">
            <span>Folder</span>
            <div className="save-as-folder">
              <input type="text" readOnly value={dir ?? ''} placeholder="No folder chosen" />
              <button onClick={chooseFolder} disabled={busy}>
                Choose…
              </button>
            </div>
          </label>

          <label className="save-as-field">
            <span>File name</span>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void submit()
              }}
              autoFocus
            />
          </label>

          {overwritePath && (
            <p className="save-as-warning">
              <strong>{overwritePath}</strong> already exists. Saving replaces it.
            </p>
          )}
          {error && <p className="error-message">{error}</p>}
        </div>

        <div className="confirm-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className={overwritePath ? 'danger-btn' : 'primary-btn'} onClick={submit} disabled={busy || !dir}>
            {overwritePath ? 'Overwrite' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
