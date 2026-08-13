import fs from 'fs'
import path from 'path'
import { desktopCapturer } from 'electron'
import { getVideoCapturePrefs } from './preferences.js'

let mainWindow = null
let writeStream = null
let currentFilePath = null

// The recording's own filename, not a machine-parsed identifier — built
// from the local system clock (not UTC) and left as plain "YYYY-MM-DD_HH-
// mm-ss" so a user browsing the Video Capture folder can tell recordings
// apart at a glance, without doing timezone math on a trailing "Z".
function localTimestampForFilename() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  )
}

/**
 * Remembers the main window so getCaptureSourceId() can find its capture
 * source later — mirrors initPlayView()'s pattern in playView.js.
 */
export function initCapture(win) {
  mainWindow = win
}

/**
 * Finds the desktopCapturer source for this app's own BrowserWindow, so the
 * renderer can hand its id straight to getUserMedia without ever touching
 * desktopCapturer itself (that API isn't exposed across the preload
 * bridge). `getMediaSourceId()` gives the exact id Chromium assigned this
 * window, which is matched against the `types: ['window']` source list
 * rather than trusting it blind, in case a given source ever isn't
 * enumerated. Falls back to the id itself if no match turns up, since it's
 * still valid on its own for getUserMedia.
 */
export async function getCaptureSourceId() {
  if (!mainWindow) return null
  const targetId = mainWindow.getMediaSourceId()
  const sources = await desktopCapturer.getSources({ types: ['window'] })
  const match = sources.find((source) => source.id === targetId)
  return match?.id ?? targetId
}

/**
 * Opens a fresh write stream at a timestamped path inside the configured
 * Video Capture folder and returns its path. Idempotent while a recording
 * is already open — the Play tab's Start/Stop control only ever shows one
 * button at a time, but this backstops that instead of trusting the UI
 * alone (same reasoning matches.js validates server-side despite the form
 * already enforcing its own rules).
 */
export function startCaptureFile() {
  if (writeStream) return { filePath: currentFilePath }

  const { directory } = getVideoCapturePrefs()
  fs.mkdirSync(directory, { recursive: true })

  const fileName = `rifttrack-${localTimestampForFilename()}.webm`
  currentFilePath = path.join(directory, fileName)
  writeStream = fs.createWriteStream(currentFilePath)

  return { filePath: currentFilePath }
}

/**
 * Appends one MediaRecorder chunk (sent from the renderer as a Uint8Array,
 * arriving here structured-cloned into a Node Buffer-compatible view) to
 * the open write stream. Streaming chunks in as they arrive — rather than
 * buffering the whole recording in the renderer and sending it once at the
 * end — keeps a long match from holding an ever-growing Blob in memory.
 */
export function appendCaptureChunk(chunk) {
  if (!writeStream) return
  writeStream.write(Buffer.from(chunk))
}

/**
 * The file path currently being written to, or null if no recording is
 * active. Used by replays.js to exclude an in-progress recording from the
 * unlinked/pending lists — showing (or worse, letting someone Discard) a
 * file that's still being actively written to would be a real bug, not
 * just a cosmetic one.
 */
export function getActiveCaptureFilePath() {
  return writeStream ? currentFilePath : null
}

/**
 * Closes the write stream cleanly and resolves once every buffered chunk
 * has actually been flushed to disk. Safe to call with nothing open.
 */
export function stopCaptureFile() {
  const filePath = currentFilePath
  if (!writeStream) return Promise.resolve({ filePath })

  const stream = writeStream
  writeStream = null
  currentFilePath = null

  return new Promise((resolve) => {
    stream.end(() => resolve({ filePath }))
  })
}
