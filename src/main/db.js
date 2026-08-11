import path from 'path'
import { randomUUID } from 'crypto'
import { app } from 'electron'
import Database from 'better-sqlite3'

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

  CREATE INDEX IF NOT EXISTS idx_matches_deck_id ON matches(deck_id);
  CREATE INDEX IF NOT EXISTS idx_games_match_id ON games(match_id);
  CREATE INDEX IF NOT EXISTS idx_replays_match_id ON replays(match_id);
  CREATE INDEX IF NOT EXISTS idx_deck_notes_deck_id ON deck_notes(deck_id);
`

// The very first version of `matches` (opponent_legend/result/score/seat/
// battlefields as flat columns, no `format`) predates match logging having
// any create path at all — nothing could ever insert a row into it. So if
// a database still has that old shape, it's guaranteed empty and safe to
// drop; the schema below recreates it in the new Bo1/Bo3 + games shape.
function migrateLegacyMatchesTable(db) {
  const columns = db.prepare("PRAGMA table_info('matches')").all()
  if (columns.length === 0) return

  const hasCurrentSchema = columns.some((col) => col.name === 'format')
  if (hasCurrentSchema) return

  db.exec('DROP TABLE IF EXISTS matches')
}

/**
 * Opens (or creates) the SQLite database file in Electron's per-user data
 * directory and ensures the schema exists. Safe to call multiple times —
 * the connection is cached after the first call.
 */
export function getDb() {
  if (db) return db

  const dbPath = path.join(app.getPath('userData'), 'rifttrack.db')
  db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  migrateLegacyMatchesTable(db)
  db.exec(SCHEMA)

  seedDemoDeckIfEmpty(db)

  return db
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
