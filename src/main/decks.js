import { randomUUID } from 'crypto'
import { getDb } from './db.js'

/**
 * Returns all decks, most recently updated first. The decklist column is
 * stored as a JSON string in SQLite (it has no native structured type), so
 * it's parsed back into a real object/array here before crossing into IPC.
 */
export function listDecks() {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM decks ORDER BY updated_at DESC').all()

  return rows.map((row) => ({
    ...row,
    decklist: JSON.parse(row.decklist)
  }))
}

export function getDeckById(id) {
  const db = getDb()
  const row = db.prepare('SELECT * FROM decks WHERE id = ?').get(id)
  if (!row) return null

  return { ...row, decklist: JSON.parse(row.decklist) }
}

/**
 * Inserts a new deck, e.g. one just parsed from a pasted decklist. Only
 * `name` is required — everything else defaults to null/empty so this
 * stays usable for decks built other ways later.
 */
export function createDeck({ name, domain_1, domain_2, legend_name, decklist } = {}) {
  const trimmedName = typeof name === 'string' ? name.trim() : ''
  if (!trimmedName) {
    throw new Error('Deck name is required.')
  }

  const db = getDb()
  const now = new Date().toISOString()
  const id = randomUUID()

  db.prepare(
    `INSERT INTO decks (id, name, domain_1, domain_2, legend_name, decklist, created_at, updated_at)
     VALUES (@id, @name, @domain_1, @domain_2, @legend_name, @decklist, @created_at, @updated_at)`
  ).run({
    id,
    name: trimmedName,
    domain_1: domain_1 ?? null,
    domain_2: domain_2 ?? null,
    legend_name: legend_name ?? null,
    decklist: JSON.stringify(decklist ?? {}),
    created_at: now,
    updated_at: now
  })

  return getDeckById(id)
}

/**
 * Overwrites an existing deck's content in place — e.g. re-pasting a
 * revised decklist over the current one. `created_at` and `id` are left
 * untouched; everything else is replaced wholesale, same as createDeck.
 * Returns the updated deck, or null if no deck with that id exists.
 */
export function updateDeck(id, { name, domain_1, domain_2, legend_name, decklist } = {}) {
  const trimmedName = typeof name === 'string' ? name.trim() : ''
  if (!trimmedName) {
    throw new Error('Deck name is required.')
  }

  const db = getDb()
  const now = new Date().toISOString()

  const { changes } = db
    .prepare(
      `UPDATE decks
       SET name = @name, domain_1 = @domain_1, domain_2 = @domain_2,
           legend_name = @legend_name, decklist = @decklist, updated_at = @updated_at
       WHERE id = @id`
    )
    .run({
      id,
      name: trimmedName,
      domain_1: domain_1 ?? null,
      domain_2: domain_2 ?? null,
      legend_name: legend_name ?? null,
      decklist: JSON.stringify(decklist ?? {}),
      updated_at: now
    })

  if (changes === 0) return null
  return getDeckById(id)
}

/**
 * Deletes a deck. `matches.deck_id` and `replays.match_id` are both
 * declared ON DELETE CASCADE, so this also removes every match (and any
 * replay) logged against the deck — there's no separate cleanup step.
 * Returns true if a row was actually deleted.
 */
export function deleteDeck(id) {
  const db = getDb()
  const { changes } = db.prepare('DELETE FROM decks WHERE id = ?').run(id)
  return changes > 0
}
