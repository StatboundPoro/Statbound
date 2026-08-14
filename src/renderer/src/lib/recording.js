import { useCallback, useEffect, useRef, useState } from 'react'

function pickAudioMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm']
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? 'audio/webm'
}

export function formatElapsedTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * Manual Start/Stop screen recording for the Play tab. Video is captured
 * and encoded entirely in the main process now — a self-scheduling
 * webContents.capturePage() loop piped into ffmpeg (see src/main/capture.js)
 * — producing a tight crop of just the Play tab's own content, not the
 * whole app window the way the original desktopCapturer+MediaRecorder
 * pipeline did. This hook's job for video is now just "tell main to
 * start/stop" — no stream, no MediaRecorder, no chunk-streaming, for video.
 *
 * Audio is a separate, best-effort attempt that still happens here in the
 * renderer (getUserMedia and MediaRecorder are Web APIs, unavailable in the
 * main process): a desktop-audio-scoped getUserMedia call feeding its own
 * audio-only MediaRecorder, streamed to main as a separate file the same
 * way video chunks used to stream in Phase 1. Every step of the audio path
 * is wrapped so a failure (permission denied, no audio track, an
 * unsupported platform, anything) is logged and otherwise ignored — it must
 * never prevent, delay, or affect video capture, which is why it's kicked
 * off in parallel with (not awaited before) the video start below. Main
 * decides at Stop time whether an audio file actually has content and muxes
 * it in only if so — see capture.js's stopRecording().
 *
 * Lives in App.jsx, not PlayScreen.jsx — deliberately lifted above the
 * per-screen render tree (unlike Phase 1, where it was scoped to
 * PlayScreen's own lifetime and stopped on unmount). Phase 2's
 * WebSocket-driven auto-start/stop (see src/main/autoCapture.js) can fire
 * at any point while the Play tab's embedded WebContentsView is alive,
 * which persists across screen navigation (see playView.js) — if the hook
 * still lived inside PlayScreen, navigating away mid-match would silently
 * stop a recording auto-detection is actively relying on. App.jsx passes
 * this hook's state/handlers down to PlayScreen as props purely so it can
 * render — the indicator (red dot + elapsed mm:ss) and button look and
 * behave exactly as before; only where the state lives, and how the video
 * itself gets produced, changed.
 *
 * `onStopped`, if given, fires once a recording has fully finished writing
 * to disk (after capture:stop resolves — video finalized, and muxed with
 * audio if any was captured) — the moment a new file genuinely exists as a
 * pending recording, which is what the Pending Recordings badge count
 * needs to know to refetch.
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

  // Whether a session is logically active, independent of the audio
  // MediaRecorder's own existence — stop() needs this rather than checking
  // an audio-specific ref, since audio may never have started at all.
  const activeRef = useRef(false)
  const audioRecorderRef = useRef(null)
  const audioStreamRef = useRef(null)
  const pendingAudioChunksRef = useRef(Promise.resolve())
  // Resolves once the audio MediaRecorder's 'stop' event has fired and
  // every chunk from it has been sent — stop() awaits this (or immediately
  // resolves it if audio never started) before telling main to finalize,
  // so a still-in-flight last chunk can't arrive after main has already
  // closed the audio write stream. Mirrors Phase 1's pendingChunksRef
  // pattern, just for audio instead of video.
  const audioStoppedRef = useRef(null)
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
    audioStreamRef.current?.getTracks().forEach((track) => track.stop())
    audioStreamRef.current = null
    audioRecorderRef.current = null
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current)
      tickIntervalRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      if (audioRecorderRef.current && audioRecorderRef.current.state !== 'inactive') {
        audioRecorderRef.current.stop()
      }
      teardown()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Best-effort only — every failure path here logs and returns, leaving
   * audioRecorderRef unset, which start() and stop() both already treat as
   * "no audio this session." Never throws out to its caller.
   *
   * Chromium's Windows Graphics Capture backend, at least as of Electron 43
   * on Windows, doesn't just fail an audio-only getUserMedia request scoped
   * to a window source (`chromeMediaSource: 'desktop'` with `video: false`)
   * — it kills the entire renderer process with a "bad IPC message" error,
   * taking down the whole app, not just this best-effort attempt. That's
   * strictly worse than "no audio," so a paired video constraint is
   * requested alongside audio (same window source id) to activate capture,
   * and its video track is stopped and discarded immediately — only the
   * audio track ever reaches a MediaRecorder. This was found by actually
   * running the app, not inferred from documentation; if a future Electron/
   * Chromium version changes this behavior, it's still safe to leave this
   * as-is, since audio remains best-effort either way.
   */
  async function tryStartAudio() {
    let combinedStream = null
    try {
      const sourceId = await window.api.capture.getSourceId()
      if (!sourceId) throw new Error('No capture source id available for audio.')

      combinedStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId
          }
        },
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId
          }
        }
      })

      const audioTracks = combinedStream.getAudioTracks()
      combinedStream.getVideoTracks().forEach((track) => track.stop())
      if (audioTracks.length === 0) {
        throw new Error('Captured stream has no audio tracks.')
      }

      const stream = new MediaStream(audioTracks)
      const recorder = new MediaRecorder(stream, { mimeType: pickAudioMimeType() })
      let resolveStopped
      audioStoppedRef.current = new Promise((resolve) => {
        resolveStopped = resolve
      })

      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return
        pendingAudioChunksRef.current = pendingAudioChunksRef.current.then(async () => {
          const buffer = new Uint8Array(await event.data.arrayBuffer())
          window.api.capture.sendAudioChunk(buffer)
        })
      }
      recorder.onstop = async () => {
        await pendingAudioChunksRef.current
        resolveStopped()
      }
      recorder.onerror = (event) => {
        console.error('Audio recording failed, continuing without audio:', event.error)
      }

      recorder.start(1500)
      window.api.capture.notifyAudioStarted()
      audioRecorderRef.current = recorder
      audioStreamRef.current = stream
    } catch (err) {
      console.error('Audio capture unavailable, recording will be silent:', err)
      combinedStream?.getTracks().forEach((track) => track.stop())
      audioRecorderRef.current = null
      audioStreamRef.current = null
      audioStoppedRef.current = null
    }
  }

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

        // Kicked off after video has already started successfully, and
        // never awaited before setting recording state — a slow or failing
        // audio attempt must not delay or block the video path being ready.
        tryStartAudio()
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

    const audioRecorder = audioRecorderRef.current
    if (audioRecorder && audioRecorder.state !== 'inactive') {
      audioRecorder.stop()
    }
    const audioDone = audioStoppedRef.current ?? Promise.resolve()

    audioDone
      .catch(() => {})
      .then(() => window.api.capture.stop())
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
