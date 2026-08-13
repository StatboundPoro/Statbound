import { useState } from 'react'
import { formatDuration, formatSessionTime } from '../lib/stats.js'
import ConfirmDialog from './ConfirmDialog.jsx'

// Popover listing every recording that exists on disk but isn't linked to
// a match yet — opened either by clicking the Sidebar's badge, or by
// itself as a self-dismissing notification right after a recording
// finishes (see Sidebar.jsx's recordingStoppedSignal effect). `fading`
// drives the CSS opacity transition for that auto-dismiss; `onMouseEnter`
// lets Sidebar cancel it if the user is actually reading the panel rather
// than just glancing at it. "Log Match" attaches the exact row clicked
// (not "most recent"); "Discard" deletes the file outright, gated by a
// plain click-confirm rather than the typed-confirmation pattern Import/
// Reset use in Settings, since this only ever destroys an unlinked file,
// not logged match data.
export default function PendingRecordingsPanel({ replays, anchorRect, fading, onMouseEnter, onLogMatch, onDiscard }) {
  const [discardTarget, setDiscardTarget] = useState(null)
  const [discarding, setDiscarding] = useState(false)

  async function handleConfirmDiscard() {
    setDiscarding(true)
    await onDiscard(discardTarget)
    setDiscarding(false)
    setDiscardTarget(null)
  }

  // Positioned from the trigger's own screen coordinates rather than CSS
  // relative to a parent — this renders through a portal into <body> (see
  // Sidebar.jsx), so it has no normal-flow relationship to the rail item
  // that opened it.
  const style = anchorRect
    ? { left: anchorRect.right + 12, bottom: window.innerHeight - anchorRect.bottom }
    : undefined

  return (
    <>
      <div
        className={`pending-recordings-panel ${fading ? 'fading' : ''}`}
        style={style}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={onMouseEnter}
      >
        <div className="pending-recordings-header">Pending Recordings</div>
        {replays.length === 0 ? (
          <div className="pending-recordings-empty">No pending recordings.</div>
        ) : (
          <div className="pending-recordings-list">
            {replays.map((replay) => (
              <div key={replay.filePath} className="pending-recording-row">
                <div className="pending-recording-meta">
                  {formatSessionTime(replay.startedAt)} · {formatDuration(replay.startedAt, replay.endedAt)}
                </div>
                <div className="pending-recording-actions">
                  <button className="btn" onClick={() => onLogMatch(replay)}>
                    Log Match
                  </button>
                  <button className="btn btn-danger-outline" onClick={() => setDiscardTarget(replay)}>
                    Discard
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {discardTarget && (
        <ConfirmDialog
          title="Discard Recording?"
          message="This permanently deletes the recording file. It hasn't been linked to any match, so no logged match data is affected."
          confirmLabel="Discard"
          danger
          busy={discarding}
          onConfirm={handleConfirmDiscard}
          onCancel={() => setDiscardTarget(null)}
        />
      )}
    </>
  )
}
