/**
 * Prompt shown before an action that would discard unsaved edits (New, Open, examples).
 * Cancel is the safe default: the backdrop and Escape both take it.
 */

import { useModalDialog } from '../hooks/useModalDialog'

interface UnsavedChangesModalProps {
  /** What the user asked for, e.g. "Opening another project". */
  action: string
  projectName: string
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

export function UnsavedChangesModal({ action, projectName, onSave, onDiscard, onCancel }: UnsavedChangesModalProps) {
  const panelRef = useModalDialog<HTMLDivElement>(onCancel)

  return (
    <div className="help-overlay" onClick={onCancel}>
      <div
        className="confirm-modal"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="unsaved-changes-title">Unsaved changes</h2>
          <button className="modal-close" onClick={onCancel}>
            &times;
          </button>
        </div>
        <div className="confirm-body">
          <p>
            {action} will discard unsaved changes to <strong>{projectName}</strong>.
          </p>
        </div>
        <div className="confirm-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="danger-btn" onClick={onDiscard}>
            Discard changes
          </button>
          <button className="primary-btn" onClick={onSave} autoFocus>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
