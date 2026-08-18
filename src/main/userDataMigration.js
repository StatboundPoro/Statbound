import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import {
  readRaw,
  writeRaw,
  defaultAutoBackupDirectory,
  defaultVideoCaptureDirectory
} from './preferences.js'

// Electron derives the userData folder from the app's name/productName, so
// renaming the product from "RiftTrack" to "Statbound" (see package.json)
// moved that folder on disk — every existing install's database,
// preferences, and recordings are still sitting in the old one unless this
// runs. The old folder name is hardcoded here rather than derived from
// anything live, since app.getName() now returns "Statbound" and can no
// longer tell us where the old data lived. It's deliberately lowercase
// ("rifttrack", not "RiftTrack"): Electron never transforms a package.json
// `name` field's casing, and the pre-rename package.json had no
// `productName` at all — only `name: "rifttrack"`, all lowercase — so
// that's the literal folder Electron actually created for every install
// before this migration existed.
const OLD_USERDATA_FOLDER_NAME = 'rifttrack'

// db.js's current and legacy database filenames. Either one's presence in
// the new folder means this migration already ran (or a deliberate fresh
// start already created a real database under one name or the other) —
// checking both matters because db.js's own separate rifttrack.db ->
// statbound.db rename (see its migrateLegacyDbFilename(), which runs right
// after this migration in index.js) means a previously-migrated install's
// file here can be named either way depending on whether that second
// migration has run yet. Checking DB_FILENAME alone would make this
// function think a real database it just renamed away doesn't exist, and
// re-copy the entire legacy folder on top of live data on every subsequent
// launch.
const DB_FILENAME = 'statbound.db'
const LEGACY_DB_FILENAME = 'rifttrack.db'

function copyRecursive(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name)
    const destPath = path.join(destDir, entry.name)
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath)
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * One-time migration for existing installs: copies (never moves) every
 * file from the old RiftTrack-era userData folder into the new Statbound
 * one, but only the first time the new folder doesn't yet have a real
 * database in it. Must be called before db.js's getDb() is ever invoked,
 * so whatever gets copied here is what that first getDb() call actually
 * opens, rather than a freshly-created empty database.
 *
 * Copying rather than moving is deliberate and permanent: the old folder
 * is left fully intact afterward as an implicit safety net. Nothing in
 * this codebase ever deletes it.
 *
 * Idempotent: once the new folder has a real database in it, under either
 * filename (see the DB_FILENAME/LEGACY_DB_FILENAME comment above) — whether
 * from a previous run of this migration or a genuinely fresh start under
 * the new name — this is a no-op, so it never overwrites live Statbound
 * data with stale RiftTrack data on a second launch.
 *
 * Never throws. A failure here (e.g. a permissions error) is logged and
 * the app continues starting up normally against whatever's already in
 * the new folder, even if that means an empty database — this must never
 * block or crash startup.
 */
export function migrateLegacyUserData() {
  try {
    const oldPath = path.join(app.getPath('appData'), OLD_USERDATA_FOLDER_NAME)
    if (!fs.existsSync(oldPath)) return // fresh machine, nothing to migrate

    const newPath = app.getPath('userData')
    const newDbPath = path.join(newPath, DB_FILENAME)
    const legacyDbPath = path.join(newPath, LEGACY_DB_FILENAME)
    // already migrated (under either filename), or a deliberate fresh start under the new name
    if (fs.existsSync(newDbPath) || fs.existsSync(legacyDbPath)) return

    copyRecursive(oldPath, newPath)
    console.log(`Migrated userData from the legacy "${OLD_USERDATA_FOLDER_NAME}" folder to "${newPath}".`)
  } catch (err) {
    console.error('userData migration from the legacy RiftTrack folder failed; continuing with a fresh start:', err)
  }
}

// preferences.json is copied byte-for-byte by migrateLegacyUserData() above,
// so any *absolute path value* it already held before the rename still
// points at the old RiftTrack-era location afterward — copying the file
// doesn't rewrite its contents. These are the two old defaults a stored
// value might still be pointing at; comparing against them (rather than
// blindly overwriting whatever's stored) is what makes it safe to repoint
// only an untouched default and leave a genuinely customized path alone.
const OLD_VIDEO_CAPTURE_DEFAULT_SUFFIX = 'replays'
const OLD_AUTO_BACKUP_DEFAULT_FOLDER_NAME = 'RiftTrack Backups'

function samePath(a, b) {
  if (!a || !b) return false
  const resolvedA = path.resolve(a)
  const resolvedB = path.resolve(b)
  // Windows paths are case-insensitive; this migration only ever runs on a
  // Windows install (see the Windows Installer entry in CLAUDE.md), but the
  // check is written to degrade to a plain exact match elsewhere rather than
  // assume that.
  return process.platform === 'win32'
    ? resolvedA.toLowerCase() === resolvedB.toLowerCase()
    : resolvedA === resolvedB
}

/**
 * Pure helper (no filesystem/Electron access) that decides what, if
 * anything, should change in a preferences.json payload — split out from
 * migrateLegacyPreferencePaths() below purely so the two cases it handles
 * can be unit-tested directly against plain objects, without needing to
 * fake out Electron's `app` module.
 *
 * Returns `{ prefs, changed }`. `prefs` is a shallow copy of `raw` with
 * `videoCapture.directory`/`autoBackup.directory` repointed where
 * applicable; `changed` is false if neither case applied, so the caller
 * knows not to bother writing the file back out.
 */
export function computeLegacyPreferenceMigration(
  raw,
  { oldVideoCaptureDefault, newVideoCaptureDefault, oldAutoBackupDefault, newAutoBackupDefault, newAutoBackupDefaultExists }
) {
  const prefs = { ...raw }
  let changed = false

  // Case 1: Video Capture's save location was left at its old default
  // (inside the old userData folder). Both the old and new userData
  // folders already exist side by side post-migration (the old one is
  // copied, never deleted), so repointing this is safe — it only changes
  // where NEW recordings land going forward.
  if (raw.videoCapture && samePath(raw.videoCapture.directory, oldVideoCaptureDefault)) {
    prefs.videoCapture = { ...raw.videoCapture, directory: newVideoCaptureDefault }
    changed = true
  }

  // Case 2: Automatic Backups' folder was left at its old default. This is
  // narrower than Case 1 on purpose: it only repoints where FUTURE backups
  // get written. Any backup files already sitting in the old-named folder
  // are left exactly where they are, untouched, since they're real
  // user-visible files, not just an internal userData path.
  if (raw.autoBackup && samePath(raw.autoBackup.directory, oldAutoBackupDefault)) {
    if (newAutoBackupDefaultExists) {
      // A folder already exists at the new default location for some other
      // reason. Don't silently repoint future backups into it (and
      // definitely don't move/merge the old folder's files into it) —
      // leave the preference exactly as it was and let this get sorted out
      // deliberately instead of guessed at.
      console.warn(
        `Skipping auto-backup folder migration: "${newAutoBackupDefault}" already exists for an unrelated reason. Update the Automatic Backups folder in Settings manually if needed.`
      )
    } else {
      prefs.autoBackup = { ...raw.autoBackup, directory: newAutoBackupDefault }
      changed = true
    }
  }

  return { prefs, changed }
}

/**
 * Fixes up stale RiftTrack-era absolute paths left inside preferences.json
 * after migrateLegacyUserData() above copies it into the new Statbound
 * userData folder. Copying the file doesn't rewrite paths stored inside
 * it, so Video Capture's save location and Automatic Backups' folder can
 * both still point at pre-rename locations even though everything else
 * about the app now considers the new folder current. See
 * computeLegacyPreferenceMigration() above for the actual decision logic;
 * this just wires it up to the real filesystem/Electron paths.
 *
 * Must run after migrateLegacyUserData() (preferences.json has to already
 * be sitting in the new folder) and before normal app init reads any
 * preference that could still be stale. Idempotent: once a value matches
 * its new default, neither case matches again on a later launch, so this
 * is harmless to call on every startup. Never throws — a failure here is
 * logged and startup continues with whatever's already in the file.
 */
export function migrateLegacyPreferencePaths() {
  try {
    const raw = readRaw()

    const oldUserDataPath = path.join(app.getPath('appData'), OLD_USERDATA_FOLDER_NAME)
    const newAutoBackupDefault = defaultAutoBackupDirectory()

    const { prefs, changed } = computeLegacyPreferenceMigration(raw, {
      oldVideoCaptureDefault: path.join(oldUserDataPath, OLD_VIDEO_CAPTURE_DEFAULT_SUFFIX),
      newVideoCaptureDefault: defaultVideoCaptureDirectory(),
      oldAutoBackupDefault: path.join(app.getPath('documents'), OLD_AUTO_BACKUP_DEFAULT_FOLDER_NAME),
      newAutoBackupDefault,
      newAutoBackupDefaultExists: fs.existsSync(newAutoBackupDefault)
    })

    if (changed) writeRaw(prefs)
  } catch (err) {
    console.error('Legacy preference path migration failed; continuing with existing preference values:', err)
  }
}
