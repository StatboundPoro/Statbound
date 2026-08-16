import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { LEGEND_NAMES } from './data/legends.js'

// The live database's current filename. Was rifttrack.db until the
// RiftTrack -> Statbound internal rename — see migrateLegacyDbFilename()
// below for how an existing install's file gets renamed in place.
const DB_FILENAME = 'statbound.db'
const LEGACY_DB_FILENAME = 'rifttrack.db'

let db = null

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS decks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    domain_1 TEXT,
    domain_2 TEXT,
    legend_name TEXT,
    decklist TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    sync_status TEXT NOT NULL DEFAULT 'local_only'
  );

  -- Schema changes to matches/games must use a real migration (add
  -- column with default, copy/backfill data, etc.) — never drop and
  -- recreate. The one time that was done safely (see CLAUDE.md's
  -- "Migration note") relied on the table being guaranteed empty,
  -- which is no longer true once real match data exists.
  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    opponent_name TEXT,
    opponent_legend TEXT,
    format TEXT NOT NULL CHECK (format IN ('Bo1', 'Bo3')),
    flags TEXT NOT NULL DEFAULT '[]',
    notes TEXT,
    played_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    sync_status TEXT NOT NULL DEFAULT 'local_only'
  );

  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    game_number INTEGER NOT NULL CHECK (game_number IN (1, 2, 3)),
    result TEXT CHECK (result IN ('win', 'loss', 'incomplete')),
    my_score INTEGER,
    opponent_score INTEGER,
    seat TEXT CHECK (seat IN ('went_1st', 'went_2nd')),
    my_battlefield TEXT,
    opponent_battlefield TEXT,
    extra_battlefields TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS replays (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    sync_status TEXT NOT NULL DEFAULT 'local_only'
  );

  CREATE TABLE IF NOT EXISTS deck_notes (
    id TEXT PRIMARY KEY,
    deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    scope TEXT NOT NULL DEFAULT 'general',
    category TEXT NOT NULL CHECK (category IN ('general', 'mulligan', 'game_plan', 'battlefield', 'custom')),
    battlefield_name TEXT,
    custom_title TEXT,
    content TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    sync_status TEXT NOT NULL DEFAULT 'local_only'
  );

  -- Static reference data (real Riftbound Legend names, bundled in
  -- data/legends.js) surfaced as autocomplete suggestions on the free-text
  -- deck_notes.scope and matches.opponent_legend columns. No sync_status —
  -- this is shipped reference data, not user-generated content, so it isn't
  -- a sync candidate (see CLAUDE.md's sync_status convention).
  CREATE TABLE IF NOT EXISTS legends (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_matches_deck_id ON matches(deck_id);
  CREATE INDEX IF NOT EXISTS idx_games_match_id ON games(match_id);
  CREATE INDEX IF NOT EXISTS idx_replays_match_id ON replays(match_id);
  CREATE INDEX IF NOT EXISTS idx_deck_notes_deck_id ON deck_notes(deck_id);
  CREATE INDEX IF NOT EXISTS idx_legends_name ON legends(name);
`

/**
 * The on-disk path of the live database file — also used by settings.js to
 * back it up, replace it wholesale on import, or validate a candidate
 * import file's schema without disturbing the live connection.
 */
export function getDbPath() {
  return path.join(app.getPath('userData'), DB_FILENAME)
}

/**
 * One-time migration for existing installs: renames an existing
 * rifttrack.db (the database's original filename, from before the
 * RiftTrack -> Statbound internal rename) to statbound.db, in place, within
 * the already-current userData folder. Must be called before getDb() ever
 * opens a connection — see index.js's call site.
 *
 * A rename, not a copy, unlike userDataMigration.js's folder-level
 * migration: this moves a file within one already-migrated folder rather
 * than copying across a folder boundary, so there's no old copy left
 * behind as a safety net. WAL mode means an unclosed previous session can
 * leave `-wal`/`-shm` sidecar files next to the main one holding writes not
 * yet checkpointed in; renaming only the main file and leaving those under
 * their old name would orphan them; SQLite would then open the newly
 * renamed main file as if those pending writes never happened. Both
 * sidecars are renamed alongside the main file, if present, to avoid that.
 *
 * Idempotent: once rifttrack.db no longer exists (already renamed, or a
 * genuinely fresh install that only ever had statbound.db), this is a
 * no-op. Never throws — a failure here (e.g. a permissions error, or a
 * sidecar locked by another process) is logged and getDb() falls back to
 * its normal fresh-database creation under the new name, exactly like
 * userDataMigration.js's own failure handling.
 */
export function migrateLegacyDbFilename() {
  try {
    const userDataPath = app.getPath('userData')
    const oldPath = path.join(userDataPath, LEGACY_DB_FILENAME)
    const newPath = path.join(userDataPath, DB_FILENAME)
    if (!fs.existsSync(oldPath) || fs.existsSync(newPath)) return

    fs.renameSync(oldPath, newPath)
    for (const suffix of ['-wal', '-shm']) {
      const oldSidecar = oldPath + suffix
      if (fs.existsSync(oldSidecar)) fs.renameSync(oldSidecar, newPath + suffix)
    }
    console.log(`Renamed legacy database file "${LEGACY_DB_FILENAME}" to "${DB_FILENAME}".`)
  } catch (err) {
    console.error('Database filename migration failed; continuing with a fresh database:', err)
  }
}

function openDatabase(dbPath) {
  const instance = new Database(dbPath)
  instance.pragma('journal_mode = WAL')
  instance.pragma('foreign_keys = ON')

  instance.exec(SCHEMA)

  return instance
}

/**
 * Opens (or creates) the SQLite database file in Electron's per-user data
 * directory and ensures the schema exists. Safe to call multiple times —
 * the connection is cached after the first call.
 *
 * A fresh database starts with zero decks — first-run onboarding is
 * handled entirely by the renderer's empty state + welcome tour (see
 * DeckLibrary.jsx and WelcomeTour.jsx), not by seeding sample data. See
 * cleanupSeededDemoDeck() below for the one-time migration that removes
 * the sample deck earlier builds used to seed.
 */
export function getDb() {
  if (db) return db

  db = openDatabase(getDbPath())
  syncLegends(db)
  cleanupSeededDemoDeck(db)

  return db
}

/**
 * Closes the live connection and clears the cache so the next getDb() call
 * reopens it from disk. Used by settings.js to release the file (and let
 * WAL mode checkpoint its -wal/-shm sidecar files back into the main file)
 * before the underlying file is replaced by an import.
 */
export function closeDb() {
  if (!db) return
  db.pragma('wal_checkpoint(TRUNCATE)')
  db.close()
  db = null
}

// Inserts any LEGEND_NAMES not already present in the legends table, keyed
// on an exact (case-sensitive) match against `name`. Runs on every startup
// regardless of the `seed` option — unlike the demo deck, this is bundled
// reference data rather than user data, so it isn't part of the "does this
// database look freshly imported/reset" decision, and rows are only ever
// added here, never removed, so a name dropped from LEGEND_NAMES later
// doesn't retroactively delete anyone's existing matchup data referencing
// it.
function syncLegends(db) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO legends (id, name, created_at) VALUES (@id, @name, @created_at)'
  )
  const now = new Date().toISOString()

  const syncAll = db.transaction((names) => {
    for (const name of names) {
      insert.run({ id: randomUUID(), name, created_at: now })
    }
  })
  syncAll(LEGEND_NAMES)
}

// One-time cleanup migration. Earlier builds inserted one sample deck
// ("Demo Deck (sample data)" / legend_name "Sample Legend") into every
// brand-new database, back before deck creation existed, so the Deck
// Library screen had something to show. That seeding is gone (see
// getDb() above) — new databases now start with zero decks — but
// existing databases (including dev machines) may still have that row
// sitting around, so this removes it on startup if it's still exactly
// what was seeded: untouched, with nothing logged against it. If the
// user has since logged a real match against it, that's real data
// regardless of the deck's origin, so it's left completely alone rather
// than silently deleted — no deletion, no warning, just skipped. Cheap
// and idempotent (a no-op once the row is gone or was never seeded in
// the first place), so a plain startup check is enough — no separate
// "have I migrated" flag needed.
function cleanupSeededDemoDeck(db) {
  const demoDeck = db
    .prepare('SELECT id FROM decks WHERE name = ? AND legend_name = ?')
    .get('Demo Deck (sample data)', 'Sample Legend')
  if (!demoDeck) return

  const { count } = db
    .prepare('SELECT COUNT(*) AS count FROM matches WHERE deck_id = ?')
    .get(demoDeck.id)
  if (count > 0) return

  db.prepare('DELETE FROM decks WHERE id = ?').run(demoDeck.id)
}
