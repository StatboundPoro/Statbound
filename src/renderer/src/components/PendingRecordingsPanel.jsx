import { formatDuration, formatSessionTime } from '../lib/stats.js'

// Pure list rendering for the Pending Recordings popover — every recording
// that exists on disk but isn't linked to a match yet. No positioning or
// confirm-dialog logic of its own: it's rendered inside a dedicated
// standalone view (see PendingPanelWindow.jsx) whose own bounds already
// place it correctly, and "Discard" just asks the parent to own the
// confirm step (`onRequestDiscard`) since that step needs real screen
// space this component's own small footprint doesn't have. `fading`
// drives the CSS opacity transition for the self-dismissing auto-popup
// case (see Sidebar.jsx); `onMouseEnter` lets it cancel that if the user
// is actually reading the panel rather than just glancing at it. "Log
// Match" attaches the exact row clicked, not "most recent."
export default function PendingRecordingsPanel({ replays, fading, onMouseEnter, onLogMatch, onRequestDiscard }) {
  return (
    <div className={`pending-recordings-panel ${fading ? 'fading' : ''}`} onMouseEnter={onMouseEnter}>
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
                <button className="btn btn-danger-outline" onClick={() => onRequestDiscard(replay)}>
                  Discard
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
