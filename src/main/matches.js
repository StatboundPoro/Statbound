import { getDb } from './db.js'

/**
 * Returns all matches, most recently played first. opponent_domains and
 * battlefields are stored as JSON strings in SQLite (both can hold more
 * than one value), so they're parsed back into arrays here before
 * crossing into IPC.
 */
export function listMatches() {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM matches ORDER BY played_at DESC').all()

  return rows.map((row) => ({
    ...row,
    opponent_domains: row.opponent_domains ? JSON.parse(row.opponent_domains) : [],
    battlefields: row.battlefields ? JSON.parse(row.battlefields) : []
  }))
}
