import { formatDuration, formatSessionTime } from '../lib/stats.js'

// Pure list rendering for the "Log Recent Match" popover — one row per
// finished match session waiting to be logged, whether or not it has a
// recording attached (see src/main/replays.js's listPendingReplays() for
// the two item shapes this merges: hasRecording: true for a linkable
// video file, hasRecording: false for a bare session detected via
// WebSocket with no recording ever tied to it, or one pieced together
// after a crash from a sidecar whose video couldn't be salvaged — see
// item.recovered below). No positioning or
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
      <div className="pending-recordings-header">Log Recent Match</div>
      {replays.length === 0 ? (
        <div className="pending-recordings-empty">No matches to log.</div>
      ) : (
        <div className="pending-recordings-list">
          {replays.map((item) => (
            <div key={item.id} className="pending-recording-row">
              <div className="pending-recording-meta">
                {formatSessionTime(item.startedAt)} · {formatDuration(item.startedAt, item.endedAt)}
              </div>
              <div className={`pending-recording-status ${item.hasRecording ? 'has-recording' : 'no-recording'}`}>
                {item.hasRecording ? 'Recording available' : 'No recording'}
              </div>
              {item.recovered && (
                <div className="pending-recording-recovered-badge">
                  Recovered after a crash, estimated time
                </div>
              )}
              <div className="pending-recording-actions">
                <button className="btn" onClick={() => onLogMatch(item)}>
                  Log Match
                </button>
                <button className="btn btn-danger-outline" onClick={() => onRequestDiscard(item)}>
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
