import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { FALLBACK_LEGEND_NAMES } from './data/legendsFallback.js'
import { fetchLegendsFromRiftcodex, transformLegendName } from './services/legendSync.js'
import { getLegendSyncPrefs, updateLegendSyncPrefs } from './preferences.js'

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

  -- One row per deck edit that actually changed something, numbered
  -- sequentially per deck starting at 1 (see deckChangelog.js's
  -- recordDeckChangelogVersion(), called from decks.js's updateDeck()).
  -- deck_changelog (below) hangs its per-card entries off this table
  -- instead of storing its own created_at, so an edit's date and its
  -- version number can never drift apart -- they're the same row.
  CREATE TABLE IF NOT EXISTS deck_changelog_versions (
    id TEXT PRIMARY KEY,
    deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  -- Per-edit decklist diff, not a full snapshot history: one row per card
  -- that changed on a given deck edit, grouped under that edit's
  -- deck_changelog_versions row. Never written on initial import -- there's
  -- no prior state to diff against then. change_type is only
  -- 'added'/'removed' -- a quantity change collapses into whichever one
  -- matches the direction of the delta, with count holding just the
  -- delta amount (e.g. 2 -> 3 records as one 'added' row with count 1),
  -- never a separate "count changed" concept -- see deckChangelog.js's
  -- diffDecklists(). No sync_status: this is derived/computed history, not
  -- primary user-authored content, the same reasoning legends' own missing
  -- sync_status column follows (see CLAUDE.md's sync_status convention
  -- notes) -- a re-diff of the same two decklists would always reproduce
  -- identical rows, so there's nothing here a sync conflict could
  -- meaningfully apply to.
  CREATE TABLE IF NOT EXISTS deck_changelog (
    id TEXT PRIMARY KEY,
    changelog_version_id TEXT NOT NULL REFERENCES deck_changelog_versions(id) ON DELETE CASCADE,
    section TEXT NOT NULL CHECK (section IN ('mainDeck', 'battlefields', 'runes', 'sideboard')),
    change_type TEXT NOT NULL CHECK (change_type IN ('added', 'removed')),
    card_name TEXT NOT NULL,
    count INTEGER NOT NULL
  );

  -- Reference data (real Riftbound Legend names, kept current via a
  -- throttled sync against the Riftcodex API with a bundled offline
  -- fallback -- see services/legendSync.js and data/legendsFallback.js)
  -- surfaced as autocomplete suggestions on the free-text deck_notes.scope
  -- and matches.opponent_legend columns. No sync_status — this is shipped/
  -- fetched reference data, not user-generated content, so it isn't a sync
  -- candidate (see CLAUDE.md's sync_status convention).
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
  CREATE INDEX IF NOT EXISTS idx_deck_changelog_versions_deck_id ON deck_changelog_versions(deck_id);
  CREATE INDEX IF NOT EXISTS idx_deck_changelog_version_id ON deck_changelog(changelog_version_id);
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

// One-time schema fixup for the Deck Changelog feature's very first
// design (date-grouped, with a 'countChanged' change_type and its own
// created_at column) before it was revised, in the same development pass,
// into the version-numbered, added/removed-only shape SCHEMA now defines.
// That original shape never shipped in any real release -- this only
// matters for a dev/test database that happened to run the in-between
// code and picked up the old table shape. `CREATE TABLE IF NOT EXISTS`
// would otherwise silently leave an old-shape table in place and every
// later insert/read against the new column names would fail. Per the
// revision's own explicit decision not to carry old date-grouped entries
// forward (the same "no retroactive backfill" rule this feature already
// applies to its very first edit ever), the fix is to drop the old table
// outright rather than migrate its rows -- there is no
// deck_changelog_versions table for old rows to attach to anyway. Must run
// before SCHEMA's CREATE TABLE IF NOT EXISTS deck_changelog, so it's
// called first in openDatabase() below.
function migrateLegacyDeckChangelogSchema(instance) {
  const table = instance
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'deck_changelog'")
    .get()
  if (!table) return

  const columns = instance.prepare('PRAGMA table_info(deck_changelog)').all()
  const isOldShape = columns.some((col) => col.name === 'created_at')
  if (!isOldShape) return

  instance.exec('DROP TABLE deck_changelog')
  console.log('Dropped pre-version-numbering deck_changelog table (no real release ever shipped with that shape).')
}

function openDatabase(dbPath) {
  const instance = new Database(dbPath)
  instance.pragma('journal_mode = WAL')
  instance.pragma('foreign_keys = ON')

  migrateLegacyDeckChangelogSchema(instance)
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
  migrateLegacyHyphenLegendNames(db)
  seedFallbackLegendsIfEmpty(db)
  // Fire-and-forget: the fallback seed above already guarantees the table
  // isn't empty, so a slow or failed live sync can never block startup or
  // leave autocomplete without data. See syncLegendsFromRiftcodex() for the
  // throttling/error-handling contract.
  syncLegendsFromRiftcodex(db).catch((err) =>
    console.error('Unexpected error syncing legends from Riftcodex:', err)
  )
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

// Shared by both legend data sources below (the bundled fallback and a live
// Riftcodex fetch): inserts any of `names` not already present in the
// legends table, keyed on an exact (case-sensitive) match against `name`.
// Additive only, same as the old static-list version this replaced — rows
// are never removed, so a name missing from a later fetch doesn't
// retroactively delete anyone's existing matchup data referencing it.
function insertLegendNames(db, names) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO legends (id, name, created_at) VALUES (@id, @name, @created_at)'
  )
  const now = new Date().toISOString()

  const insertAll = db.transaction((list) => {
    for (const name of list) {
      insert.run({ id: randomUUID(), name, created_at: now })
    }
  })
  insertAll(names)
}

// One-time cleanup for rows left over from this table's very first version
// (commit 6212b29), which seeded a hand-maintained static list using
// Riftcodex's own hyphen separator ("Ahri - Nine-Tailed Fox") rather than
// this app's comma convention ("Ahri, Nine-Tailed Fox") that the fallback
// list and live Riftcodex sync have both used ever since (see
// legendsFallback.js and services/legendSync.js's transformLegendName()).
// Because insertLegendNames() has always been additive-only -- rows are
// never deleted, so a name dropped from a later source can't orphan
// existing matchup data referencing it -- any install that ran before that
// switch still has both the old hyphen-form row and the new comma-form row
// for the same Legend, doubling every autocomplete suggestion. Runs once on
// every startup (a cheap no-op once there's nothing left to migrate, the
// same pattern cleanupSeededDemoDeck() below already follows): for each
// surviving hyphen-form row, deletes it if a comma-form row for the same
// Legend already exists, or renames it in place to the comma form if one
// doesn't (e.g. Kennen -- see transformLegendName()'s own doc comment on
// why the live sync can never produce a comma-form row for that one), so
// no Legend is ever silently dropped rather than just de-duplicated.
function migrateLegacyHyphenLegendNames(db) {
  const rows = db.prepare('SELECT id, name FROM legends').all()
  const namesInUse = new Set(rows.map((r) => r.name))

  const deleteStmt = db.prepare('DELETE FROM legends WHERE id = ?')
  const renameStmt = db.prepare('UPDATE legends SET name = ? WHERE id = ?')

  const migrateAll = db.transaction(() => {
    for (const row of rows) {
      if (!row.name.includes(' - ')) continue
      const commaName = transformLegendName(row.name)
      if (!commaName || commaName === row.name) continue

      if (namesInUse.has(commaName)) {
        deleteStmt.run(row.id)
      } else {
        renameStmt.run(commaName, row.id)
        namesInUse.add(commaName)
      }
      namesInUse.delete(row.name)
    }
  })
  migrateAll()
}

function legendsTableIsEmpty(db) {
  return db.prepare('SELECT COUNT(*) AS count FROM legends').get().count === 0
}

// Synchronous floor, run on every startup before anything async: guarantees
// the legends table already has the bundled snapshot (see
// data/legendsFallback.js) the instant getDb() returns, so autocomplete
// works immediately -- offline, on a first-ever launch, or before the async
// Riftcodex sync below has had a chance to run. A no-op once the table has
// any rows at all, whether from a prior fallback seed or a prior live sync.
function seedFallbackLegendsIfEmpty(db) {
  if (legendsTableIsEmpty(db)) {
    insertLegendNames(db, FALLBACK_LEGEND_NAMES)
  }
}

const LEGEND_SYNC_THROTTLE_MS = 24 * 60 * 60 * 1000

// Throttled, best-effort refresh of the legends table from the live
// Riftcodex API (see services/legendSync.js) -- outbound-only, fetches
// nothing but public card data, and never blocks getDb() (see its call
// site above, which never awaits this). Skips the network call entirely if
// the last successful sync was under 24h ago, per preferences.json's
// lastLegendSyncAt. A network failure, a malformed response, or an empty
// result all leave the table exactly as it was (the fallback seed already
// guarantees it isn't empty) -- lastLegendSyncAt is only updated after a
// fetch actually succeeds, so a transient failure gets retried on the very
// next launch rather than being silently throttled for a full day.
async function syncLegendsFromRiftcodex(db) {
  const { lastLegendSyncAt } = getLegendSyncPrefs()
  if (lastLegendSyncAt && Date.now() - new Date(lastLegendSyncAt).getTime() < LEGEND_SYNC_THROTTLE_MS) {
    return
  }

  const names = await fetchLegendsFromRiftcodex()
  if (!names) return

  insertLegendNames(db, names)
  updateLegendSyncPrefs({ lastLegendSyncAt: new Date().toISOString() })
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
