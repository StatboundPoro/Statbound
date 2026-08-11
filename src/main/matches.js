import { randomUUID } from 'crypto'
import { getDb } from './db.js'

function parseGameRow(row) {
  return {
    ...row,
    extra_battlefields: row.extra_battlefields ? JSON.parse(row.extra_battlefields) : []
  }
}

// A match's headline result/score is never stored — it's derived here from
// its games every time, so there's no duplicate copy that can drift out of
// sync with the games that actually happened. "Decided" games are wins or
// losses; an "incomplete" or not-yet-recorded game doesn't count either way.
function deriveMatchSummary(games) {
  const decided = games.filter((g) => g.result === 'win' || g.result === 'loss')
  const wins = decided.filter((g) => g.result === 'win').length
  const losses = decided.filter((g) => g.result === 'loss').length
  const result = wins === losses ? null : wins > losses ? 'win' : 'loss'

  return { result, score: `${wins}-${losses}` }
}

function attachGamesAndSummary(db, row) {
  const games = db
    .prepare('SELECT * FROM games WHERE match_id = ? ORDER BY game_number ASC')
    .all(row.id)
    .map(parseGameRow)
  const { result, score } = deriveMatchSummary(games)

  return {
    ...row,
    flags: row.flags ? JSON.parse(row.flags) : [],
    games,
    result,
    score
  }
}

/**
 * Returns all matches, most recently played first, each with its games
 * attached and a result/score derived from those games (see
 * deriveMatchSummary above).
 */
export function listMatches() {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM matches ORDER BY played_at DESC').all()

  return rows.map((row) => attachGamesAndSummary(db, row))
}

export function getMatchById(id) {
  const db = getDb()
  const row = db.prepare('SELECT * FROM matches WHERE id = ?').get(id)
  if (!row) return null

  return attachGamesAndSummary(db, row)
}

// Shared by createMatch and updateMatch — the Log Match form already
// enforces all of this before either is ever called, so it's a backstop
// against bad IPC input, not the primary UX.
function validateMatchInput({ deck_id, format, games }) {
  if (!deck_id) {
    throw new Error('deck_id is required.')
  }
  if (format !== 'Bo1' && format !== 'Bo3') {
    throw new Error('format must be "Bo1" or "Bo3".')
  }
  if (!Array.isArray(games) || games.length === 0) {
    throw new Error('At least one game is required.')
  }

  const decidedGames = games.filter((g) => g.result === 'win' || g.result === 'loss')
  if (decidedGames.length === 0) {
    throw new Error('At least one game must have a result before saving.')
  }

  const usedBattlefields = games.map((g) => g.my_battlefield).filter(Boolean)
  if (new Set(usedBattlefields).size !== usedBattlefields.length) {
    throw new Error('"My battlefield" can only be used once per match.')
  }
}

function insertGamesStatement(db) {
  return db.prepare(
    `INSERT INTO games (id, match_id, game_number, result, my_score, opponent_score, seat, my_battlefield, opponent_battlefield, extra_battlefields)
     VALUES (@id, @match_id, @game_number, @result, @my_score, @opponent_score, @seat, @my_battlefield, @opponent_battlefield, @extra_battlefields)`
  )
}

function gameInsertParams(matchId, game, index) {
  return {
    id: randomUUID(),
    match_id: matchId,
    game_number: game.game_number ?? index + 1,
    result: game.result ?? null,
    my_score: game.my_score ?? null,
    opponent_score: game.opponent_score ?? null,
    seat: game.seat ?? null,
    my_battlefield: game.my_battlefield ?? null,
    opponent_battlefield: game.opponent_battlefield ?? null,
    extra_battlefields: JSON.stringify(game.extra_battlefields ?? [])
  }
}

/**
 * Creates a match and its game rows together in one transaction. `games`
 * is an array of per-game field objects (see the `games` table shape);
 * each becomes one row.
 */
export function createMatch({
  deck_id,
  opponent_name,
  opponent_legend,
  format,
  flags,
  notes,
  played_at,
  games
} = {}) {
  validateMatchInput({ deck_id, format, games })

  const db = getDb()
  const now = new Date().toISOString()
  const matchId = randomUUID()

  const insertMatch = db.prepare(
    `INSERT INTO matches (id, deck_id, opponent_name, opponent_legend, format, flags, notes, played_at, created_at)
     VALUES (@id, @deck_id, @opponent_name, @opponent_legend, @format, @flags, @notes, @played_at, @created_at)`
  )
  const insertGame = insertGamesStatement(db)

  const run = db.transaction(() => {
    insertMatch.run({
      id: matchId,
      deck_id,
      opponent_name: opponent_name ?? null,
      opponent_legend: opponent_legend ?? null,
      format,
      flags: JSON.stringify(flags ?? []),
      notes: notes ?? null,
      played_at: played_at ?? now,
      created_at: now
    })

    games.forEach((game, index) => {
      insertGame.run(gameInsertParams(matchId, game, index))
    })
  })

  run()

  return getMatchById(matchId)
}

/**
 * Overwrites an existing match's fields and replaces its games wholesale
 * (delete-then-reinsert, same "full overwrite" approach updateDeck uses for
 * decklist edits) — simpler and safer than trying to diff/reconcile game
 * rows against a form that can freely add/remove/reorder games between Bo1
 * and Bo3. `played_at` is deliberately not editable here: this is the
 * user's original *entry*, not the actual game time, and letting an edit
 * silently move a match's position in match-history ordering would be a
 * confusing side effect of fixing an unrelated field like the score.
 * Returns null if no match with that id exists.
 */
export function updateMatch(
  id,
  { deck_id, opponent_name, opponent_legend, format, flags, notes, games } = {}
) {
  validateMatchInput({ deck_id, format, games })

  const db = getDb()
  const existing = db.prepare('SELECT id FROM matches WHERE id = ?').get(id)
  if (!existing) return null

  const updateMatchRow = db.prepare(
    `UPDATE matches
     SET deck_id = @deck_id, opponent_name = @opponent_name, opponent_legend = @opponent_legend,
         format = @format, flags = @flags, notes = @notes
     WHERE id = @id`
  )
  const deleteGames = db.prepare('DELETE FROM games WHERE match_id = ?')
  const insertGame = insertGamesStatement(db)

  const run = db.transaction(() => {
    updateMatchRow.run({
      id,
      deck_id,
      opponent_name: opponent_name ?? null,
      opponent_legend: opponent_legend ?? null,
      format,
      flags: JSON.stringify(flags ?? []),
      notes: notes ?? null
    })

    deleteGames.run(id)
    games.forEach((game, index) => {
      insertGame.run(gameInsertParams(id, game, index))
    })
  })

  run()

  return getMatchById(id)
}

/**
 * Deletes a match. `games.match_id` is ON DELETE CASCADE, so this also
 * removes every game logged under it. Returns true if a row was actually
 * deleted.
 */
export function deleteMatch(id) {
  const db = getDb()
  const { changes } = db.prepare('DELETE FROM matches WHERE id = ?').run(id)
  return changes > 0
}
