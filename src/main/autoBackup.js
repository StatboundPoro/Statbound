import path from 'path'
import fs from 'fs'
import { writeCleanBackup } from './settings.js'
import { getAutoBackupPrefs, updateAutoBackupPrefs } from './preferences.js'

// How often to check whether a backup is due — not the backup interval
// itself. Polling on a short, fixed cadence (rather than one long
// setTimeout sized to the user's chosen interval) means a backup that was
// due while the app was closed just runs the moment it's next opened,
// instead of waiting a full extra interval.
const CHECK_INTERVAL_MS = 5 * 60 * 1000
const FILENAME_PREFIX = 'rifttrack-auto-backup-'

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function isDue(prefs) {
  if (!prefs.enabled) return false
  if (!prefs.lastBackupAt) return true
  const dueAt = new Date(prefs.lastBackupAt).getTime() + prefs.intervalHours * 60 * 60 * 1000
  return Date.now() >= dueAt
}

// Only ever deletes files this feature itself created (the
// rifttrack-auto-backup- prefix) — never touches a manual export or
// anything else the user keeps in the same folder, even if it's a stale
// .db file.
function pruneOldBackups(directory, retainCount) {
  let entries
  try {
    entries = fs
      .readdirSync(directory)
      .filter((name) => name.startsWith(FILENAME_PREFIX) && name.endsWith('.db'))
      .map((name) => {
        const fullPath = path.join(directory, name)
        return { fullPath, mtime: fs.statSync(fullPath).mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)
  } catch {
    return
  }

  for (const { fullPath } of entries.slice(retainCount)) {
    try {
      fs.rmSync(fullPath)
    } catch (err) {
      console.error('[auto backup] failed to prune', fullPath, err)
    }
  }
}

async function runAutoBackup(prefs) {
  fs.mkdirSync(prefs.directory, { recursive: true })
  const filePath = path.join(prefs.directory, `${FILENAME_PREFIX}${timestampForFilename()}.db`)

  await writeCleanBackup(filePath)
  updateAutoBackupPrefs({ lastBackupAt: new Date().toISOString() })
  pruneOldBackups(prefs.directory, prefs.retainCount)
}

function checkAndRunIfDue() {
  const prefs = getAutoBackupPrefs()
  if (!isDue(prefs)) return

  runAutoBackup(prefs).catch((err) => {
    console.error('[auto backup] failed:', err)
  })
}

/**
 * Starts the auto-backup scheduler. Safe to call once at app startup — it
 * checks immediately (so a backup missed while the app was closed happens
 * right away) and then polls every CHECK_INTERVAL_MS for the rest of the
 * app's lifetime.
 */
export function initAutoBackup() {
  checkAndRunIfDue()
  setInterval(checkAndRunIfDue, CHECK_INTERVAL_MS)
}
