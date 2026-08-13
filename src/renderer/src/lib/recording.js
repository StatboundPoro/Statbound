import { useCallback, useEffect, useRef, useState } from 'react'

// Falls back to this if the video-capture quality preference is unset —
// roughly 1080p/24fps range, matching 'medium'.
const DEFAULT_BITS_PER_SECOND = 1_100_000
const BITS_PER_SECOND_BY_QUALITY = {
  low: 700_000,
  medium: 1_100_000,
  high: 2_500_000
}

function pickMimeType() {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? 'video/webm'
}

export function formatElapsedTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * Manual Start/Stop screen recording for the Play tab. Captures the whole
 * app window — Electron can't isolate capture to just the Play tab's
 * embedded WebContentsView, so v1 accepts the full app chrome — video
 * only, no audio track. Recorded chunks stream to main over IPC as they
 * arrive (MediaRecorder's ondataavailable at a 1.5s timeslice) rather than
 * being buffered into one Blob in renderer memory, since a match can run
 * well past 10 minutes.
 *
 * Lives in App.jsx, not PlayScreen.jsx — deliberately lifted above the
 * per-screen render tree (unlike Phase 1, where it was scoped to
 * PlayScreen's own lifetime and stopped on unmount). Phase 2's
 * WebSocket-driven auto-start/stop (see src/main/autoCapture.js) can fire
 * at any point while the Play tab's embedded WebContentsView is alive,
 * which persists across screen navigation (see playView.js) — if the hook
 * still lived inside PlayScreen, navigating away mid-match would silently
 * stop a recording auto-detection is actively relying on. App.jsx passes
 * this hook's state/handlers down to PlayScreen as props so the Play tab's
 * indicator/button look and behave exactly as before; nothing about the
 * visible UI changed, only where the state that drives it lives.
 *
 * `onStopped`, if given, fires once a recording has fully finished writing
 * to disk (after capture:stop resolves) — the moment a new file genuinely
 * exists as a pending recording, which is what the Pending Recordings
 * badge count needs to know to refetch.
 */
export function useScreenRecording({ onStopped } = {}) {
  const [recording, setRecording] = useState(false)
  // Windows' capture backend (WGC) reliably takes several seconds and a
  // few failed internal attempts before it can actually grab this app's
  // window — visible as "Source is not capturable" spam in the main
  // process console — before falling back to a capturer that works. It's
  // a real, per-recording delay this app has no way to skip, so `starting`
  // exists purely to keep the Start button from looking unresponsive
  // during that gap rather than to mask an error state.
  const [starting, setStarting] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [error, setError] = useState(null)

  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const pendingChunksRef = useRef(Promise.resolve())
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
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    recorderRef.current = null
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current)
      tickIntervalRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop()
      }
      teardown()
    }
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
      if (recorderRef.current || starting) return
      setError(null)
      setStarting(true)

      try {
        const sourceId = await window.api.capture.getSourceId()
        if (!sourceId) throw new Error('Could not find this window to record.')

        const videoCapture = await window.api.settings.getVideoCapture()
        const videoBitsPerSecond = BITS_PER_SECOND_BY_QUALITY[videoCapture?.quality] ?? DEFAULT_BITS_PER_SECOND

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
              maxFrameRate: 24
            }
          }
        })

        await window.api.capture.start()

        const recorder = new MediaRecorder(stream, { mimeType: pickMimeType(), videoBitsPerSecond })

        // Chained so onstop (below) can await every chunk actually being
        // sent — including the final one, whose async arrayBuffer() read
        // could otherwise still be pending when the 'stop' event fires and
        // main closes the write stream out from under it.
        recorder.ondataavailable = (event) => {
          if (event.data.size === 0) return
          pendingChunksRef.current = pendingChunksRef.current.then(async () => {
            const buffer = new Uint8Array(await event.data.arrayBuffer())
            window.api.capture.sendChunk(buffer)
          })
        }
        recorder.onstop = async () => {
          await pendingChunksRef.current
          await window.api.capture.stop()
          onStoppedRef.current?.()
        }

        recorder.start(1500)
        recorderRef.current = recorder
        streamRef.current = stream
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
        teardown()
      } finally {
        setStarting(false)
      }
    },
    [starting, teardown]
  )

  const stop = useCallback(() => {
    if (!recorderRef.current) return
    recorderRef.current.stop()
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
