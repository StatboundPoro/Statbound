import { randomUUID } from 'crypto'
import { getDb } from './db.js'

// The four decklist sections this feature tracks, and the mapping between
// this table's `section` enum value and the differently-named key the same
// section actually uses on a decklist object (decklist.main, not
// decklist.mainDeck -- see parseDecklist.js's SECTION_KEYS). Legend/
// Champion/deck-identity fields are deliberately not tracked here -- see
// CLAUDE.md's Deck Changelog entry for why.
const TRACKED_SECTIONS = [
  { section: 'mainDeck', key: 'main' },
  { section: 'battlefields', key: 'battlefields' },
  { section: 'runes', key: 'runes' },
  { section: 'sideboard', key: 'sideboard' }
]

/**
 * Diffs two decklist objects (the shape stored on decks.decklist -- each
 * tracked section an array of { count, name }) across all four tracked
 * sections and returns one entry per card that changed, in the shape
 * deck_changelog rows are inserted from. A pure function with no database
 * access, so it's testable against plain objects directly.
 *
 * There is no 'countChanged' concept -- every change is either 'added' or
 * 'removed', with `count` holding only the delta amount, never the full
 * before/after counts:
 * - A card present in `newDecklist` but not `oldDecklist` -> 'added',
 *   count = the full new count.
 * - A card present in `oldDecklist` but not `newDecklist` -> 'removed',
 *   count = the full old count.
 * - A card present in both with a higher new count -> 'added', count =
 *   just the increase (2 -> 3 records count: 1, not 3).
 * - A card present in both with a lower new count -> 'removed', count =
 *   just the decrease (3 -> 1 records count: 2, not 1).
 * - A card with no change at all -> no entry.
 */
export function diffDecklists(oldDecklist, newDecklist) {
  const changes = []

  for (const { section, key } of TRACKED_SECTIONS) {
    const oldCards = new Map((oldDecklist?.[key] ?? []).map((card) => [card.name, card.count]))
    const newCards = new Map((newDecklist?.[key] ?? []).map((card) => [card.name, card.count]))
    const cardNames = new Set([...oldCards.keys(), ...newCards.keys()])

    for (const cardName of cardNames) {
      const oldCount = oldCards.has(cardName) ? oldCards.get(cardName) : null
      const newCount = newCards.has(cardName) ? newCards.get(cardName) : null

      if (oldCount === null) {
        changes.push({ section, change_type: 'added', card_name: cardName, count: newCount })
      } else if (newCount === null) {
        changes.push({ section, change_type: 'removed', card_name: cardName, count: oldCount })
      } else if (newCount > oldCount) {
        changes.push({ section, change_type: 'added', card_name: cardName, count: newCount - oldCount })
      } else if (newCount < oldCount) {
        changes.push({ section, change_type: 'removed', card_name: cardName, count: oldCount - newCount })
      }
    }
  }

  return changes
}

/**
 * Records one edit's worth of changes as a new deck_changelog_versions row
 * (numbered sequentially per deck, starting at 1) plus one deck_changelog
 * row per entry in `changes` (the shape diffDecklists() returns), all
 * referencing that new version. Meant to be called from inside the same
 * db.transaction() that performs the deck's own UPDATE -- see decks.js's
 * updateDeck(). A no-op if `changes` is empty -- an edit that changed
 * nothing about the tracked sections doesn't consume a version number.
 */
export function recordDeckChangelogVersion(db, deckId, changes, createdAt) {
  if (changes.length === 0) return

  const { count: existingVersions } = db
    .prepare('SELECT COUNT(*) AS count FROM deck_changelog_versions WHERE deck_id = ?')
    .get(deckId)
  const versionId = randomUUID()

  db.prepare(
    `INSERT INTO deck_changelog_versions (id, deck_id, version_number, created_at)
     VALUES (@id, @deck_id, @version_number, @created_at)`
  ).run({ id: versionId, deck_id: deckId, version_number: existingVersions + 1, created_at: createdAt })

  const insertEntry = db.prepare(
    `INSERT INTO deck_changelog (id, changelog_version_id, section, change_type, card_name, count)
     VALUES (@id, @changelog_version_id, @section, @change_type, @card_name, @count)`
  )
  for (const change of changes) {
    insertEntry.run({ id: randomUUID(), changelog_version_id: versionId, ...change })
  }
}

/**
 * Returns a deck's full changelog history as a flat list of entries, each
 * carrying its parent version's version_id/version_number/created_at
 * alongside its own section/change_type/card_name/count. Ordered by
 * version_number DESC (most recent edit first), then added entries before
 * removed within a version, then by original diff order within each --
 * exactly the grouping/ordering DeckChangelogPanel.jsx needs, so the
 * renderer only has to bucket by version_id, never re-sort.
 */
export function listDeckChangelogByDeck(deckId) {
  const db = getDb()
  return db
    .prepare(
      `SELECT
         deck_changelog.id,
         deck_changelog.section,
         deck_changelog.change_type,
         deck_changelog.card_name,
         deck_changelog.count,
         deck_changelog_versions.id AS version_id,
         deck_changelog_versions.version_number,
         deck_changelog_versions.created_at
       FROM deck_changelog
       JOIN deck_changelog_versions ON deck_changelog_versions.id = deck_changelog.changelog_version_id
       WHERE deck_changelog_versions.deck_id = ?
       ORDER BY deck_changelog_versions.version_number DESC,
                CASE deck_changelog.change_type WHEN 'added' THEN 0 ELSE 1 END,
                deck_changelog.rowid ASC`
    )
    .all(deckId)
}
