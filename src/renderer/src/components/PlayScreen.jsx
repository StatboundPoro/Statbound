import { useEffect, useRef } from 'react'
import { formatElapsedTime } from '../lib/recording.js'

// Reserved height, in CSS pixels, carved out of the bottom of the embed's
// reported bounds while the Pending Recordings popover is open — see
// queuePanelOpen below. Sized to comfortably exceed the popover's own max
// height (header + its capped/scrollable list, see .pending-recordings-*
// in styles.css), not measured live, since the WebContentsView's bounds
// must be set before/independent of the popover's own render.
const QUEUE_PANEL_NOTCH_HEIGHT = 400

// Renders no page content of its own for the embed area — the actual
// play.riftatlas.com content is a native WebContentsView the main process
// draws on top of this div's screen position (see src/main/playView.js).
// This component's only job is to tell main process where that rectangle
// is, on mount/resize, and to show/hide the view as this screen mounts and
// unmounts so it doesn't render on top of other screens.
//
// Recording state/controls are passed in as props rather than owned here
// via useScreenRecording() directly — the hook lives in App.jsx now, since
// Phase 2's auto-detection needs it to survive navigating away from this
// screen mid-match (see lib/recording.js's module comment for why).
export default function PlayScreen({
  recording,
  starting,
  elapsedSeconds,
  error,
  onStart,
  onStop,
  queuePanelOpen
}) {
  const containerRef = useRef(null)
  // A ref, not just the prop, because the ResizeObserver/window `resize`
  // listener set up below are created once on mount and must always read
  // the *current* queuePanelOpen value, not the one captured in their
  // closure at mount time — otherwise resizing the window while the
  // popover happens to be open would silently report full-height bounds
  // again, covering it back up.
  const queuePanelOpenRef = useRef(queuePanelOpen)

  useEffect(() => {
    queuePanelOpenRef.current = queuePanelOpen
  }, [queuePanelOpen])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function reportBounds() {
      const rect = el.getBoundingClientRect()
      // DOMRect's x/y/width/height are getters on DOMRect.prototype, not
      // own properties — contextBridge only clones own enumerable
      // properties across the isolated-world boundary, so passing the
      // DOMRect itself arrives in preload as all-undefined. Read the
      // values out into a plain object here, before it crosses the bridge.
      //
      // The embed is a native WebContentsView, a separately-composited
      // surface that always paints above ordinary page content regardless
      // of CSS z-index — nothing in this app's own DOM (including the
      // Pending Recordings popover) can render on top of it by normal
      // means. Rather than fully detaching the whole embed while that
      // popover is open (which blanks out the entire Play screen, not
      // just the small area the popover needs), its reported height is
      // shrunk to carve out a bottom strip the popover can occupy —
      // everything above that strip keeps playing and stays visible.
      const height = queuePanelOpenRef.current
        ? Math.max(0, rect.height - QUEUE_PANEL_NOTCH_HEIGHT)
        : rect.height
      window.api.play.setBounds({ x: rect.x, y: rect.y, width: rect.width, height })
    }

    window.api.play.show()
    reportBounds()

    const observer = new ResizeObserver(reportBounds)
    observer.observe(el)
    window.addEventListener('resize', reportBounds)

    return () => {
      window.removeEventListener('resize', reportBounds)
      observer.disconnect()
      window.api.play.hide()
    }
  }, [])

  // Re-report bounds immediately whenever the popover opens/closes, rather
  // than waiting for the next resize/observer tick.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const height = queuePanelOpen ? Math.max(0, rect.height - QUEUE_PANEL_NOTCH_HEIGHT) : rect.height
    window.api.play.setBounds({ x: rect.x, y: rect.y, width: rect.width, height })
  }, [queuePanelOpen])

  return (
    <div className="main main-play">
      <div className="topbar">
        <div>
          <h1>Play</h1>
          {error && <div className="play-recording-error">{error}</div>}
        </div>
        <div className="topbar-actions recording-controls">
          {recording && (
            <div className="recording-indicator">
              <span className="recording-dot" />
              {formatElapsedTime(elapsedSeconds)}
            </div>
          )}
          <button
            className={`btn ${recording ? 'btn-danger' : ''}`}
            onClick={recording ? onStop : onStart}
            disabled={starting}
          >
            {recording ? 'Stop Recording' : starting ? 'Starting…' : 'Start Recording'}
          </button>
        </div>
      </div>
      <div className="play-embed" ref={containerRef} />
    </div>
  )
}
