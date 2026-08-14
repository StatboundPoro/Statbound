import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { app, desktopCapturer } from 'electron'
import ffmpegBinaryPath from 'ffmpeg-static'
import { getVideoCapturePrefs } from './preferences.js'
import { getPlayWebContents } from './playView.js'

// The frame-grab loop's target rate — see captureLoopTick() below for why
// this is a target, not a guarantee: webContents.capturePage() is async and
// variable-latency, so sustained 24fps depends on how fast this machine can
// actually produce frames.
const TARGET_FPS = 24
const FRAME_INTERVAL_MS = Math.round(1000 / TARGET_FPS)

const BITRATE_BY_QUALITY = { low: '700k', medium: '1100k', high: '2500k' }
const DEFAULT_BITRATE = '1100k'

let mainWindow = null

// One recording session's worth of state. There is only ever one recording
// at a time (mirrors the rest of this module's pre-existing single-session
// assumption) — null whenever nothing is being recorded.
let session = null

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
 * bridge). Video no longer goes through desktopCapturer/getUserMedia at all
 * (see captureLoopTick below) — this now exists purely for the best-effort
 * audio-only getUserMedia capture in lib/recording.js, which still needs a
 * window source id to ask for this app's own loopback audio. `getMediaSourceId()`
 * gives the exact id Chromium assigned this window, which is matched
 * against the `types: ['window']` source list rather than trusting it
 * blind, in case a given source ever isn't enumerated. Falls back to the id
 * itself if no match turns up, since it's still valid on its own for
 * getUserMedia.
 */
export async function getCaptureSourceId() {
  if (!mainWindow) return null
  const targetId = mainWindow.getMediaSourceId()
  const sources = await desktopCapturer.getSources({ types: ['window'] })
  const match = sources.find((source) => source.id === targetId)
  return match?.id ?? targetId
}

/**
 * Resolves the bundled ffmpeg binary's real on-disk path. ffmpeg-static
 * ships a native executable; electron-builder's default asar packing would
 * otherwise seal it inside app.asar, where it can't be spawned as a child
 * process. package.json's "build.asarUnpack" entry tells electron-builder
 * to leave ffmpeg-static's files unpacked on disk instead — this just needs
 * to know to look under .../app.asar.unpacked/ rather than .../app.asar/
 * once actually running from a packaged build, which is ffmpeg-static's own
 * documented approach for Electron apps.
 */
function resolveFfmpegPath() {
  if (!app.isPackaged) return ffmpegBinaryPath
  return ffmpegBinaryPath.replace('app.asar', 'app.asar.unpacked')
}

function qualityToBitrate(quality) {
  return BITRATE_BY_QUALITY[quality] ?? DEFAULT_BITRATE
}

/**
 * Records a freshly captured frame as this session's "last known good"
 * bitmap — the one padFramesToWallClock() below duplicates when real
 * capture can't keep up. Frame size is fixed for the whole session (see
 * startRecording()); a frame at any other size is dropped rather than
 * corrupting the raw video stream ffmpeg expects at one fixed -s.
 */
function updateLastGoodFrame(image) {
  const { width, height } = image.getSize()
  if (width !== session.frameWidth || height !== session.frameHeight) {
    if (!session.warnedFrameSizeMismatch) {
      session.warnedFrameSizeMismatch = true
      console.warn('[capture] Play tab size changed mid-recording — ignoring frames until it matches again')
    }
    return
  }
  session.lastGoodBitmap = image.toBitmap()
  session.realFrameCount += 1
}

/**
 * webContents.capturePage() is too slow on real hardware to sustain
 * TARGET_FPS (confirmed by actually running this — see CLAUDE.md's Replay
 * Recording entry for the measured rate) — but ffmpeg was already told at
 * spawn time that its raw video input arrives at a fixed TARGET_FPS, so if
 * fewer real frames are written than that implies for the wall-clock time
 * elapsed, the encoded file's own internal timeline runs short relative to
 * real time (a 6-second recording came out as a ~1.9-second video in
 * testing) — silently desyncing it from the separately-recorded, real-time
 * audio track. Rather than accept that drift, this pads the gap by writing
 * duplicate copies of the last successfully captured frame until the
 * number of frames written matches how many TARGET_FPS would expect for
 * the real elapsed time — the output plays at exactly the rate it was
 * declared to ffmpeg, at the cost of some visibly repeated frames during
 * whatever periods capturePage() fell behind, rather than a silently
 * shortened, out-of-sync video.
 */
function padFramesToWallClock() {
  if (!session.lastGoodBitmap) return
  const expectedFrames = Math.round((Date.now() - session.startedAt) / FRAME_INTERVAL_MS)
  while (session.capturing && session.framesWritten < expectedFrames) {
    session.ffmpeg.stdin.write(session.lastGoodBitmap)
    session.framesWritten += 1
  }
}

function scheduleNextFrame(webContents, delay) {
  if (!session || !session.capturing) return
  session.frameTimer = setTimeout(() => captureLoopTick(webContents), Math.max(0, delay))
}

/**
 * The self-scheduling capture loop: only ever schedules its *next* run
 * after the current webContents.capturePage() call resolves, adjusting the
 * delay so the loop still targets TARGET_FPS overall rather than adding a
 * flat FRAME_INTERVAL_MS on top of however long capturePage() itself took
 * (a naive setInterval would drift and pile up backlogged calls the moment
 * a single capture takes longer than one frame interval, which
 * capturePage() routinely does on real hardware — see padFramesToWallClock
 * above for how the output's timeline still stays correct despite that).
 */
async function captureLoopTick(webContents) {
  if (!session || !session.capturing) return
  const tickStart = Date.now()
  try {
    if (!webContents.isDestroyed()) {
      const image = await webContents.capturePage()
      if (session && session.capturing) updateLastGoodFrame(image)
    }
  } catch (err) {
    console.error('[capture] frame grab failed:', err.message)
  }
  if (!session || !session.capturing) return
  padFramesToWallClock()
  if (!session || !session.capturing) return
  scheduleNextFrame(webContents, FRAME_INTERVAL_MS - (Date.now() - tickStart))
}

function spawnEncodeProcess({ width, height, bitrate, tempVideoPath }) {
  const ffmpeg = spawn(resolveFfmpegPath(), [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'bgra',
    '-s', `${width}x${height}`,
    '-r', String(TARGET_FPS),
    '-i', 'pipe:0',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-b:v', bitrate,
    tempVideoPath
  ])

  let stderr = ''
  ffmpeg.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })
  // Writing to stdin after ffmpeg has already exited (e.g. it crashed
  // mid-session) throws EPIPE — captureLoopTick already checks
  // session.capturing before every write, so this listener is just a
  // backstop against that race, not something that should crash the app.
  ffmpeg.stdin.on('error', () => {})

  const exitPromise = new Promise((resolve) => {
    ffmpeg.on('close', (code) => resolve(code))
  })

  return { process: ffmpeg, exitPromise, getStderr: () => stderr }
}

/**
 * Starts a new recording session: resolves this session's file paths,
 * captures one frame from the Play tab to learn its pixel dimensions (fixed
 * for the rest of the session, see updateLastGoodFrame above), spawns ffmpeg to
 * encode raw frames into an h264/mp4 file, and begins the self-scheduling
 * capture loop. Idempotent while a session is already open, the same
 * backstop the old chunk-based startCaptureFile() had.
 */
export async function startRecording() {
  if (session) return { filePath: session.finalPath }

  const webContents = getPlayWebContents()
  if (!webContents || webContents.isDestroyed()) {
    throw new Error('The Play tab has not been opened yet — nothing to record.')
  }

  const { directory, quality } = getVideoCapturePrefs()
  fs.mkdirSync(directory, { recursive: true })
  const tempDir = path.join(directory, '.rifttrack-tmp')
  fs.mkdirSync(tempDir, { recursive: true })

  const base = `rifttrack-${localTimestampForFilename()}`
  const finalPath = path.join(directory, `${base}.mp4`)
  const tempVideoPath = path.join(tempDir, `${base}.video.mp4`)
  const tempAudioPath = path.join(tempDir, `${base}.audio.webm`)

  const firstFrame = await webContents.capturePage()
  const { width, height } = firstFrame.getSize()
  if (!width || !height) {
    throw new Error('Could not capture the Play tab — it has no visible size yet.')
  }

  const { process: ffmpeg, exitPromise, getStderr } = spawnEncodeProcess({
    width,
    height,
    bitrate: qualityToBitrate(quality),
    tempVideoPath
  })

  session = {
    finalPath,
    tempVideoPath,
    tempAudioPath,
    ffmpeg,
    ffmpegExit: exitPromise,
    getStderr,
    frameWidth: width,
    frameHeight: height,
    capturing: true,
    frameTimer: null,
    audioWriteStream: null,
    startedAt: Date.now(),
    lastGoodBitmap: null,
    // Frames actually written to ffmpeg's stdin (real captures plus
    // wall-clock padding — see padFramesToWallClock) vs. how many of those
    // came from a genuine capturePage() call. The gap between the two is
    // this session's real achieved capture rate, logged at stop time.
    framesWritten: 0,
    realFrameCount: 0,
    warnedFrameSizeMismatch: false
  }

  updateLastGoodFrame(firstFrame)
  padFramesToWallClock()
  scheduleNextFrame(webContents, FRAME_INTERVAL_MS)

  return { filePath: finalPath }
}

/**
 * Appends one chunk of the best-effort audio recording (sent from the
 * renderer as a Uint8Array from its own MediaRecorder, see lib/recording.js)
 * to a lazily-opened write stream. There's no separate "start audio" call —
 * whether the renderer's getUserMedia attempt even succeeds is only known
 * in the renderer itself, so this file simply never gets created if no
 * chunk ever arrives, and stopRecording() below correctly treats that as a
 * silent recording.
 */
export function appendAudioCaptureChunk(chunk) {
  if (!session) return
  if (!session.audioWriteStream) {
    session.audioWriteStream = fs.createWriteStream(session.tempAudioPath)
  }
  session.audioWriteStream.write(Buffer.from(chunk))
}

/**
 * Records the real wall-clock moment the renderer's audio MediaRecorder
 * actually began (see notifyAudioStarted() in lib/recording.js) — confirmed
 * by actually running this app that it lags video's own start by a
 * couple of seconds on Windows (the WGC-backed audio source needs a few
 * failed internal attempts before it can capture, the same kind of startup
 * delay already documented for Phase 1's whole-window video capture).
 * Without correcting for that gap, muxing the two temp files naively lines
 * up both streams' t=0 as if they'd started together, playing audio events
 * several seconds earlier than the video they actually belong to — see
 * stopRecording()'s -itsoffset use below, which is what actually corrects
 * for it.
 */
export function markAudioStarted() {
  if (!session || session.audioStartedAt) return
  session.audioStartedAt = Date.now()
}

/**
 * The file path this session will end up at once finalized, or null if no
 * recording is active. Used by replays.js to exclude an in-progress
 * recording from the unlinked/pending lists — the file doesn't actually
 * exist at this path until stopRecording() finishes muxing/renaming, but
 * that's fine: a nonexistent path can't show up in a directory scan anyway.
 */
export function getActiveCaptureFilePath() {
  return session ? session.finalPath : null
}

/**
 * `audioOffsetSeconds` shifts the audio input later by however long it lagged
 * behind video's own start (see markAudioStarted above) — without it, the
 * mux lines up both files' t=0 as if they began at the same real moment,
 * which they didn't.
 */
function muxAudioVideo(videoPath, audioPath, finalPath, audioOffsetSeconds) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(resolveFfmpegPath(), [
      '-y',
      '-i', videoPath,
      '-itsoffset', audioOffsetSeconds.toFixed(3),
      '-i', audioPath,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-shortest',
      finalPath
    ])
    let stderr = ''
    ffmpeg.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    ffmpeg.on('error', reject)
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg mux exited with code ${code}: ${stderr}`))
    })
  })
}

function cleanupTempFiles(current) {
  for (const filePath of [current.tempVideoPath, current.tempAudioPath]) {
    try {
      if (fs.existsSync(filePath)) fs.rmSync(filePath)
    } catch (err) {
      console.error('[capture] failed to clean up temp file', filePath, err)
    }
  }
}

/**
 * Stops the capture loop, closes ffmpeg's stdin, and waits for it to exit
 * cleanly (it needs to flush/finalize the mp4 container) before treating
 * the video as complete. If a best-effort audio file was also produced
 * (non-empty — see appendAudioCaptureChunk above), muxes it into the final
 * file as a post-process step; otherwise the encoded video is simply
 * renamed into place as-is — a silent video is a fully valid successful
 * recording, never blocked or delayed by the audio attempt.
 */
export async function stopRecording() {
  if (!session) return { filePath: null }
  const current = session
  session = null

  current.capturing = false
  if (current.frameTimer) {
    clearTimeout(current.frameTimer)
    current.frameTimer = null
  }

  const elapsedSeconds = (Date.now() - current.startedAt) / 1000
  const achievedFps = elapsedSeconds > 0 ? (current.realFrameCount / elapsedSeconds).toFixed(1) : '0'
  console.info(
    `[capture] session ended: ${current.realFrameCount} real frames over ${elapsedSeconds.toFixed(1)}s ` +
      `(~${achievedFps}fps achieved vs. ${TARGET_FPS}fps target), ${current.framesWritten} total frames written to ffmpeg`
  )

  await new Promise((resolve) => current.ffmpeg.stdin.end(resolve))
  const exitCode = await current.ffmpegExit
  if (exitCode !== 0) {
    console.error('[capture] ffmpeg video encode exited with code', exitCode, current.getStderr())
  }

  if (current.audioWriteStream) {
    await new Promise((resolve) => current.audioWriteStream.end(resolve))
  }

  const hasAudio = fs.existsSync(current.tempAudioPath) && fs.statSync(current.tempAudioPath).size > 0
  const hasVideo = fs.existsSync(current.tempVideoPath)

  try {
    if (hasVideo && hasAudio) {
      const audioOffsetSeconds = current.audioStartedAt
        ? Math.max(0, (current.audioStartedAt - current.startedAt) / 1000)
        : 0
      try {
        await muxAudioVideo(current.tempVideoPath, current.tempAudioPath, current.finalPath, audioOffsetSeconds)
      } catch (err) {
        console.error('[capture] audio mux failed, falling back to silent video:', err.message)
        fs.renameSync(current.tempVideoPath, current.finalPath)
      }
    } else if (hasVideo) {
      fs.renameSync(current.tempVideoPath, current.finalPath)
    } else {
      throw new Error('Recording produced no video output.')
    }
  } finally {
    cleanupTempFiles(current)
  }

  return { filePath: current.finalPath }
}
