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
