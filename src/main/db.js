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
    opponent_legend TEXT,
    opponent_domains TEXT,
    result TEXT CHECK (result IN ('win', 'loss')),
    score TEXT,
    seat TEXT CHECK (seat IN ('1st', '2nd')),
    battlefields TEXT,
    played_at TEXT NOT NULL,
    notes TEXT,
    sync_status TEXT NOT NULL DEFAULT 'local_only'
  );

  CREATE TABLE IF NOT EXISTS replays (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    sync_status TEXT NOT NULL DEFAULT 'local_only'
  );

  CREATE INDEX IF NOT EXISTS idx_matches_deck_id ON matches(deck_id);
  CREATE INDEX IF NOT EXISTS idx_replays_match_id ON replays(match_id);
`

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
