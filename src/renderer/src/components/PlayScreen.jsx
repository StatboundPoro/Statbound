import { useCallback, useEffect, useRef, useState } from 'react'
import { formatElapsedTime } from '../lib/recording.js'

// The embed is deliberately pinned to standard 16:9 rather than filling
// whatever shape its container happens to be — matches recorded video's own
// aspect ratio (see capture.js's MAX_RECORDING_HEIGHT: a 16:9 source scales
// to exactly 1920x1080, not some off-ratio size) and matches most players'
// own native aspect ratio assumptions. `.play-embed`'s own background/
// border (styles.css) shows through as real letterbox/pillarbox bars around
// it on any container that isn't already 16:9 — not a bug, the intended
// framing.
const TARGET_ASPECT_RATIO = 16 / 9

/**
 * Fits a 16:9 rectangle inside `rect`, centered, never upscaled beyond it —
 * pillarboxed (bars on the sides) if the container is wider than 16:9,
 * letterboxed (bars on top/bottom) if it's narrower.
 */
function fitToAspectRatio(rect) {
  const { x, y, width, height } = rect
  if (width <= 0 || height <= 0) return rect

  const containerRatio = width / height
  const fitted =
    containerRatio > TARGET_ASPECT_RATIO
      ? { width: height * TARGET_ASPECT_RATIO, height }
      : { width, height: width / TARGET_ASPECT_RATIO }

  return {
    x: x + (width - fitted.width) / 2,
    y: y + (height - fitted.height) / 2,
    width: fitted.width,
    height: fitted.height
  }
}

// Renders no page content of its own for the embed area — the actual
// play.riftatlas.com content is a native WebContentsView the main process
// draws on top of a 16:9 box centered in this div's screen position (see
// src/main/playView.js). This component's only job is to tell main process
// where that rectangle is, on mount/resize, and to show/hide the view as
// this screen mounts and unmounts so it doesn't render on top of other
// screens. Its bounds are never adjusted for the Pending Recordings
// popover — that popover floats above this embed via its own dedicated
// overlay view (see pendingPanelView.js) rather than by shrinking this
// one's bounds, so it never resizes or reflows the embedded page just
// because the popover opened.
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
// instead of behind it. `onLogMatch(deckId)` is the deck picker's own
// manual "Log Match" button (see below) — it's lifted to App.jsx for the
// exact same embedHidden reason, not handled locally in this component.
export default function PlayScreen({ recording, starting, elapsedSeconds, error, onStart, onStop, embedHidden, onLogMatch }) {
  const containerRef = useRef(null)
  // Loaded/persisted straight through the existing Video Capture
  // preferences (settings:get-video-capture/settings:update-video-capture)
  // rather than any new storage — see src/main/preferences.js's
  // autoStartRecording field. Fetched locally here rather than lifted to
  // App.jsx: unlike the recording session itself, this is just a
  // preference value, cheap to refetch on every visit to this screen and
  // with no state that needs to survive navigating away.
  const [autoStartRecording, setAutoStartRecording] = useState(null)

  // The deck picker next to the recording controls. Persisted via
  // preferences.js's lastSelectedPlayDeckId (play:get/set-selected-deck)
  // rather than lifted to App.jsx, same reasoning as autoStartRecording
  // above — it's a plain preference value. autoCapture.js reads the same
  // preference directly (not over IPC) the instant a new match session
  // starts, to snapshot which deck that session should be tagged with —
  // see matchSessions.js.
  const [decks, setDecks] = useState([])
  const [selectedDeckId, setSelectedDeckId] = useState('')
  const [decksReady, setDecksReady] = useState(false)

  // Back/Forward button enablement, driven by the embed's real navigation
  // history (see src/main/playView.js) rather than assumed always-clickable.
  const [navState, setNavState] = useState({ canGoBack: false, canGoForward: false })

  useEffect(() => {
    window.api.play
      .getNavState()
      .then(setNavState)
      .catch((err) => console.error('Failed to load Play tab navigation state:', err))
    return window.api.play.onNavStateChanged(setNavState)
  }, [])

  useEffect(() => {
    window.api.settings
      .getVideoCapture()
      .then((prefs) => setAutoStartRecording(Boolean(prefs?.autoStartRecording)))
      .catch((err) => console.error('Failed to load auto-record preference:', err))
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([window.api.decks.list(), window.api.play.getSelectedDeck()])
      .then(([deckList, savedDeckId]) => {
        if (cancelled) return
        setDecks(deckList)
        // The saved deck may have been deleted since it was last picked —
        // fall back to no selection rather than erroring or silently
        // pointing at a deck that no longer exists.
        setSelectedDeckId(savedDeckId && deckList.some((d) => d.id === savedDeckId) ? savedDeckId : '')
        setDecksReady(true)
      })
      .catch((err) => console.error('Failed to load Play tab deck picker:', err))
    return () => {
      cancelled = true
    }
  }, [])

  function handleAutoStartToggle(e) {
    const next = e.target.checked
    setAutoStartRecording(next)
    window.api.settings
      .updateVideoCapture({ autoStartRecording: next })
      .catch((err) => console.error('Failed to save auto-record preference:', err))
  }

  function handleDeckChange(e) {
    const next = e.target.value
    setSelectedDeckId(next)
    window.api.play.setSelectedDeck(next || null).catch((err) => console.error('Failed to save Play tab deck selection:', err))
  }

  // Shared by both effects below, so the 16:9-fitting math lives in exactly
  // one place rather than being duplicated between the mount effect and the
  // embedHidden effect.
  const reportBounds = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    // DOMRect's x/y/width/height are getters on DOMRect.prototype, not own
    // properties — contextBridge only clones an object's own enumerable
    // properties across the isolated-world boundary, so passing the DOMRect
    // itself arrives in preload as all-undefined. Read the values out into
    // a plain object (via fitToAspectRatio) before it crosses the bridge.
    const bounds = fitToAspectRatio({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
    window.api.play.setBounds(bounds)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

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
  }, [reportBounds])

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
    reportBounds()
  }, [embedHidden, reportBounds])

  return (
    <div className="main main-play">
      <div className="topbar">
        <div>
          <h1>Play</h1>
          {error && <div className="play-recording-error">{error}</div>}
        </div>
        <div className="topbar-actions recording-controls">
          <div className="play-nav-controls">
            <button
              className="btn"
              onClick={() => window.api.play.goBack()}
              disabled={!navState.canGoBack}
              title="Back"
              aria-label="Back"
            >
              ← Back
            </button>
            <button
              className="btn"
              onClick={() => window.api.play.goForward()}
              disabled={!navState.canGoForward}
              title="Forward"
              aria-label="Forward"
            >
              Forward →
            </button>
            <button
              className="btn"
              onClick={() => window.api.play.returnToLobby()}
              title="Return to the Rift Atlas lobby"
            >
              Return to Lobby
            </button>
          </div>
          <div className="play-deck-picker">
            <select
              className="play-deck-select"
              value={selectedDeckId}
              onChange={handleDeckChange}
              disabled={!decksReady}
              aria-label="Deck being played"
            >
              <option value="">No deck selected</option>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <button className="btn" onClick={() => onLogMatch(selectedDeckId || null)}>
              Log Match
            </button>
          </div>
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
