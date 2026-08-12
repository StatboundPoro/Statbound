import path from 'path'
import { randomUUID } from 'crypto'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { LEGEND_NAMES } from './data/legends.js'

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
  return path.join(app.getPath('userData'), 'rifttrack.db')
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
 * `seed: false` skips the empty-database demo-deck seed. Only settings.js
 * passes this, when reopening the connection right after an import or a
 * reset — both are deliberate "make the database look like exactly this"
 * actions, so a database that's genuinely empty afterward (an empty backup,
 * or a reset) must stay empty rather than silently growing a demo deck the
 * user never asked for.
 */
export function getDb({ seed = true } = {}) {
  if (db) return db

  db = openDatabase(getDbPath())
  syncLegends(db)
  if (seed) seedDemoDeckIfEmpty(db)

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

// Inserts one sample deck on a brand-new database so the Deck Library
// screen has something to show before deck creation is built. Safe to
// delete later — it's just a normal row.
function seedDemoDeckIfEmpty(db) {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM decks').get()
  if (count > 0) return

  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO decks (id, name, domain_1, domain_2, legend_name, decklist, created_at, updated_at)
     VALUES (@id, @name, @domain_1, @domain_2, @legend_name, @decklist, @created_at, @updated_at)`
  ).run({
    id: randomUUID(),
    name: 'Demo Deck (sample data)',
    domain_1: 'Fury',
    domain_2: 'Body',
    legend_name: 'Sample Legend',
    decklist: JSON.stringify({ runes: [], battlefields: [], main: [], sideboard: [] }),
    created_at: now,
    updated_at: now
  })
}
