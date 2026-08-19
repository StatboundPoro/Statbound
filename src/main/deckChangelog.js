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
 * - A card present in `oldDecklist` but not `newDecklist` -> 'removed'.
 * - A card present in `newDecklist` but not `oldDecklist` -> 'added'.
 * - A card present in both with a different count -> 'countChanged' (one
 *   entry per card, not a separate remove+add).
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
        changes.push({ section, change_type: 'added', card_name: cardName, old_count: null, new_count: newCount })
      } else if (newCount === null) {
        changes.push({ section, change_type: 'removed', card_name: cardName, old_count: oldCount, new_count: null })
      } else if (oldCount !== newCount) {
        changes.push({
          section,
          change_type: 'countChanged',
          card_name: cardName,
          old_count: oldCount,
          new_count: newCount
        })
      }
    }
  }

  return changes
}

/**
 * Inserts one deck_changelog row per entry in `changes` (the shape
 * diffDecklists() returns), all sharing one `createdAt` timestamp so they
 * group together as a single edit when displayed. Meant to be called from
 * inside the same db.transaction() that performs the deck's own UPDATE --
 * see decks.js's updateDeck(). A no-op if `changes` is empty.
 */
export function insertDeckChangelogEntries(db, deckId, changes, createdAt) {
  if (changes.length === 0) return

  const insert = db.prepare(
    `INSERT INTO deck_changelog (id, deck_id, created_at, section, change_type, card_name, old_count, new_count)
     VALUES (@id, @deck_id, @created_at, @section, @change_type, @card_name, @old_count, @new_count)`
  )

  for (const change of changes) {
    insert.run({
      id: randomUUID(),
      deck_id: deckId,
      created_at: createdAt,
      ...change
    })
  }
}

/**
 * Returns a deck's full changelog history, most recent edit first. Entries
 * from the same edit share one created_at and come back adjacent to each
 * other (insertion order within a timestamp follows TRACKED_SECTIONS'
 * order), which is what lets the renderer group them into one date/edit
 * block without needing a separate "batch id" column.
 */
export function listDeckChangelogByDeck(deckId) {
  const db = getDb()
  return db
    .prepare('SELECT * FROM deck_changelog WHERE deck_id = ? ORDER BY created_at DESC, rowid ASC')
    .all(deckId)
}
