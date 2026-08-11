import { randomUUID } from 'crypto'
import { getDb } from './db.js'

const CATEGORIES = ['general', 'mulligan', 'game_plan', 'battlefield', 'custom']

/**
 * Returns every note row for one deck, oldest first (so newly added notes
 * within a category appear after ones written earlier). `scope` is a plain
 * string column — `'general'` for the General set, or whatever opponent
 * legend name the user typed when adding a matchup. It's deliberately just
 * free text rather than a foreign key into a Legends table (none exists
 * yet), so swapping it for a picker later only changes what populates the
 * value, not the column itself — no migration needed.
 */
export function listDeckNotesByDeck(deckId) {
  const db = getDb()
  return db.prepare('SELECT * FROM deck_notes WHERE deck_id = ? ORDER BY created_at ASC').all(deckId)
}

/**
 * Creates one note. `battlefield_name` only makes sense for the
 * `battlefield` category and `custom_title` only for `custom` — both are
 * force-nulled here for any other category so a caller can't leave stale
 * values on a note whose category changed, even though nothing in the UI
 * currently changes a note's category after creation.
 */
export function createDeckNote({
  deck_id,
  scope,
  category,
  battlefield_name,
  custom_title,
  content
} = {}) {
  if (!deck_id) {
    throw new Error('deck_id is required.')
  }
  if (!CATEGORIES.includes(category)) {
    throw new Error(`category must be one of: ${CATEGORIES.join(', ')}.`)
  }

  const trimmedScope = typeof scope === 'string' ? scope.trim() : ''
  if (!trimmedScope) {
    throw new Error('scope is required.')
  }

  const trimmedBattlefieldName = typeof battlefield_name === 'string' ? battlefield_name.trim() : ''
  if (category === 'battlefield' && !trimmedBattlefieldName) {
    throw new Error('battlefield_name is required for battlefield notes.')
  }

  const db = getDb()
  const now = new Date().toISOString()
  const id = randomUUID()

  db.prepare(
    `INSERT INTO deck_notes (id, deck_id, scope, category, battlefield_name, custom_title, content, created_at, updated_at)
     VALUES (@id, @deck_id, @scope, @category, @battlefield_name, @custom_title, @content, @created_at, @updated_at)`
  ).run({
    id,
    deck_id,
    scope: trimmedScope,
    category,
    battlefield_name: category === 'battlefield' ? trimmedBattlefieldName : null,
    custom_title: category === 'custom' ? (custom_title?.trim() || null) : null,
    content: content ?? '',
    created_at: now,
    updated_at: now
  })

  return db.prepare('SELECT * FROM deck_notes WHERE id = ?').get(id)
}

/**
 * Updates a note's content (and, for custom notes, its title). Scope,
 * category, and battlefield_name are fixed at creation — there's no UI path
 * that moves a note between categories or matchups, so those columns are
 * left untouched here. Returns null if no note with that id exists.
 */
export function updateDeckNote(id, { content, custom_title } = {}) {
  const db = getDb()
  const existing = db.prepare('SELECT * FROM deck_notes WHERE id = ?').get(id)
  if (!existing) return null

  const now = new Date().toISOString()
  const nextCustomTitle = existing.category === 'custom' ? (custom_title?.trim() || null) : existing.custom_title

  db.prepare(
    `UPDATE deck_notes SET content = @content, custom_title = @custom_title, updated_at = @updated_at WHERE id = @id`
  ).run({
    id,
    content: content ?? '',
    custom_title: nextCustomTitle,
    updated_at: now
  })

  return db.prepare('SELECT * FROM deck_notes WHERE id = ?').get(id)
}

export function deleteDeckNote(id) {
  const db = getDb()
  const { changes } = db.prepare('DELETE FROM deck_notes WHERE id = ?').run(id)
  return changes > 0
}
