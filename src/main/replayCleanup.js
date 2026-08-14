import fs from 'fs'
import path from 'path'
import { getVideoCapturePrefs } from './preferences.js'
import { listLinkedFilePaths } from './replays.js'

// Cleanup isn't time-critical the way a due backup is, so this polls on a
// longer cadence than autoBackup.js's 5-minute check — reusing the same
// "poll on a fixed interval rather than one setTimeout sized to the
// retention window" pattern it established, just less frequently.
const CHECK_INTERVAL_MS = 30 * 60 * 1000
// mp4 as of the ffmpeg-based capture engine — see replays.js's own
// VIDEO_EXTENSIONS for the same note.
const VIDEO_EXTENSIONS = new Set(['.mp4'])

function runCleanup() {
  const prefs = getVideoCapturePrefs()
  if (!prefs.autoDeleteUnlinked) return
  if (!prefs.directory || !fs.existsSync(prefs.directory)) return

  const linked = listLinkedFilePaths()
  const cutoff = Date.now() - prefs.retentionHours * 60 * 60 * 1000

  let entries
  try {
    entries = fs.readdirSync(prefs.directory, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isFile() || !VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue

    const filePath = path.join(prefs.directory, entry.name)
    // Linked files are never touched, regardless of age — this check comes
    // before the age check specifically so raising/lowering the retention
    // window can never put a linked replay at risk.
    if (linked.has(filePath)) continue

    let stat
    try {
      stat = fs.statSync(filePath)
    } catch {
      continue
    }
    if (stat.mtimeMs > cutoff) continue

    try {
      fs.rmSync(filePath)
    } catch (err) {
      console.error('[replay cleanup] failed to delete', filePath, err)
    }
  }
}

/**
 * Starts the unlinked-recording cleanup poller. Safe to call once at app
 * startup — checks immediately, then on CHECK_INTERVAL_MS for the app's
 * lifetime. A no-op on every check while the "Automatically delete
 * unlinked recordings" toggle is off (the default), which is re-read from
 * preferences on every tick rather than cached at startup.
 */
export function initReplayCleanup() {
  runCleanup()
  setInterval(runCleanup, CHECK_INTERVAL_MS)
}
