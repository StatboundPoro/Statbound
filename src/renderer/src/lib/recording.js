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
 * Deliberately scoped to whatever component calls this hook, not lifted
 * higher: PlayScreen.jsx unmounts when the user navigates to another rail
 * screen (App.jsx renders one screen at a time, not all of them hidden),
 * so navigating away from Play mid-recording stops it via the cleanup
 * effect below rather than leaving an invisible recording running with no
 * visible control anywhere to stop it.
 */
export function useScreenRecording() {
  const [recording, setRecording] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [error, setError] = useState(null)

  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const pendingChunksRef = useRef(Promise.resolve())
  const startedAtRef = useRef(null)
  const tickIntervalRef = useRef(null)

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

  const start = useCallback(async () => {
    if (recorderRef.current) return
    setError(null)

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
    } catch (err) {
      console.error('Failed to start recording:', err)
      setError('Could not start recording. Check the main process console.')
      teardown()
    }
  }, [teardown])

  const stop = useCallback(() => {
    if (!recorderRef.current) return
    recorderRef.current.stop()
    teardown()
    setRecording(false)
  }, [teardown])

  return { recording, elapsedSeconds, error, start, stop }
}
