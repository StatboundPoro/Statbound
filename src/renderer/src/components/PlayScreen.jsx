import { useEffect, useRef, useState } from 'react'
import { formatElapsedTime } from '../lib/recording.js'

// Renders no page content of its own for the embed area — the actual
// play.riftatlas.com content is a native WebContentsView the main process
// draws on top of this div's screen position (see src/main/playView.js).
// This component's only job is to tell main process where that rectangle
// is, on mount/resize, and to show/hide the view as this screen mounts and
// unmounts so it doesn't render on top of other screens. Its bounds are
// never adjusted for the Pending Recordings popover — that popover floats
// above this embed via its own dedicated overlay view (see
// pendingPanelView.js) rather than by shrinking this one's bounds, so it
// never resizes or reflows the embedded page just because the popover
// opened.
//
// Recording state/controls are passed in as props rather than owned here
// via useScreenRecording() directly — the hook lives in App.jsx now, since
// Phase 2's auto-detection needs it to survive navigating away from this
// screen mid-match (see lib/recording.js's module comment for why).
//
// `embedHidden` (see App.jsx) is set when a plain-DOM modal needs to render
// on top of this screen — the embed is a native WebContentsView that always
// paints above ordinary page content regardless of CSS z-index, so without
// this it would sit visibly and un-clickably on top of any such modal
// instead of behind it.
export default function PlayScreen({ recording, starting, elapsedSeconds, error, onStart, onStop, embedHidden }) {
  const containerRef = useRef(null)
  // Loaded/persisted straight through the existing Video Capture
  // preferences (settings:get-video-capture/settings:update-video-capture)
  // rather than any new storage — see src/main/preferences.js's
  // autoStartRecording field. Fetched locally here rather than lifted to
  // App.jsx: unlike the recording session itself, this is just a
  // preference value, cheap to refetch on every visit to this screen and
  // with no state that needs to survive navigating away.
  const [autoStartRecording, setAutoStartRecording] = useState(null)

  useEffect(() => {
    window.api.settings
      .getVideoCapture()
      .then((prefs) => setAutoStartRecording(Boolean(prefs?.autoStartRecording)))
      .catch((err) => console.error('Failed to load auto-record preference:', err))
  }, [])

  function handleAutoStartToggle(e) {
    const next = e.target.checked
    setAutoStartRecording(next)
    window.api.settings
      .updateVideoCapture({ autoStartRecording: next })
      .catch((err) => console.error('Failed to save auto-record preference:', err))
  }

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
      window.api.play.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
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

  // Toggles the embed's own visibility in response to embedHidden, on top
  // of (not instead of) the mount/unmount effect above — that effect still
  // owns the initial show() and the final hide() on unmount; this one only
  // reacts to a modal opening/closing while this screen stays mounted.
  // Runs once redundantly alongside the mount effect on initial render
  // (embedHidden starts false), which is harmless — both play.show() and
  // play.hide() are idempotent main-side.
  useEffect(() => {
    if (embedHidden) {
      window.api.play.hide()
      return
    }
    window.api.play.show()
    const el = containerRef.current
    if (el) {
      const rect = el.getBoundingClientRect()
      window.api.play.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
    }
  }, [embedHidden])

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
          <label
            className="checkbox-pill"
            title="Automatically starts recording when a match begins"
          >
            <input
              type="checkbox"
              checked={autoStartRecording ?? false}
              disabled={autoStartRecording === null}
              onChange={handleAutoStartToggle}
            />
            Auto-record
          </label>
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
