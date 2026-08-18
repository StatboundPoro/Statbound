import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { app } from 'electron'
import ffmpegBinaryPath from 'ffmpeg-static'
import { getPlayPrefs, getVideoCapturePrefs } from './preferences.js'
import { getPlayWebContents } from './playView.js'
import { getGameInstanceIdForNewRecording } from './autoCapture.js'
import { getSessionDeckId, getSessionStartedAt, markSessionRecording, addRecoveredSession } from './matchSessions.js'
import { consumeStashedResult } from './matchResultCapture.js'

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
 * Writes this recording's sidecar JSON — same base filename as the video,
 * `.json` extension, `{ gameInstanceId, deckId, startedAt }` — into the
 * real Video Capture directory (not the temp folder the video itself is
 * still encoding into). Called at the very start of startRecording(),
 * before the async first-frame capture even runs, specifically so a crash
 * partway through the recording still leaves this metadata on disk rather
 * than losing it along with everything held only in memory. `deckId`/
 * `gameInstanceId` may both be null (a manual recording with no currently-
 * tracked match session — see getGameInstanceIdForNewRecording()); a
 * missing/unparseable sidecar is handled the same way by replays.js
 * either way, so there's nothing to special-case here.
 */
function writeSidecar({ directory, base, gameInstanceId, deckId, startedAt }) {
  const sidecarPath = path.join(directory, `${base}.json`)
  try {
    fs.writeFileSync(sidecarPath, JSON.stringify({ gameInstanceId, deckId, startedAt }, null, 2))
  } catch (err) {
    console.error('[capture] failed to write recording sidecar', sidecarPath, err)
  }
}

/**
 * Merges match-result auto-fill data (see matchResultCapture.js) into a
 * recording's already-written sidecar, once it's known — which is never
 * before the match ends, well after writeSidecar() above already ran at
 * recording *start*. Called from stopRecording() with whatever
 * matchResultCapture.consumeStashedResult() had waiting for this session,
 * which may be null (a manual Stop pressed before the lobby-detection
 * trigger ever fired, so nothing was ever stashed) — in that case the
 * sidecar is left exactly as writeSidecar() wrote it, no different from a
 * recording made before this feature existed.
 */
function mergeMatchResultIntoSidecar(sidecarPath, matchResult) {
  try {
    const raw = fs.readFileSync(sidecarPath, 'utf-8')
    const data = JSON.parse(raw)
    data.matchResult = matchResult
    fs.writeFileSync(sidecarPath, JSON.stringify(data, null, 2))
  } catch (err) {
    console.error('[capture] failed to merge match result into recording sidecar', sidecarPath, err)
  }
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
/**
 * One-time startup cleanup: removes a leftover `.rifttrack-tmp` folder from
 * before the temp folder was renamed to `.statbound-tmp` (see startRecording()
 * below). Safe to delete outright rather than migrate — this folder only
 * ever holds a recording still mid-encode, so anything found here on
 * startup is scratch space from a session that never finished cleanly (e.g.
 * the app was killed mid-recording), not real data. A no-op if the video
 * capture folder doesn't exist yet or has no such leftover. Never throws —
 * logged and ignored on failure, the same as every other startup migration
 * in this codebase.
 */
export function cleanupLegacyTempDir() {
  try {
    const { directory } = getVideoCapturePrefs()
    if (!directory) return
    const legacyTempDir = path.join(directory, '.rifttrack-tmp')
    if (fs.existsSync(legacyTempDir)) {
      fs.rmSync(legacyTempDir, { recursive: true, force: true })
      console.log('Removed leftover legacy temp folder:', legacyTempDir)
    }
  } catch (err) {
    console.error('[capture] failed to clean up legacy .rifttrack-tmp folder:', err)
  }
}

/**
 * Attempts to salvage one orphaned temp video via a single ffmpeg remux
 * (`-c copy`, no re-encode) into a throwaway `.repaired.mp4` file alongside
 * it, then finalizes that repaired copy into place through the exact same
 * finalizeVideoIntoPlace() path a clean recording finish uses. Returns
 * false (never throws) for anything short of a genuinely playable
 * non-empty output — mp4's index data is frequently only written once
 * encoding finishes normally, so a file cut short by a crash is often, but
 * not always, unrecoverable this way. This is the single attempt: no
 * retry, no fallback re-encode.
 */
async function attemptRemux(brokenVideoPath, finalPath) {
  const repairedPath = brokenVideoPath.replace(/\.video\.mp4$/, '.repaired.mp4')
  removeIfExists(repairedPath)

  const ffmpeg = spawn(resolveFfmpegPath(), ['-y', '-i', brokenVideoPath, '-c', 'copy', repairedPath])
  let stderr = ''
  ffmpeg.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })
  const exitCode = await new Promise((resolve) => ffmpeg.on('close', resolve))

  const usable = exitCode === 0 && fs.existsSync(repairedPath) && fs.statSync(repairedPath).size > 0
  if (!usable) {
    if (exitCode !== 0) console.error('[capture] crash-recovery remux exited with code', exitCode, stderr)
    removeIfExists(repairedPath)
    return false
  }

  finalizeVideoIntoPlace(repairedPath, finalPath)
  return true
}

/**
 * Reads an orphaned recording's sidecar JSON (if any survived — see
 * writeSidecar(), which writes it straight into the real Video Capture
 * directory, not the temp folder, so it's untouched by the video itself
 * being lost) and, when one exists, feeds its deckId/gameInstanceId/
 * startedAt into matchSessions.js's existing non-recorded-session queue —
 * the same "Log Recent Match" entry type already used for a session that
 * finished with no recording ever tied to it. Marked recovered so the
 * queue can show it was pieced together after a crash rather than a
 * normal session. There's no real "match ended" signal for a crashed
 * session (the lobby-detection trigger never fired), so the broken temp
 * file's own last-modified time stands in as a best-effort endedAt
 * estimate. If no sidecar exists at all, there's nothing recoverable
 * beyond the video itself, so this is a silent no-op.
 */
function surfaceUnrecoverableSidecar(sidecarPath, estimatedEndedAt) {
  if (!fs.existsSync(sidecarPath)) return
  try {
    const raw = fs.readFileSync(sidecarPath, 'utf-8')
    const data = JSON.parse(raw)
    addRecoveredSession({
      gameInstanceId: data.gameInstanceId ?? null,
      deckId: data.deckId ?? null,
      startedAt: data.startedAt ?? estimatedEndedAt ?? new Date().toISOString(),
      endedAt: estimatedEndedAt ?? data.startedAt ?? new Date().toISOString()
    })
    fs.rmSync(sidecarPath)
  } catch (err) {
    console.error('[capture] failed to surface orphaned recording sidecar', sidecarPath, err)
  }
}

async function recoverOneOrphanedVideo(directory, tempDir, fileName) {
  const base = fileName.slice(0, -'.video.mp4'.length)
  const tempVideoPath = path.join(tempDir, fileName)
  const finalPath = path.join(directory, `${base}.mp4`)
  const sidecarPath = path.join(directory, `${base}.json`)

  console.warn('[capture] found orphaned recording from a previous session, attempting crash recovery:', tempVideoPath)

  let repaired = false
  try {
    repaired = await attemptRemux(tempVideoPath, finalPath)
  } catch (err) {
    console.error('[capture] crash-recovery repair attempt failed for', tempVideoPath, err)
  }

  if (repaired) {
    console.info('[capture] crash recovery succeeded, recording restored:', finalPath)
    removeIfExists(tempVideoPath)
    return
  }

  console.warn('[capture] crash recovery could not salvage the video, discarding broken file:', tempVideoPath)
  let brokenFileMtime = null
  try {
    brokenFileMtime = fs.statSync(tempVideoPath).mtime.toISOString()
  } catch {
    // File may already be gone somehow — estimatedEndedAt below just falls
    // back to the sidecar's own startedAt in that case.
  }
  removeIfExists(tempVideoPath)
  surfaceUnrecoverableSidecar(sidecarPath, brokenFileMtime)
}

/**
 * Startup crash recovery: scans .statbound-tmp for any video left behind
 * by a recording that never reached stopRecording()'s normal finish — the
 * only way a file ends up there is the app being force-killed or crashing
 * mid-recording, since a clean stop always moves it out via
 * finalizeVideoIntoPlace(). Must be called before a window exists or
 * autoCapture.js can detect any new session (see index.js's startup
 * sequence) — that ordering is what makes every file found here
 * unambiguous: this session hasn't started a recording yet, so anything
 * present can only be leftover from a previous run that never finished
 * cleanly. Every orphaned file gets exactly one best-effort repair attempt
 * (see attemptRemux()); on failure its sidecar (if any) still surfaces
 * into the "Log Recent Match" queue (see surfaceUnrecoverableSidecar()).
 * Wrapped so a failure anywhere in this scan never blocks app startup —
 * this is a best-effort safety net, not a critical path.
 */
export async function recoverOrphanedRecordings() {
  try {
    const { directory } = getVideoCapturePrefs()
    if (!directory) return
    const tempDir = path.join(directory, '.statbound-tmp')
    if (!fs.existsSync(tempDir)) return

    const orphanedVideos = fs
      .readdirSync(tempDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.video.mp4'))

    for (const entry of orphanedVideos) {
      await recoverOneOrphanedVideo(directory, tempDir, entry.name)
    }
  } catch (err) {
    console.error('[capture] crash recovery scan failed:', err)
  }
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
  const tempDir = path.join(directory, '.statbound-tmp')
  fs.mkdirSync(tempDir, { recursive: true })

  const base = `statbound-${localTimestampForFilename()}`
  const finalPath = path.join(directory, `${base}.mp4`)
  const tempVideoPath = path.join(tempDir, `${base}.video.mp4`)

  // Tie this recording to whatever match session (if any) is currently
  // known — see getGameInstanceIdForNewRecording()'s own comment for why
  // this already works for both an auto-started recording and a manual
  // Start claiming a session auto-start left unclaimed. Written to disk
  // immediately (see writeSidecar) rather than deferred to stopRecording(),
  // and matchSessions is told right away too, so a session that does end
  // up with a recording is never also pushed onto the non-recorded queue.
  const gameInstanceId = getGameInstanceIdForNewRecording()
  const deckId = gameInstanceId ? getSessionDeckId(gameInstanceId) : (getPlayPrefs().lastSelectedPlayDeckId ?? null)
  const startedAt = gameInstanceId ? (getSessionStartedAt(gameInstanceId) ?? new Date().toISOString()) : new Date().toISOString()
  writeSidecar({ directory, base, gameInstanceId, deckId, startedAt })
  if (gameInstanceId) markSessionRecording(gameInstanceId)

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
    // Remembered so stopRecording() can merge match-result auto-fill data
    // into this exact sidecar once the match ends (see
    // mergeMatchResultIntoSidecar above) — gameInstanceId may legitimately
    // be null (a manual recording with no tracked session), in which case
    // stopRecording() just skips that step entirely.
    gameInstanceId,
    sidecarPath: path.join(directory, `${base}.json`),
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

function removeIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.rmSync(filePath)
  } catch (err) {
    console.error('[capture] failed to remove file', filePath, err)
  }
}

/**
 * Moves a finished temp video into its real resting place in the Video
 * Capture directory, then cleans up the temp file regardless of outcome.
 * Shared by stopRecording() below (a normal clean finish) and
 * recoverOrphanedRecordings() further down (a crash-repaired file), so a
 * successfully recovered recording is finalized through the exact same
 * path as a normal one — not a second copy of this logic — and ends up
 * genuinely indistinguishable from one afterward.
 */
function finalizeVideoIntoPlace(tempVideoPath, finalPath) {
  try {
    if (!fs.existsSync(tempVideoPath)) {
      throw new Error('No video output to finalize.')
    }
    fs.renameSync(tempVideoPath, finalPath)
  } finally {
    removeIfExists(tempVideoPath)
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

  finalizeVideoIntoPlace(current.tempVideoPath, current.finalPath)

  if (current.gameInstanceId) {
    const matchResult = consumeStashedResult(current.gameInstanceId)
    if (matchResult) mergeMatchResultIntoSidecar(current.sidecarPath, matchResult)
  }

  return { filePath: current.finalPath }
}
