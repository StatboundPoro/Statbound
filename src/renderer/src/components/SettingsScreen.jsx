import { useEffect, useState } from 'react'
import ConfirmDialog from './ConfirmDialog.jsx'
import { formatRelativeTime } from '../lib/stats.js'

const AUTO_BACKUP_INTERVALS = [
  { label: 'Hourly', hours: 1 },
  { label: 'Every 6 Hours', hours: 6 },
  { label: 'Daily', hours: 24 },
  { label: 'Weekly', hours: 168 }
]

const VIDEO_QUALITY_PRESETS = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' }
]

const RETENTION_OPTIONS = [
  { label: '24 Hours', hours: 24 },
  { label: '48 Hours', hours: 48 },
  { label: '1 Week', hours: 168 }
]

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = -1
  do {
    value /= 1024
    unitIndex++
  } while (value >= 1024 && unitIndex < units.length - 1)
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

function importWarningMessage(summary) {
  const counts = `${summary.decks} deck${summary.decks === 1 ? '' : 's'}, ${summary.matches} match${
    summary.matches === 1 ? '' : 'es'
  }, and ${summary.notes} note${summary.notes === 1 ? '' : 's'}`

  return (
    `Importing will COMPLETELY REPLACE all decks, matches, and notes currently in RiftTrack with the ` +
    `contents of this backup file (${counts}). Every deck, match, and note you have now — anything not ` +
    `in this backup — will be permanently deleted. This cannot be undone from inside the app, and your ` +
    `current data will be unrecoverable unless you've exported it separately first.`
  )
}

// Settings has four sections. General holds Export/Import plus a read-only
// display of where the database file lives; Automatic Backups holds the
// scheduled background-backup toggle; Video Capture holds replay-recording
// preferences (save location, quality preset, and unlinked-recording
// cleanup — the actual recording control lives on the Play tab, see
// PlayScreen.jsx); Danger Zone holds Reset All Data, visually separated
// (border/background tint, red title) so it doesn't read as a routine
// action next to them.
export default function SettingsScreen() {
  const [exportStatus, setExportStatus] = useState(null) // { filePath } | { error }
  const [importError, setImportError] = useState(null)
  const [importCandidate, setImportCandidate] = useState(null) // { filePath, summary }
  const [importing, setImporting] = useState(false)
  const [importActionError, setImportActionError] = useState(null)
  const [importSuccess, setImportSuccess] = useState(null) // { safetyBackupPath }

  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState(null)
  const [resetSuccess, setResetSuccess] = useState(null) // { safetyBackupPath }

  const [appDataPath, setAppDataPath] = useState(null)
  const [appDataFolderError, setAppDataFolderError] = useState(null)

  const [autoBackup, setAutoBackup] = useState(null)
  const [autoBackupError, setAutoBackupError] = useState(null)

  const [videoCapture, setVideoCapture] = useState(null)
  const [videoCaptureError, setVideoCaptureError] = useState(null)
  const [replaysFolderSize, setReplaysFolderSize] = useState(null) // bytes | null

  useEffect(() => {
    window.api.settings
      .getAppDataPath()
      .then(setAppDataPath)
      .catch((err) => console.error('Failed to load app data path:', err))
  }, [])

  useEffect(() => {
    window.api.settings
      .getAutoBackup()
      .then(setAutoBackup)
      .catch((err) => console.error('Failed to load auto-backup settings:', err))
  }, [])

  useEffect(() => {
    window.api.settings
      .getVideoCapture()
      .then(setVideoCapture)
      .catch((err) => console.error('Failed to load video capture settings:', err))
  }, [])

  // Re-checked whenever the save location changes, not just once on mount —
  // choosing a new folder should immediately reflect that folder's own
  // usage rather than the previous one's.
  useEffect(() => {
    if (!videoCapture?.directory) return
    window.api.settings
      .getFolderSize(videoCapture.directory)
      .then(setReplaysFolderSize)
      .catch((err) => console.error('Failed to read replays folder size:', err))
  }, [videoCapture?.directory])

  async function updateAutoBackup(patch) {
    setAutoBackupError(null)
    try {
      setAutoBackup(await window.api.settings.updateAutoBackup(patch))
    } catch (err) {
      console.error('Failed to update auto-backup settings:', err)
      setAutoBackupError('Could not save that change.')
    }
  }

  async function handleChooseAutoBackupDirectory() {
    setAutoBackupError(null)
    try {
      const result = await window.api.settings.chooseAutoBackupDirectory()
      if (result.canceled) return
      await updateAutoBackup({ directory: result.directory })
    } catch (err) {
      console.error('Failed to open the folder picker:', err)
      setAutoBackupError('Could not open the folder picker.')
    }
  }

  async function updateVideoCapture(patch) {
    setVideoCaptureError(null)
    try {
      setVideoCapture(await window.api.settings.updateVideoCapture(patch))
    } catch (err) {
      console.error('Failed to update video capture settings:', err)
      setVideoCaptureError('Could not save that change.')
    }
  }

  async function handleChooseVideoCaptureDirectory() {
    setVideoCaptureError(null)
    try {
      const result = await window.api.settings.chooseVideoCaptureDirectory()
      if (result.canceled) return
      await updateVideoCapture({ directory: result.directory })
    } catch (err) {
      console.error('Failed to open the folder picker:', err)
      setVideoCaptureError('Could not open the folder picker.')
    }
  }

  async function handleResetVideoCaptureDirectory() {
    setVideoCaptureError(null)
    try {
      setVideoCapture(await window.api.settings.resetVideoCaptureDirectory())
    } catch (err) {
      console.error('Failed to reset the save location:', err)
      setVideoCaptureError('Could not reset the save location.')
    }
  }

  // Shared by every "Open Folder" button except App Data Location's (which
  // points at a file, not a directory this app manages — see
  // handleOpenAppDataFolder below). `setError` lets each section surface a
  // failure through its own existing status line rather than adding a new
  // one per button.
  async function handleOpenFolder(directory, setError) {
    setError(null)
    try {
      const result = await window.api.settings.openFolder(directory)
      if (!result.success) setError(result.reason || 'Could not open the folder.')
    } catch (err) {
      console.error('Failed to open folder:', err)
      setError('Could not open the folder.')
    }
  }

  async function handleOpenAppDataFolder() {
    setAppDataFolderError(null)
    try {
      const result = await window.api.settings.openAppDataFolder()
      if (!result.success) setAppDataFolderError(result.reason || 'Could not open the folder.')
    } catch (err) {
      console.error('Failed to open app data folder:', err)
      setAppDataFolderError('Could not open the folder.')
    }
  }

  async function handleExport() {
    setExportStatus(null)
    try {
      const result = await window.api.settings.export()
      if (result.canceled) return
      setExportStatus({ filePath: result.filePath })
    } catch (err) {
      console.error('Export failed:', err)
      setExportStatus({ error: 'Could not export a backup. Check the main process console.' })
    }
  }

  async function handleImportClick() {
    setImportError(null)
    setExportStatus(null)
    let result
    try {
      result = await window.api.settings.pickImportFile()
    } catch (err) {
      console.error('Failed to open the import file picker:', err)
      setImportError('Could not open the file picker.')
      return
    }
    if (result.canceled) return
    if (!result.valid) {
      setImportError(result.reason || 'That file is not a valid RiftTrack backup.')
      return
    }
    setImportCandidate({ filePath: result.filePath, summary: result.summary })
  }

  async function handleConfirmImport() {
    setImporting(true)
    setImportActionError(null)
    try {
      const result = await window.api.settings.import(importCandidate.filePath)
      if (!result.success) {
        setImportActionError(result.reason || 'Import failed.')
        setImporting(false)
        return
      }
      setImportSuccess({ safetyBackupPath: result.safetyBackupPath })
      setTimeout(() => window.location.reload(), 1600)
    } catch (err) {
      console.error('Import failed:', err)
      setImportActionError('Import failed. Check the main process console.')
      setImporting(false)
    }
  }

  async function handleConfirmReset() {
    setResetting(true)
    setResetError(null)
    try {
      const result = await window.api.settings.reset()
      if (!result.success) {
        setResetError(result.reason || 'Reset failed.')
        setResetting(false)
        return
      }
      setResetSuccess({ safetyBackupPath: result.safetyBackupPath })
      setTimeout(() => window.location.reload(), 1600)
    } catch (err) {
      console.error('Reset failed:', err)
      setResetError('Reset failed. Check the main process console.')
      setResetting(false)
    }
  }

  return (
    <div className="main">
      <div className="topbar">
        <div>
          <h1>Settings</h1>
          <div className="sub">Local data lives only on this machine — nothing here syncs anywhere.</div>
        </div>
      </div>

      <div className="section-label">General</div>
      <div className="settings-panel">
        <div className="settings-row">
          <div>
            <div className="settings-row-title">Export Backup</div>
            <div className="settings-row-desc">
              Save every deck, match, and note to a single backup file you choose the location for.
            </div>
          </div>
          <div className="settings-row-actions">
            <button className="btn" onClick={handleExport}>
              Export
            </button>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-title">Import Backup</div>
            <div className="settings-row-desc">
              Load a previously exported backup file, replacing everything currently in RiftTrack.
            </div>
          </div>
          <div className="settings-row-actions">
            <button className="btn" onClick={handleImportClick}>
              Import
            </button>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-title">App Data Location</div>
            <div className="settings-row-desc">
              Where RiftTrack's database file lives on disk.
              {appDataPath && (
                <>
                  <br />
                  <span className="settings-path">{appDataPath}</span>
                </>
              )}
            </div>
          </div>
          <div className="settings-row-actions">
            <button className="btn" onClick={handleOpenAppDataFolder} disabled={!appDataPath}>
              Open Folder
            </button>
          </div>
        </div>
        {exportStatus && (
          <div className={`settings-status ${exportStatus.error ? 'error' : ''}`}>
            {exportStatus.error ?? (
              <>
                Backup saved to <span className="settings-path">{exportStatus.filePath}</span>
              </>
            )}
          </div>
        )}
        {importError && <div className="settings-status error">{importError}</div>}
        {appDataFolderError && <div className="settings-status error">{appDataFolderError}</div>}
      </div>

      <div className="section-label">Automatic Backups</div>
      <div className="settings-panel">
        <div className="settings-row">
          <div>
            <div className="settings-row-title">Enable Automatic Backups</div>
            <div className="settings-row-desc">
              Periodically save a backup file in the background, on top of running Export yourself.
            </div>
          </div>
          <div className="settings-row-actions">
            <label className="checkbox-pill">
              <input
                type="checkbox"
                checked={autoBackup?.enabled ?? false}
                disabled={!autoBackup}
                onChange={(e) => updateAutoBackup({ enabled: e.target.checked })}
              />
              Enabled
            </label>
          </div>
        </div>

        {autoBackup?.enabled && (
          <>
            <div className="settings-row">
              <div>
                <div className="settings-row-title">Backup Interval</div>
                <div className="settings-row-desc">How often a new automatic backup is saved.</div>
              </div>
              <div className="settings-row-actions">
                <div className="segmented">
                  {AUTO_BACKUP_INTERVALS.map((opt) => (
                    <button
                      key={opt.hours}
                      type="button"
                      className={`segmented-option ${autoBackup.intervalHours === opt.hours ? 'active' : ''}`}
                      onClick={() => updateAutoBackup({ intervalHours: opt.hours })}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="settings-row">
              <div>
                <div className="settings-row-title">Backup Folder</div>
                <div className="settings-row-desc">
                  <span className="settings-path">{autoBackup.directory}</span>
                </div>
              </div>
              <div className="settings-row-actions settings-button-group">
                <button className="btn" onClick={handleChooseAutoBackupDirectory}>
                  Choose Folder
                </button>
                <button
                  className="btn"
                  onClick={() => handleOpenFolder(autoBackup.directory, setAutoBackupError)}
                >
                  Open Folder
                </button>
              </div>
            </div>
          </>
        )}

        {autoBackup && (
          <div className="settings-status">
            {autoBackup.enabled
              ? `Last automatic backup: ${formatRelativeTime(autoBackup.lastBackupAt)}`
              : 'Automatic backups are currently off.'}
          </div>
        )}
        {autoBackupError && <div className="settings-status error">{autoBackupError}</div>}
      </div>

      <div className="section-label">Video Capture</div>
      <div className="settings-panel">
        <div className="settings-row">
          <div>
            <div className="settings-row-title">Save Location</div>
            <div className="settings-row-desc">
              Where replay recordings are written.
              {videoCapture && (
                <>
                  <br />
                  <span className="settings-path">{videoCapture.directory}</span>
                </>
              )}
            </div>
          </div>
          <div className="settings-row-actions settings-button-group">
            <button className="btn" onClick={handleChooseVideoCaptureDirectory} disabled={!videoCapture}>
              Choose Folder
            </button>
            <button
              className="btn"
              onClick={() => handleOpenFolder(videoCapture.directory, setVideoCaptureError)}
              disabled={!videoCapture}
            >
              Open Folder
            </button>
            <button className="btn" onClick={handleResetVideoCaptureDirectory} disabled={!videoCapture}>
              Reset to Default
            </button>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-title">Quality</div>
            <div className="settings-row-desc">
              Higher presets record at a higher bitrate — larger files, sharper video.
            </div>
          </div>
          <div className="settings-row-actions">
            <div className="segmented">
              {VIDEO_QUALITY_PRESETS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`segmented-option ${videoCapture?.quality === opt.value ? 'active' : ''}`}
                  disabled={!videoCapture}
                  onClick={() => updateVideoCapture({ quality: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-title">Automatically Delete Unlinked Recordings</div>
            <div className="settings-row-desc">
              Recordings never linked to a match are cleaned up automatically after the retention window
              below. Off by default — recordings are kept forever unless you turn this on. A recording
              linked to a match is never deleted, regardless of age.
            </div>
          </div>
          <div className="settings-row-actions">
            <label className="checkbox-pill">
              <input
                type="checkbox"
                checked={videoCapture?.autoDeleteUnlinked ?? false}
                disabled={!videoCapture}
                onChange={(e) => updateVideoCapture({ autoDeleteUnlinked: e.target.checked })}
              />
              Enabled
            </label>
          </div>
        </div>
        {videoCapture?.autoDeleteUnlinked && (
          <div className="settings-row">
            <div>
              <div className="settings-row-title">Retention Window</div>
              <div className="settings-row-desc">How long an unlinked recording is kept before deletion.</div>
            </div>
            <div className="settings-row-actions">
              <div className="segmented">
                {RETENTION_OPTIONS.map((opt) => (
                  <button
                    key={opt.hours}
                    type="button"
                    className={`segmented-option ${videoCapture.retentionHours === opt.hours ? 'active' : ''}`}
                    onClick={() => updateVideoCapture({ retentionHours: opt.hours })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {videoCapture && (
          <div className="settings-status">
            {replaysFolderSize == null
              ? "The replays folder doesn't exist yet — nothing has been recorded."
              : `Estimated disk usage: ${formatBytes(replaysFolderSize)}`}
          </div>
        )}
        {videoCaptureError && <div className="settings-status error">{videoCaptureError}</div>}
      </div>

      <div className="section-label">Danger Zone</div>
      <div className="settings-panel settings-danger-zone">
        <div className="settings-row">
          <div>
            <div className="settings-row-title">Reset All Data</div>
            <div className="settings-row-desc">
              Permanently delete every deck, match, and note. There is no undo — export a backup first if
              you want a way back.
            </div>
          </div>
          <div className="settings-row-actions">
            <button className="btn btn-danger-outline" onClick={() => setResetConfirmOpen(true)}>
              Reset All Data
            </button>
          </div>
        </div>
      </div>

      {importCandidate && !importSuccess && (
        <ConfirmDialog
          title="Replace All Current Data?"
          message={importWarningMessage(importCandidate.summary)}
          confirmLabel="Replace All Data"
          danger
          requireText="REPLACE"
          busy={importing}
          error={importActionError}
          onConfirm={handleConfirmImport}
          onCancel={() => {
            setImportCandidate(null)
            setImportActionError(null)
          }}
        />
      )}

      {importSuccess && (
        <div className="modal-backdrop">
          <div className="modal modal-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Import Complete</h2>
            </div>
            <p className="confirm-message">
              Your data has been replaced with the imported backup. A safety copy of what was there before
              is saved at:
            </p>
            <p className="confirm-message">
              <span className="settings-path">{importSuccess.safetyBackupPath}</span>
            </p>
            <p className="confirm-message">Reloading RiftTrack…</p>
          </div>
        </div>
      )}

      {resetConfirmOpen && !resetSuccess && (
        <ConfirmDialog
          title="Reset All Data?"
          message="This permanently deletes every deck, match, and note in RiftTrack. A safety copy of your current data is saved automatically first, but export a backup yourself too if you want an easy way to bring it back."
          confirmLabel="Delete Everything"
          danger
          requireText="RESET"
          busy={resetting}
          error={resetError}
          onConfirm={handleConfirmReset}
          onCancel={() => {
            setResetConfirmOpen(false)
            setResetError(null)
          }}
        />
      )}

      {resetSuccess && (
        <div className="modal-backdrop">
          <div className="modal modal-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Data Reset</h2>
            </div>
            <p className="confirm-message">
              Every deck, match, and note has been deleted. A safety copy of what was there before is saved
              at:
            </p>
            <p className="confirm-message">
              <span className="settings-path">{resetSuccess.safetyBackupPath}</span>
            </p>
            <p className="confirm-message">Reloading RiftTrack…</p>
          </div>
        </div>
      )}
    </div>
  )
}
