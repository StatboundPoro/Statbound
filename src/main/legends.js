import { getDb } from './db.js'

/**
 * Returns every legend as {id, name}, alphabetical. The renderer fetches
 * this once (via LegendAutocomplete) and filters client-side rather than
 * re-querying per keystroke — the list is tens of rows, not thousands.
 */
export function listLegends() {
  const db = getDb()
  return db.prepare('SELECT id, name FROM legends ORDER BY name ASC').all()
}
