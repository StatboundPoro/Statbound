import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { app } from 'electron'
import ffmpegBinaryPath from 'ffmpeg-static'
import { getVideoCapturePrefs } from './preferences.js'
import { getPlayWebContents } from './playView.js'

// The frame-grab loop's target rate — see captureLoopTick() below for why
// this is a target, not a guarantee: webContents.capturePage() is async and
// variable-latency, so sustained 24fps depends on how fast this machine can
// actually produce frames.
const TARGET_FPS = 24
// Rounded to a whole millisecond purely for setTimeout's benefit when
// scheduling the next capture attempt — a bit of scheduling jitter here is
// harmless since captureLoopTick() re-measures real elapsed time every
// tick. padFramesToWallClock() below deliberately does NOT use this rounded
// value for its own frame-count math, since that rounding compounds into a
// real drift over a long recording — see its own comment.
const FRAME_INTERVAL_MS = Math.round(1000 / TARGET_FPS)

const BITRATE_BY_QUALITY = { low: '700k', medium: '1100k', high: '2500k' }
const DEFAULT_BITRATE = '1100k'

// Recordings are capped at 1080p tall regardless of the Play tab's actual
// on-screen size (which can run well past that on a large/high-res
// display) — keeps output files at a standard, disk-friendly resolution.
// This is purely an encode-time downscale (an ffmpeg -vf filter applied
// after capture, see spawnEncodeProcess below) — it doesn't touch
// webContents.capturePage() itself, which still reads back the Play tab at
// its full native size, so it has no effect on achieved capture fps.
const MAX_RECORDING_HEIGHT = 1080

/**
 * The size ffmpeg should encode to, given the Play tab's actual captured
 * size — capped to MAX_RECORDING_HEIGHT tall, aspect ratio preserved,
 * never upscaled if the source is already shorter than the cap. Width is
 * rounded to an even number, since libx264's default yuv420p output
 * requires even dimensions on both axes.
 */
function computeEncodeSize(width, height) {
  if (height <= MAX_RECORDING_HEIGHT) return { width, height }
  const scale = MAX_RECORDING_HEIGHT / height
  const scaledWidth = Math.round((width * scale) / 2) * 2
  return { width: scaledWidth, height: MAX_RECORDING_HEIGHT }
}

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
 * testing) — meaning the recording wouldn't actually cover the real length
 * of the match it was recording. Rather than accept that drift, this pads
 * the gap by writing duplicate copies of the last successfully captured
 * frame until the number of frames written matches how many TARGET_FPS
 * would expect for the real elapsed time — the output plays at exactly the
 * rate it was declared to ffmpeg, at the cost of some visibly repeated
 * frames during whatever periods capturePage() fell behind, rather than a
 * silently shortened video.
 *
 * Deliberately computed from the exact TARGET_FPS ratio here, not from
 * FRAME_INTERVAL_MS (which is rounded to a whole millisecond for setTimeout
 * scheduling — 42ms, vs. the true 41.667ms period of 24fps). Dividing
 * elapsed time by the rounded 42ms instead of the true 41.667ms undercounts
 * the expected frames by about 0.8%, which — since ffmpeg still declares
 * the output as exactly 24fps — made the encoded video's duration run
 * increasingly short of real elapsed time the longer a recording went (a
 * confirmed, several-second drift over a 10-minute recording). This
 * calculation has to use the exact ratio so the frame count actually
 * matches what 24fps-declared playback needs for the real wall-clock time
 * elapsed, with no accumulating bias.
 *
 * Stops early the moment a write reports backpressure (ffmpeg's stdin
 * buffer is full — its own encode can't keep up with how fast we're
 * handing it frames) rather than continuing to queue writes into Node's
 * internal buffer unbounded. Any catch-up still owed is simply picked up
 * on the next scheduled tick, ~FRAME_INTERVAL_MS later — this is a
 * last-resort safety valve for a saturated encode, not something expected
 * to trigger in normal operation, since capturePage() (not the encode) is
 * the actual bottleneck on real hardware.
 */
function padFramesToWallClock() {
  if (!session.lastGoodBitmap) return
  const expectedFrames = Math.round(((Date.now() - session.startedAt) * TARGET_FPS) / 1000)
  while (session.capturing && session.framesWritten < expectedFrames) {
    const canWriteMore = session.ffmpeg.stdin.write(session.lastGoodBitmap)
    session.framesWritten += 1
    if (!canWriteMore) break
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
  const encodeSize = computeEncodeSize(width, height)
  const args = [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'bgra',
    '-s', `${width}x${height}`,
    '-r', String(TARGET_FPS),
    '-i', 'pipe:0',
    '-c:v', 'libx264',
    // 'ultrafast' rather than 'veryfast' — the real fps ceiling on real
    // hardware is webContents.capturePage()'s own readback cost (see
    // captureLoopTick above), not this encode, but a lighter preset still
    // frees up CPU headroom this process was otherwise competing for,
    // which can only help the capture loop run as fast as it's able to.
    '-preset', 'ultrafast',
    '-b:v', bitrate
  ]
  // Only added when the source actually exceeds MAX_RECORDING_HEIGHT — a
  // no-op scale filter for a source already at or below the cap would just
  // be wasted encode work.
  if (encodeSize.width !== width || encodeSize.height !== height) {
    args.push('-vf', `scale=${encodeSize.width}:${encodeSize.height}`)
  }
  args.push(tempVideoPath)

  const ffmpeg = spawn(resolveFfmpegPath(), args)

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
    ffmpeg,
    ffmpegExit: exitPromise,
    getStderr,
    frameWidth: width,
    frameHeight: height,
    capturing: true,
    frameTimer: null,
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
 * The file path this session will end up at once finalized, or null if no
 * recording is active. Used by replays.js to exclude an in-progress
 * recording from the unlinked/pending lists — the file doesn't actually
 * exist at this path until stopRecording() finishes renaming the encoded video into place, but
 * that's fine: a nonexistent path can't show up in a directory scan anyway.
 */
export function getActiveCaptureFilePath() {
  return session ? session.finalPath : null
}

function cleanupTempFiles(current) {
  try {
    if (fs.existsSync(current.tempVideoPath)) fs.rmSync(current.tempVideoPath)
  } catch (err) {
    console.error('[capture] failed to clean up temp file', current.tempVideoPath, err)
  }
}

/**
 * Stops the capture loop, closes ffmpeg's stdin, and waits for it to exit
 * cleanly (it needs to flush/finalize the mp4 container) before renaming
 * the encoded video into place as the final file. Recordings are video-
 * only — no audio capture of any kind (see git history for the
 * getUserMedia-based best-effort audio path this used to have, removed
 * because it captured whole-system audio rather than just this app, with
 * no way to scope it narrower — see CLAUDE.md's Replay Recording entry).
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

  try {
    if (!fs.existsSync(current.tempVideoPath)) {
      throw new Error('Recording produced no video output.')
    }
    fs.renameSync(current.tempVideoPath, current.finalPath)
  } finally {
    cleanupTempFiles(current)
  }

  return { filePath: current.finalPath }
}
