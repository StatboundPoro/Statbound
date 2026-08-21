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
  return path.join(app.getPath('documents'), 'Statbound Backups')
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
  quality: 'medium', // 'low' | 'medium' | 'high' — mapped to ffmpeg's -b:v in src/main/capture.js
  autoDeleteUnlinked: false, // off by default — never delete anything unless explicitly opted in
  retentionHours: 24, // only consulted while autoDeleteUnlinked is true; 24 | 48 | 168 (1 week)
  // Off by default — see src/main/autoCapture.js for how this gates only the
  // IDLE -> RECORDING transition; the WebSocket listener that drives
  // auto-stop keeps running regardless of this setting.
  autoStartRecording: false
}

// Whether the user has ever completed or skipped the one-time welcome
// tour (see WelcomeTour.jsx). Same "installation setting, not TCG data"
// reasoning as everything else in this file — it must survive Import and
// Reset untouched, since neither of those should make a returning user
// see first-run onboarding again.
const DEFAULT_WELCOME_TOUR = {
  hasSeenWelcomeTour: false
}

// Which deck was last selected in the Play tab's deck picker (see
// PlayScreen.jsx) — remembered across restarts for convenience, same
// "setting about this installation" reasoning as everything else here.
// Unlike auto-backup/video-capture above, there's no default-resolution-
// on-first-read step: null (no deck selected) is already a valid,
// displayable value, not a placeholder standing in for something real.
const DEFAULT_PLAY = {
  lastSelectedPlayDeckId: null
}

// When the legends table was last successfully synced against the live
// Riftcodex API (see src/main/services/legendSync.js and db.js's
// syncLegendsFromRiftcodex()) -- an installation-level fact, so it lives
// here rather than in SQLite, same reasoning as everything else in this
// file. null means "never" (a fresh install, or every attempt so far has
// failed), which the throttle treats as due for a sync attempt right away.
const DEFAULT_LEGEND_SYNC = {
  lastLegendSyncAt: null
}

// When the app last checked GitHub Releases for a newer published version
// (see src/main/services/updateCheck.js) -- an installation-level fact, same
// "outside SQLite" reasoning as everything else in this file. null means
// "never" (a fresh install, or every attempt so far has failed), which the
// throttle treats as due for a check attempt right away.
const DEFAULT_UPDATE_CHECK = {
  lastUpdateCheckAt: null
}

// Deck Detail's decklist List/Grid view toggle (see DeckDetail.jsx and
// CLAUDE.md's Design Language entry) -- remembered across visits and
// restarts, same "setting about this installation, not TCG data" reasoning
// as everything else in this file.
const DEFAULT_DECK_DETAIL = {
  decklistViewMode: 'list' // 'list' | 'grid'
}

// Which Domain-pair accent theme is selected in Settings' Appearance
// section (see SettingsScreen.jsx, lib/domainThemes.js, and CLAUDE.md's
// Domain-Pair Theming entry) -- 'default' means no override at all (the
// app's original built-in accent), or one of the 15 generated combination
// ids (e.g. 'fury-calm'). Same "installation setting, not TCG data"
// reasoning as everything else in this file, so it survives Import/Reset
// untouched. No validation against the known id list happens here on
// purpose: an unrecognized value (a hand-edited file, a future removed
// combination) simply matches none of styles.css's DOMAIN-PAIR ACCENT
// THEMES rules and silently renders as Default -- there's no way for a
// bad value here to actually break anything, so there's nothing to guard
// against.
const DEFAULT_THEME = {
  selectedTheme: 'default'
}

// Exported so userDataMigration.js's legacy-path repointing can read and
// rewrite the same file directly, rather than going through the
// default-filling get*Prefs()/update*Prefs() helpers below (which would
// resolve a *new* default into any preference that isn't set at all, not
// just repoint one that's stale) — see migrateLegacyPreferencePaths() there.
export function readRaw() {
  try {
    const text = fs.readFileSync(preferencesPath(), 'utf-8')
    return JSON.parse(text)
  } catch {
    return {}
  }
}

export function writeRaw(data) {
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

/**
 * Returns whether the one-time welcome tour has already been seen
 * (completed or skipped — both count the same, see WelcomeTour.jsx).
 */
export function getHasSeenWelcomeTour() {
  const raw = readRaw()
  return { ...DEFAULT_WELCOME_TOUR, ...raw.welcomeTour }.hasSeenWelcomeTour
}

/**
 * Marks the welcome tour as seen so it never auto-shows again. Called once
 * the tour is completed ("Get Started") or skipped — both are treated as
 * "done," never as "ask again later." Replaying it from Settings does NOT
 * call this a second time; it's already true by then.
 */
export function markWelcomeTourSeen() {
  const raw = readRaw()
  const welcomeTour = { ...DEFAULT_WELCOME_TOUR, ...raw.welcomeTour, hasSeenWelcomeTour: true }
  writeRaw({ ...raw, welcomeTour })
  return welcomeTour
}

/**
 * Returns the current Play tab preferences (currently just
 * lastSelectedPlayDeckId). Read directly (synchronously, off the same JSON
 * file the renderer's selection writes to) by autoCapture.js at the exact
 * moment a new match session begins, so a session gets tagged with whatever
 * deck was selected right then — a snapshot, not a live reference; see
 * autoCapture.js's startSession() call sites for why that matters.
 */
export function getPlayPrefs() {
  const raw = readRaw()
  return { ...DEFAULT_PLAY, ...raw.play }
}

/**
 * Persists a Play tab preference change (currently just which deck is
 * selected, written on every change from PlayScreen.jsx's dropdown).
 */
export function updatePlayPrefs(patch) {
  const raw = readRaw()
  const play = { ...DEFAULT_PLAY, ...raw.play, ...patch }
  writeRaw({ ...raw, play })
  return play
}

/**
 * Returns the current legend-sync preferences (currently just
 * lastLegendSyncAt), filling in the default if unset.
 */
export function getLegendSyncPrefs() {
  const raw = readRaw()
  return { ...DEFAULT_LEGEND_SYNC, ...raw.legendSync }
}

/**
 * Persists a legend-sync preference change. Called only from db.js's
 * syncLegendsFromRiftcodex(), right after a live fetch actually succeeds --
 * a throttled skip or a failed fetch must never update this, or a
 * transient network failure would silently postpone the next real attempt
 * by a full throttle window.
 */
export function updateLegendSyncPrefs(patch) {
  const raw = readRaw()
  const legendSync = { ...DEFAULT_LEGEND_SYNC, ...raw.legendSync, ...patch }
  writeRaw({ ...raw, legendSync })
  return legendSync
}

/**
 * Returns the current update-check preferences (currently just
 * lastUpdateCheckAt), filling in the default if unset.
 */
export function getUpdateCheckPrefs() {
  const raw = readRaw()
  return { ...DEFAULT_UPDATE_CHECK, ...raw.updateCheck }
}

/**
 * Persists an update-check preference change. Called only from
 * updateCheck.js's checkForUpdateIfDue(), right after a GitHub Releases
 * fetch actually succeeds -- a throttled skip or a failed fetch must never
 * update this, matching getLegendSyncPrefs()/updateLegendSyncPrefs()'s
 * identical reasoning above (a transient failure should be retried on the
 * very next launch, not silently postponed a full day).
 */
export function updateUpdateCheckPrefs(patch) {
  const raw = readRaw()
  const updateCheck = { ...DEFAULT_UPDATE_CHECK, ...raw.updateCheck, ...patch }
  writeRaw({ ...raw, updateCheck })
  return updateCheck
}

/**
 * Returns the current Deck Detail preferences (currently just
 * decklistViewMode), filling in the default if unset.
 */
export function getDeckDetailPrefs() {
  const raw = readRaw()
  return { ...DEFAULT_DECK_DETAIL, ...raw.deckDetail }
}

/**
 * Persists a Deck Detail preference change -- currently only called with
 * the decklistViewMode the user last chose, from DeckDetail.jsx's own
 * List/Grid toggle.
 */
export function updateDeckDetailPrefs(patch) {
  const raw = readRaw()
  const deckDetail = { ...DEFAULT_DECK_DETAIL, ...raw.deckDetail, ...patch }
  writeRaw({ ...raw, deckDetail })
  return deckDetail
}

/**
 * Returns the current theme preference (currently just selectedTheme),
 * filling in the default ('default', meaning no accent override) if
 * unset. Read synchronously at window-creation time (see index.js) so the
 * selected theme can be baked into the renderer's initial process
 * arguments before its first paint, avoiding a visible flash of the
 * default accent before switching -- the same reason getPlayPrefs() below
 * is read directly rather than through an IPC round trip.
 */
export function getThemePrefs() {
  const raw = readRaw()
  return { ...DEFAULT_THEME, ...raw.theme }
}

/**
 * Persists a theme preference change -- currently only called with the
 * theme id the user just picked in Settings' Appearance section, which
 * has already applied it live in the renderer before this round trip
 * even returns.
 */
export function updateThemePrefs(patch) {
  const raw = readRaw()
  const theme = { ...DEFAULT_THEME, ...raw.theme, ...patch }
  writeRaw({ ...raw, theme })
  return theme
}
