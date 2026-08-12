import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import { app, BrowserWindow, dialog } from 'electron'
import Database from 'better-sqlite3'
import { closeDb, getDb, getDbPath } from './db.js'

// The set of tables (and, for `decks`, a spot-check of a few columns) that
// make a file recognizable as a RiftTrack database rather than an arbitrary
// SQLite file someone picked by mistake. Not a full schema diff — just
// enough to catch "this obviously isn't a RiftTrack backup" before it ever
// touches the live database.
const REQUIRED_TABLES = ['decks', 'matches', 'games', 'replays', 'deck_notes']
const REQUIRED_DECK_COLUMNS = ['id', 'name', 'decklist']

function focusedWindow() {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
}

/**
 * Snapshots the live database to `destinationPath` via better-sqlite3's
 * online backup API (safe against a live WAL-mode connection, unlike a raw
 * file copy), then strips the WAL flag back out of the *destination* file.
 *
 * The live database runs in WAL mode for write concurrency, and that mode
 * is recorded in the database file's own header — so a plain backup() copy
 * inherits it. A WAL-mode file spawns `-wal`/`-shm` sidecar files next to
 * itself the moment anything opens it, even read-only (e.g. our own import
 * validation, or a user just peeking at their backup folder), which is
 * confusing clutter next to what's supposed to be one portable file. A
 * static backup has no use for WAL's concurrency benefit anyway, so every
 * backup this app writes — manual export, the pre-import safety copy, and
 * scheduled auto-backups — goes through this one function to come out
 * clean.
 */
export async function writeCleanBackup(destinationPath) {
  await getDb().backup(destinationPath)

  const cleanup = new Database(destinationPath)
  cleanup.pragma('journal_mode = DELETE')
  cleanup.close()
}

/**
 * Opens a candidate backup file read-only and checks it actually looks like
 * a RiftTrack database before anything downstream is allowed to touch it.
 * Returns `{ valid: true, summary }` with row counts for the confirmation
 * dialog, or `{ valid: false, reason }` with a message safe to show the
 * user directly.
 */
function inspectBackupFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { valid: false, reason: 'That file no longer exists.' }
  }

  let db
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true })
  } catch {
    return { valid: false, reason: 'That file is not a valid SQLite database.' }
  }

  try {
    const tableNames = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
    )
    const missingTables = REQUIRED_TABLES.filter((name) => !tableNames.has(name))
    if (missingTables.length > 0) {
      return {
        valid: false,
        reason: `This file doesn't look like a RiftTrack backup (missing table${missingTables.length === 1 ? '' : 's'}: ${missingTables.join(', ')}).`
      }
    }

    const deckColumns = new Set(db.prepare("PRAGMA table_info('decks')").all().map((col) => col.name))
    const missingColumns = REQUIRED_DECK_COLUMNS.filter((name) => !deckColumns.has(name))
    if (missingColumns.length > 0) {
      return { valid: false, reason: "This file doesn't match RiftTrack's database format." }
    }

    const summary = {
      decks: db.prepare('SELECT COUNT(*) AS count FROM decks').get().count,
      matches: db.prepare('SELECT COUNT(*) AS count FROM matches').get().count,
      notes: db.prepare('SELECT COUNT(*) AS count FROM deck_notes').get().count
    }

    return { valid: true, summary }
  } catch {
    return { valid: false, reason: "This file doesn't match RiftTrack's database format." }
  } finally {
    db.close()
  }
}

/**
 * Shows a directory picker with the given dialog title. Only returns the
 * chosen path — saving it into preferences is a separate step the renderer
 * takes explicitly, the same split Import uses between picking/validating a
 * file and actually committing to it. Shared by the auto-backup folder
 * picker and the video-capture save-location picker below.
 */
async function chooseDirectory(title) {
  const { canceled, filePaths } = await dialog.showOpenDialog(focusedWindow(), {
    title,
    properties: ['openDirectory', 'createDirectory']
  })
  if (canceled || filePaths.length === 0) return { canceled: true }
  return { canceled: false, directory: filePaths[0] }
}

export function chooseAutoBackupDirectory() {
  return chooseDirectory('Choose Auto-Backup Folder')
}

export function chooseVideoCaptureDirectory() {
  return chooseDirectory('Choose Video Capture Save Location')
}

/**
 * Recursively sums file sizes under `directory` for the Settings screen's
 * "estimated disk usage" display. Returns `null` if the folder doesn't
 * exist yet (e.g. video capture's default folder before it's ever been
 * created) rather than throwing — an empty/missing replays folder is a
 * perfectly normal state, not an error.
 */
export function getFolderSizeBytes(directory) {
  if (!directory || !fs.existsSync(directory)) return null

  let total = 0
  const stack = [directory]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(entryPath)
      else if (entry.isFile()) total += fs.statSync(entryPath).size
    }
  }
  return total
}

/**
 * Shows a save dialog and writes a consistent snapshot of the live database
 * to the chosen path via better-sqlite3's online backup API — safe to use
 * on a live WAL-mode connection, unlike a raw file copy which could catch
 * pages mid-write. Returns `{ canceled: true }` or `{ canceled: false,
 * filePath }`.
 */
export async function exportBackup() {
  const defaultName = `rifttrack-backup-${new Date().toISOString().slice(0, 10)}.db`
  const { canceled, filePath } = await dialog.showSaveDialog(focusedWindow(), {
    title: 'Export RiftTrack Backup',
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: [{ name: 'RiftTrack Backup', extensions: ['db'] }]
  })
  if (canceled || !filePath) return { canceled: true }

  await writeCleanBackup(filePath)
  return { canceled: false, filePath }
}

/**
 * Shows an open dialog for picking a backup file to import, then validates
 * it immediately so the renderer has real row counts (and a pass/fail) to
 * show in the warning dialog before the user ever confirms anything
 * destructive.
 */
export async function pickImportFile() {
  const { canceled, filePaths } = await dialog.showOpenDialog(focusedWindow(), {
    title: 'Import RiftTrack Backup',
    properties: ['openFile'],
    filters: [
      { name: 'RiftTrack Backup', extensions: ['db'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  if (canceled || filePaths.length === 0) return { canceled: true }

  const filePath = filePaths[0]
  return { canceled: false, filePath, ...inspectBackupFile(filePath) }
}

/**
 * Replaces the live database file with the given backup, wholesale. Always
 * re-validates the file itself first (never trusts an earlier renderer-side
 * check), and always takes a safety snapshot of the *current* data into
 * userData/backups/ right before making any destructive change, so a bad
 * import — or an import the user regrets — has a recovery path. The live
 * connection is reopened against the new file (without demo-deck seeding —
 * see getDb() in db.js) before returning, so the renderer can reload
 * immediately without a real app restart.
 */
export async function importBackup(filePath) {
  const inspection = inspectBackupFile(filePath)
  if (!inspection.valid) return { success: false, reason: inspection.reason }

  const dbPath = getDbPath()
  const backupsDir = path.join(app.getPath('userData'), 'backups')
  fs.mkdirSync(backupsDir, { recursive: true })
  const safetyBackupPath = path.join(
    backupsDir,
    `pre-import-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.db`
  )

  try {
    await writeCleanBackup(safetyBackupPath)
  } catch (err) {
    return { success: false, reason: `Could not back up current data before importing: ${err.message}` }
  }

  try {
    closeDb()

    // WAL mode leaves -wal/-shm sidecar files next to the main one;
    // closeDb() checkpoints and truncates them, but any stale sidecars are
    // removed explicitly so the new file can't be combined with old WAL
    // data left over from before the import.
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = dbPath + suffix
      if (fs.existsSync(sidecar)) fs.rmSync(sidecar)
    }

    fs.copyFileSync(filePath, dbPath)
    getDb({ seed: false })

    return { success: true, safetyBackupPath }
  } catch (err) {
    // The live file may be mid-replace at this point — fall back to the
    // safety snapshot taken above so the app doesn't restart into a
    // half-written database.
    try {
      fs.copyFileSync(safetyBackupPath, dbPath)
    } catch {
      // Fall through — surface the original import error either way.
    }
    getDb({ seed: false })
    return { success: false, reason: `Import failed and was rolled back: ${err.message}` }
  }
}

/**
 * Deletes every deck (and, via ON DELETE CASCADE, every match/game/replay/
 * note attached to one) — the entire data set. Leaves the schema and the
 * live connection alone. Takes the same pre-action safety snapshot
 * `importBackup()` does, into the same `userData/backups/` folder, so a
 * reset the user regrets has the same recovery path a bad import does.
 */
export async function resetAllData() {
  const backupsDir = path.join(app.getPath('userData'), 'backups')
  fs.mkdirSync(backupsDir, { recursive: true })
  const safetyBackupPath = path.join(
    backupsDir,
    `pre-reset-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.db`
  )

  try {
    await writeCleanBackup(safetyBackupPath)
  } catch (err) {
    return { success: false, reason: `Could not back up current data before resetting: ${err.message}` }
  }

  getDb().prepare('DELETE FROM decks').run()
  return { success: true, safetyBackupPath }
}
