import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { getDb } from './db.js'
import { getVideoCapturePrefs } from './preferences.js'
import { getActiveCaptureFilePath } from './capture.js'

// The only extension recording ever produces (see capture.js) — used to
// filter out anything else a user might drop into the same folder (a
// screenshot, a stray .db backup pointed at the wrong directory, etc.)
// when scanning for recordings.
const VIDEO_EXTENSIONS = new Set(['.webm'])

// Matches capture.js's own filename shape: rifttrack-YYYY-MM-DD_HH-mm-ss.webm
const FILENAME_TIMESTAMP_PATTERN = /^rifttrack-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.webm$/

/**
 * Recovers a recording's actual start time from its own filename (the
 * moment capture.js generated it), rather than trusting the file's
 * birthtime — birthtime can be unreliable across filesystems/copies, while
 * the filename is the definitive record of when this app started writing
 * it. Returns null for anything that doesn't match the pattern (e.g. a
 * non-RiftTrack .webm someone dropped in the folder), so callers can fall
 * back to filesystem metadata instead.
 */
function startedAtFromFileName(fileName) {
  const match = fileName.match(FILENAME_TIMESTAMP_PATTERN)
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match.map(Number)
  return new Date(year, month - 1, day, hour, minute, second).toISOString()
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
 * Same list as listUnlinkedReplays(), with each entry's real session
 * bounds attached — backs the Pending Recordings queue (Sidebar badge +
 * popover). `startedAt` comes from the filename's own embedded timestamp
 * (falling back to birthtime for a file that doesn't match RiftTrack's
 * naming, e.g. dropped in manually) and `endedAt` from the file's mtime —
 * the moment capture.js's write stream last wrote to it, i.e. when
 * recording actually stopped. No new table: this is pure filesystem
 * metadata layered on top of the same unlinked-file scan.
 */
export function listPendingReplays() {
  return listUnlinkedReplays().map((file) => {
    const stat = fs.statSync(file.filePath)
    return {
      ...file,
      startedAt: startedAtFromFileName(file.fileName) ?? file.createdAt,
      endedAt: stat.mtime.toISOString()
    }
  })
}

/**
 * Deletes an unlinked recording file — the Pending Recordings queue's
 * "Discard" action. Refuses to delete anything outside the configured
 * Video Capture folder (defense in depth: filePath should always come
 * from our own listPendingReplays() results, but this never trusts renderer
 * input blindly, the same reasoning replayProtocol.js's path-containment
 * check follows) or the file currently being recorded to.
 */
export function discardPendingReplay(filePath) {
  const { directory } = getVideoCapturePrefs()
  if (!directory || !filePath) return { success: false, reason: 'No file specified.' }

  const resolvedDir = path.resolve(directory)
  const resolved = path.resolve(filePath)
  if (resolved !== resolvedDir && !resolved.startsWith(resolvedDir + path.sep)) {
    return { success: false, reason: 'That file is outside the Video Capture folder.' }
  }
  if (resolved === getActiveCaptureFilePath()) {
    return { success: false, reason: 'That recording is still in progress.' }
  }
  if (!fs.existsSync(resolved)) {
    return { success: true } // already gone — treat as a successful discard
  }

  fs.rmSync(resolved)
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
