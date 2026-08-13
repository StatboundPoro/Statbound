import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { getDb } from './db.js'
import { getVideoCapturePrefs } from './preferences.js'

// The only extension recording ever produces (see capture.js) — used to
// filter out anything else a user might drop into the same folder (a
// screenshot, a stray .db backup pointed at the wrong directory, etc.)
// when scanning for recordings.
const VIDEO_EXTENSIONS = new Set(['.webm'])

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
 * settings.js's getFolderSizeBytes() already uses.
 */
export function listUnlinkedReplays() {
  const { directory } = getVideoCapturePrefs()
  if (!directory || !fs.existsSync(directory)) return []

  const linked = listLinkedFilePaths()

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
    .filter((file) => !linked.has(file.filePath))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
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
