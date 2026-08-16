import fs from 'fs'
import path from 'path'
import { app } from 'electron'

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
