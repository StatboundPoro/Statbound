import path from 'path'
import fs from 'fs'
import { app } from 'electron'

// Local machine preferences (currently just the auto-backup schedule) live
// in their own plain JSON file, deliberately outside the SQLite database.
// The database is what Import/Reset replace or wipe wholesale — a backup
// schedule and folder path are a setting about *this installation*, not
// TCG data, and must survive both of those actions untouched (imagine
// importing a friend's backup and having it silently redirect your
// auto-backups to a folder that only exists on their machine).
function preferencesPath() {
  return path.join(app.getPath('userData'), 'preferences.json')
}

export function defaultAutoBackupDirectory() {
  return path.join(app.getPath('documents'), 'RiftTrack Backups')
}

// Same reasoning as the auto-backup directory above applies to where replay
// recordings get written: it's a setting about this installation, not TCG
// data, so it lives here rather than in the database and survives Import/
// Reset untouched.
export function defaultVideoCaptureDirectory() {
  return path.join(app.getPath('userData'), 'replays')
}

const DEFAULT_AUTO_BACKUP = {
  enabled: false,
  intervalHours: 24,
  directory: null, // resolved to defaultAutoBackupDirectory() on first read, then persisted
  lastBackupAt: null,
  retainCount: 10
}

const DEFAULT_VIDEO_CAPTURE = {
  directory: null, // resolved to defaultVideoCaptureDirectory() on first read, then persisted
  quality: 'medium', // 'low' | 'medium' | 'high' — mapped to MediaRecorder's videoBitsPerSecond in the renderer
  autoDeleteUnlinked: false, // off by default — never delete anything unless explicitly opted in
  retentionHours: 24, // only consulted while autoDeleteUnlinked is true; 24 | 48 | 168 (1 week)
  // Off by default — see src/main/autoCapture.js for how this gates only the
  // IDLE -> RECORDING transition; the WebSocket listener that drives
  // auto-stop keeps running regardless of this setting.
  autoStartRecording: false
}

function readRaw() {
  try {
    const text = fs.readFileSync(preferencesPath(), 'utf-8')
    return JSON.parse(text)
  } catch {
    return {}
  }
}

function writeRaw(data) {
  fs.mkdirSync(path.dirname(preferencesPath()), { recursive: true })
  fs.writeFileSync(preferencesPath(), JSON.stringify(data, null, 2))
}

/**
 * Returns the current auto-backup preferences, filling in defaults for
 * anything missing. `directory` is resolved to the default location (and
 * written back to disk) the first time it's read with no value set, so the
 * Settings screen always has a real, stable path to display rather than
 * "null" or having to know the default itself.
 */
export function getAutoBackupPrefs() {
  const raw = readRaw()
  const autoBackup = { ...DEFAULT_AUTO_BACKUP, ...raw.autoBackup }

  if (!autoBackup.directory) {
    autoBackup.directory = defaultAutoBackupDirectory()
    writeRaw({ ...raw, autoBackup })
  }

  return autoBackup
}

export function updateAutoBackupPrefs(patch) {
  const raw = readRaw()
  const autoBackup = { ...DEFAULT_AUTO_BACKUP, ...raw.autoBackup, ...patch }
  writeRaw({ ...raw, autoBackup })
  return autoBackup
}

/**
 * Returns the current video-capture preferences (save directory + quality
 * preset), filling in defaults for anything missing. `directory` is
 * resolved to the default location (and written back to disk) the first
 * time it's read with no value set, the same pattern `getAutoBackupPrefs()`
 * uses above.
 */
export function getVideoCapturePrefs() {
  const raw = readRaw()
  const videoCapture = { ...DEFAULT_VIDEO_CAPTURE, ...raw.videoCapture }

  if (!videoCapture.directory) {
    videoCapture.directory = defaultVideoCaptureDirectory()
    writeRaw({ ...raw, videoCapture })
  }

  return videoCapture
}

export function updateVideoCapturePrefs(patch) {
  const raw = readRaw()
  const videoCapture = { ...DEFAULT_VIDEO_CAPTURE, ...raw.videoCapture, ...patch }
  writeRaw({ ...raw, videoCapture })
  return videoCapture
}

/**
 * Points the video-capture save directory back at
 * `defaultVideoCaptureDirectory()`, for the Settings screen's "Reset to
 * Default" button next to its folder picker.
 */
export function resetVideoCaptureDirectory() {
  return updateVideoCapturePrefs({ directory: defaultVideoCaptureDirectory() })
}
