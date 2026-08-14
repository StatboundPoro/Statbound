import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { getDb } from './db.js'
import { getVideoCapturePrefs } from './preferences.js'
import { getActiveCaptureFilePath } from './capture.js'
import { listUnrecordedSessions, removeUnrecordedSession } from './matchSessions.js'

// The only extension recording ever produces (see capture.js) — used to
// filter out anything else a user might drop into the same folder (a
// screenshot, a stray .db backup pointed at the wrong directory, etc.)
// when scanning for recordings. (mp4 as of the ffmpeg-based capture engine
// — Phase 1's desktopCapturer+MediaRecorder pipeline produced .webm.)
const VIDEO_EXTENSIONS = new Set(['.mp4'])

// Matches capture.js's own filename shape: rifttrack-YYYY-MM-DD_HH-mm-ss.mp4
const FILENAME_TIMESTAMP_PATTERN = /^rifttrack-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.mp4$/

/**
 * Recovers a recording's actual start time from its own filename (the
 * moment capture.js generated it), rather than trusting the file's
 * birthtime — birthtime can be unreliable across filesystems/copies, while
 * the filename is the definitive record of when this app started writing
 * it. Returns null for anything that doesn't match the pattern (e.g. a
 * non-RiftTrack .mp4 someone dropped in the folder), so callers can fall
 * back to filesystem metadata instead.
 */
function startedAtFromFileName(fileName) {
  const match = fileName.match(FILENAME_TIMESTAMP_PATTERN)
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match.map(Number)
  return new Date(year, month - 1, day, hour, minute, second).toISOString()
}

/** Same base filename as the video, `.json` extension — see capture.js's writeSidecar(). */
function sidecarPathFor(videoFilePath) {
  return videoFilePath.slice(0, -path.extname(videoFilePath).length) + '.json'
}

/**
 * Reads a recording's sidecar JSON (see capture.js's writeSidecar()) for
 * its captured gameInstanceId/deckId/startedAt, if any. A recording from
 * before this feature existed (or one whose sidecar was lost/corrupted)
 * has no sidecar at all — treated the same as one with a null deckId,
 * never an error; no retroactive sidecar generation happens for those.
 */
function readSidecar(videoFilePath) {
  try {
    const raw = fs.readFileSync(sidecarPathFor(videoFilePath), 'utf-8')
    const data = JSON.parse(raw)
    return {
      gameInstanceId: data.gameInstanceId ?? null,
      deckId: data.deckId ?? null,
      startedAt: data.startedAt ?? null
    }
  } catch {
    return { gameInstanceId: null, deckId: null, startedAt: null }
  }
}

/**
 * Every file_path currently linked to a match, as a Set for O(1)
 * membership checks. Shared by listUnlinkedReplays() (below) and
 * replayCleanup.js's poller, which must never delete a linked file
 * regardless of its age.
 */
export function listLinkedFilePaths() {
  const db = getDb()
  return new Set(db.prepare('SELECT file_path FROM replays').all().map((row) => row.file_path))
}

/**
 * Scans the configured Video Capture folder for recording files not yet
 * linked to any match, most recent first — backs LogMatchModal's Recording
 * section. Returns an empty array (not an error) if the folder doesn't
 * exist yet, the same "not created yet is a normal state" handling
 * settings.js's getFolderSizeBytes() already uses. Excludes whatever file
 * is currently being written to (if any) — a recording still in progress
 * is not yet a real candidate to link or discard.
 */
export function listUnlinkedReplays() {
  const { directory } = getVideoCapturePrefs()
  if (!directory || !fs.existsSync(directory)) return []

  const linked = listLinkedFilePaths()
  const activeFilePath = getActiveCaptureFilePath()

  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => {
      const filePath = path.join(directory, entry.name)
      const stat = fs.statSync(filePath)
      return {
        filePath,
        fileName: entry.name,
        createdAt: stat.birthtime.toISOString(),
        sizeBytes: stat.size
      }
    })
    .filter((file) => !linked.has(file.filePath) && file.filePath !== activeFilePath)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

/**
 * The unified "Log Recent Match" queue — backs the Sidebar badge + popover.
 * Merges two kinds of item, most-recent-first by `startedAt`:
 *
 *  - File-backed items (`hasRecording: true`): every unlinked recording,
 *    same as listUnlinkedReplays(), plus whatever its sidecar JSON knows
 *    (see readSidecar()) — `deckId`, and `startedAt` when the sidecar has
 *    one (falling back to the pre-sidecar derivation: the filename's own
 *    embedded timestamp, then file birthtime, for a recording made before
 *    this feature existed or one whose sidecar is missing/corrupt).
 *    `endedAt` is always the file's own mtime — the moment capture.js's
 *    write stream last touched it, i.e. when recording actually stopped —
 *    a sidecar has no endedAt of its own since it's written at *start*.
 *  - In-memory items (`hasRecording: false`): sessions that finished with
 *    no recording ever tied to them (see matchSessions.js), gone on
 *    restart if never logged or discarded — there's nothing on disk to
 *    persist them with.
 *
 * Every item carries a stable `id` for UI list keys (`filePath` for a
 * recording, `session:<gameInstanceId>` for an in-memory one, since the
 * latter has no file of its own).
 */
export function listPendingReplays() {
  const fileItems = listUnlinkedReplays().map((file) => {
    const stat = fs.statSync(file.filePath)
    const sidecar = readSidecar(file.filePath)
    return {
      id: file.filePath,
      hasRecording: true,
      filePath: file.filePath,
      fileName: file.fileName,
      sizeBytes: file.sizeBytes,
      deckId: sidecar.deckId,
      gameInstanceId: sidecar.gameInstanceId,
      startedAt: sidecar.startedAt ?? startedAtFromFileName(file.fileName) ?? file.createdAt,
      endedAt: stat.mtime.toISOString()
    }
  })

  const sessionItems = listUnrecordedSessions().map((session) => ({
    id: `session:${session.gameInstanceId}`,
    hasRecording: false,
    filePath: null,
    deckId: session.deckId,
    gameInstanceId: session.gameInstanceId,
    startedAt: session.startedAt,
    endedAt: session.endedAt
  }))

  return [...fileItems, ...sessionItems].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
}

/**
 * The "Log Recent Match" queue's "Discard" action for either item shape —
 * takes a full item as returned by listPendingReplays(), not just a bare
 * path, since what gets discarded differs by type. For `hasRecording:
 * true`, deletes the video file and its sidecar JSON (refusing anything
 * outside the configured Video Capture folder — defense in depth, the
 * same reasoning replayProtocol.js's path-containment check follows — or
 * the file currently being recorded to). For `hasRecording: false`, there's
 * no file at all — it just drops the entry from matchSessions.js's
 * in-memory queue. Also called (not just from a real Discard click) right
 * after a `hasRecording: false` item gets successfully logged into a
 * match, so a logged session doesn't linger in the queue looking unlogged
 * — see App.jsx's handleQueuedMatchSaved().
 */
export function discardPendingReplay(item) {
  if (!item) return { success: false, reason: 'No item specified.' }

  if (!item.hasRecording) {
    if (!item.gameInstanceId) return { success: false, reason: 'No session specified.' }
    removeUnrecordedSession(item.gameInstanceId)
    return { success: true }
  }

  const { directory } = getVideoCapturePrefs()
  const filePath = item.filePath
  if (!directory || !filePath) return { success: false, reason: 'No file specified.' }

  const resolvedDir = path.resolve(directory)
  const resolved = path.resolve(filePath)
  if (resolved !== resolvedDir && !resolved.startsWith(resolvedDir + path.sep)) {
    return { success: false, reason: 'That file is outside the Video Capture folder.' }
  }
  if (resolved === getActiveCaptureFilePath()) {
    return { success: false, reason: 'That recording is still in progress.' }
  }

  if (fs.existsSync(resolved)) fs.rmSync(resolved)

  const sidecarPath = sidecarPathFor(resolved)
  try {
    if (fs.existsSync(sidecarPath)) fs.rmSync(sidecarPath)
  } catch (err) {
    console.error('[replays] failed to delete sidecar', sidecarPath, err)
  }

  return { success: true }
}

/**
 * Links a recording file to a match — one `replays` row. Called right
 * after matches:create succeeds, if the user left a recording selected in
 * LogMatchModal; never called from the edit flow (linking only happens at
 * initial match creation, see LogMatchModal.jsx).
 */
export function createReplay({ match_id, file_path }) {
  if (!match_id || !file_path) {
    throw new Error('match_id and file_path are required.')
  }

  const db = getDb()
  const row = {
    id: randomUUID(),
    match_id,
    file_path,
    created_at: new Date().toISOString()
  }
  db.prepare(
    'INSERT INTO replays (id, match_id, file_path, created_at) VALUES (@id, @match_id, @file_path, @created_at)'
  ).run(row)

  return row
}

/**
 * The replay linked to a given match, or null — out of scope's "no
 * multiple replays linked to one match" means at most one row can exist
 * per match_id in practice, but this takes the most recent if that ever
 * changes rather than assuming uniqueness.
 */
export function getReplayByMatchId(matchId) {
  const db = getDb()
  return (
    db.prepare('SELECT * FROM replays WHERE match_id = ? ORDER BY created_at DESC LIMIT 1').get(matchId) ?? null
  )
}
