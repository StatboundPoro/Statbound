import { useCallback, useEffect, useRef, useState } from 'react'

export function formatElapsedTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * Manual Start/Stop screen recording for the Play tab. Video is captured
 * and encoded entirely in the main process — a self-scheduling
 * webContents.capturePage() loop piped into ffmpeg (see src/main/capture.js)
 * — producing a tight crop of just the Play tab's own content, not the
 * whole app window. This hook's job is just "tell main to start/stop" and
 * track UI state (elapsed time, error) around that — no stream, no
 * MediaRecorder, no chunk-streaming happens in the renderer at all.
 *
 * Recordings are video-only. An earlier version of this hook also ran a
 * best-effort audio capture here (getUserMedia + MediaRecorder, streamed to
 * main as a separate file to mux in at Stop) — removed because the only
 * way to avoid a renderer-crashing Electron/Windows bug with an audio-only
 * getUserMedia request was to scope it to this app's own window source,
 * which in practice still captured whatever audio was actually routed
 * through the system's default output, not just this app's — i.e. it
 * wasn't actually scoped to just the app the way it was meant to be, with
 * no way found to narrow it further. See git history for that
 * implementation if audio capture is revisited with a real per-app
 * scoping mechanism.
 *
 * Lives in App.jsx, not PlayScreen.jsx — deliberately lifted above the
 * per-screen render tree (unlike an early version, where it was scoped to
 * PlayScreen's own lifetime and stopped on unmount). WebSocket-driven
 * auto-start/stop (see src/main/autoCapture.js) can fire at any point while
 * the Play tab's embedded WebContentsView is alive, which persists across
 * screen navigation (see playView.js) — if the hook still lived inside
 * PlayScreen, navigating away mid-match would silently stop a recording
 * auto-detection is actively relying on. App.jsx passes this hook's
 * state/handlers down to PlayScreen as props purely so it can render — the
 * indicator (red dot + elapsed mm:ss) and button look and behave exactly
 * as before; only where the state lives changed.
 *
 * `onStopped`, if given, fires once a recording has fully finished writing
 * to disk (after capture:stop resolves) — the moment a new file genuinely
 * exists as a pending recording, which is what the Pending Recordings
 * badge count needs to know to refetch.
 */
export function useScreenRecording({ onStopped } = {}) {
  const [recording, setRecording] = useState(false)
  // Capturing the Play tab's first frame and spawning ffmpeg can take a
  // moment — `starting` exists purely to keep the Start button from
  // looking unresponsive during that gap rather than to mask an error
  // state.
  const [starting, setStarting] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [error, setError] = useState(null)

  const activeRef = useRef(false)
  const startedAtRef = useRef(null)
  const tickIntervalRef = useRef(null)
  // A ref (not a start()/stop() dependency) so a caller passing a fresh
  // inline callback every render doesn't churn start()'s identity, which
  // would otherwise re-fire the auto-start/stop subscription effect below
  // on every render for no reason.
  const onStoppedRef = useRef(onStopped)
  useEffect(() => {
    onStoppedRef.current = onStopped
  }, [onStopped])

  const teardown = useCallback(() => {
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current)
      tickIntervalRef.current = null
    }
  }, [])

  useEffect(() => {
    return teardown
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // `manual` distinguishes a real Play-tab button press from an
  // auto-detected start (see the onAutoStart subscription below) — only a
  // manual press needs to tell main's autoCapture.js state machine (see
  // handleManualStart there) that a recording just began, so it can be
  // associated with a match session already seen while auto-start was off.
  // Auto-started recordings need no such notification: main already knows
  // about them by definition.
  const start = useCallback(
    async ({ manual = true } = {}) => {
      if (activeRef.current || starting) return
      setError(null)
      setStarting(true)

      try {
        await window.api.capture.start()

        activeRef.current = true
        startedAtRef.current = Date.now()
        setElapsedSeconds(0)
        tickIntervalRef.current = setInterval(() => {
          setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000))
        }, 1000)
        setRecording(true)
        if (manual) window.api.capture.notifyManualStart()
      } catch (err) {
        console.error('Failed to start recording:', err)
        setError('Could not start recording. Check the main process console.')
        activeRef.current = false
        teardown()
      } finally {
        setStarting(false)
      }
    },
    [starting, teardown]
  )

  const stop = useCallback(() => {
    if (!activeRef.current) return
    activeRef.current = false

    window.api.capture
      .stop()
      .catch((err) => console.error('Failed to finalize recording:', err))
      .finally(() => onStoppedRef.current?.())

    teardown()
    setRecording(false)
  }, [teardown])

  // Auto-detection push events from main (see src/main/autoCapture.js) —
  // reuse the exact same start()/stop() the manual button calls, so every
  // idempotency/error-handling guard already built into them (no double
  // start, stop-whatever's-running) applies here too with no special
  // casing. Subscribed for this hook's whole lifetime (App.jsx, effectively
  // the app's lifetime) so a join_game seen while the user is on any
  // screen still triggers a real recording, not just while on Play tab.
  useEffect(() => {
    const unsubscribeStart = window.api.capture.onAutoStart(() => start({ manual: false }))
    const unsubscribeStop = window.api.capture.onAutoStop(() => stop())
    return () => {
      unsubscribeStart()
      unsubscribeStop()
    }
  }, [start, stop])

  return { recording, starting, elapsedSeconds, error, start, stop }
}
