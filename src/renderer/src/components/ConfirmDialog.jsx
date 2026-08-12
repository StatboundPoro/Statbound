import { useState } from 'react'

// Generic confirm/cancel modal, styled to match ImportDeckModal. Used
// wherever an action needs a confirmation step before it runs — deck/match
// deletion, and (with `requireText`) the whole-database Import and Reset
// actions in Settings.
//
// `requireText`, when set, asks for a genuine second action rather than a
// single click: the confirm button stays disabled until the user types
// that exact string into a field, the same "type the word to prove you
// mean it" pattern used for the most destructive actions in the app —
// appropriate here since Import/Reset affect every deck, match, and note
// at once, not a single row.
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  error = null,
  requireText = null,
  onConfirm,
  onCancel
}) {
  const [typedText, setTypedText] = useState('')
  const confirmDisabled = busy || (requireText != null && typedText !== requireText)

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="modal modal-confirm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onCancel} aria-label="Close" disabled={busy}>
            ×
          </button>
        </div>
        <p className="confirm-message">{message}</p>
        {requireText != null && (
          <div className="confirm-type-guard">
            <label htmlFor="confirm-type-input">
              Type <strong>{requireText}</strong> to confirm.
            </label>
            <input
              id="confirm-type-input"
              type="text"
              className="confirm-type-input"
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}
        {error && <div className="import-error">{error}</div>}
        <div className="modal-actions">
          <button className="btn" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
