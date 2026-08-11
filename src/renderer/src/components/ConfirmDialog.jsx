// Generic confirm/cancel modal, styled to match ImportDeckModal. Used
// wherever an action needs a confirmation step before it runs (currently
// just deck deletion, in the Deck Library grid and on the Deck Detail
// page) — the caller owns what happens on confirm.
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  error = null,
  onConfirm,
  onCancel
}) {
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
        {error && <div className="import-error">{error}</div>}
        <div className="modal-actions">
          <button className="btn" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
