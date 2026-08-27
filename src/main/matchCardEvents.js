import { randomUUID } from 'crypto'
import { getDb } from './db.js'

const VALID_EVENT_TYPES = new Set(['played', 'mulliganed', 'scored_on_battlefield'])

export function insertMatchCardEventsStatement(db) {
  return db.prepare(
    `INSERT INTO match_card_events (id, match_id, game_number, card_name, event_type, turn_number, created_at)
     VALUES (@id, @match_id, @game_number, @card_name, @event_type, @turn_number, @created_at)`
  )
}

/**
 * Builds one match_card_events insert row from a captured event
 * (matchResultCapture.js's own `{ gameNumber, cardName, eventType,
 * turnNumber }` shape — see its finalizeResult()). Returns null for
 * anything malformed (a bad gameNumber, an empty/non-string card name, an
 * unrecognized eventType) so createMatch() can skip it silently rather than
 * let one bad row fail the whole match save — the same "never fabricate,
 * degrade gracefully" rule match result auto-fill already follows for every
 * other field. `turnNumber` is optional (mulligan events never carry one —
 * see db.js's SCHEMA comment) and, if present, must be a positive integer or
 * it's silently dropped to null rather than rejecting the whole event over
 * one bad field.
 */
export function cardEventInsertParams(matchId, event) {
  const gameNumber = Number(event?.gameNumber)
  const cardName = typeof event?.cardName === 'string' ? event.cardName.trim() : ''
  const eventType = event?.eventType
  const turnNumberRaw = event?.turnNumber
  const turnNumber = Number.isInteger(turnNumberRaw) && turnNumberRaw >= 1 ? turnNumberRaw : null

  if (!Number.isInteger(gameNumber) || gameNumber < 1 || gameNumber > 3) return null
  if (!cardName) return null
  if (!VALID_EVENT_TYPES.has(eventType)) return null

  return {
    id: randomUUID(),
    match_id: matchId,
    game_number: gameNumber,
    card_name: cardName,
    event_type: eventType,
    turn_number: turnNumber,
    created_at: new Date().toISOString()
  }
}

/**
 * The single most-frequent card for one event type, across every match
 * with captured event data — optionally scoped to one deck (a plain
 * matches.deck_id join, the same scoping every other Insights aggregation
 * uses). Ties break alphabetically for a stable, deterministic result
 * rather than whichever row SQLite happens to return first. Returns null
 * when there's no event data at all for the current scope, whether
 * because no matches have been played with this feature's capture active
 * yet, or because capture failed for every one of them — the UI shows a
 * "not enough data yet" message for that case rather than a blank/zero
 * card, the same convention every other Insights empty state follows.
 */
function topCard(db, eventType, deckId) {
  const row = deckId
    ? db
        .prepare(
          `SELECT mce.card_name AS cardName, COUNT(*) AS count
           FROM match_card_events mce
           JOIN matches m ON m.id = mce.match_id
           WHERE mce.event_type = ? AND m.deck_id = ?
           GROUP BY mce.card_name
           ORDER BY count DESC, mce.card_name ASC
           LIMIT 1`
        )
        .get(eventType, deckId)
    : db
        .prepare(
          `SELECT card_name AS cardName, COUNT(*) AS count
           FROM match_card_events
           WHERE event_type = ?
           GROUP BY card_name
           ORDER BY count DESC, card_name ASC
           LIMIT 1`
        )
        .get(eventType)

  return row ?? null
}

/**
 * Most-Scored-On Battlefield's own query — deliberately a separate function
 * from topCard() above rather than a generalization of it, so nothing about
 * the already-verified Most Played/Most Mulliganed queries has to change to
 * support this. Reads event_type = 'scored_on_battlefield' rows, where
 * card_name holds a BATTLEFIELD name, not a card name (see db.js's SCHEMA
 * comment on this deliberate column reuse) — the returned field is named
 * battlefieldName, not cardName, so a caller can't mistake one for the
 * other. Same scoping/tie-breaking/empty-result contract as topCard().
 */
function topScoredOnBattlefield(db, deckId) {
  const row = deckId
    ? db
        .prepare(
          `SELECT mce.card_name AS battlefieldName, COUNT(*) AS count
           FROM match_card_events mce
           JOIN matches m ON m.id = mce.match_id
           WHERE mce.event_type = 'scored_on_battlefield' AND m.deck_id = ?
           GROUP BY mce.card_name
           ORDER BY count DESC, mce.card_name ASC
           LIMIT 1`
        )
        .get(deckId)
    : db
        .prepare(
          `SELECT card_name AS battlefieldName, COUNT(*) AS count
           FROM match_card_events
           WHERE event_type = 'scored_on_battlefield'
           GROUP BY card_name
           ORDER BY count DESC, card_name ASC
           LIMIT 1`
        )
        .get()

  return row ?? null
}

/**
 * Most Common Turn-1 Play's own query — same "played" event_type topCard()
 * already reads, narrowed to turn_number = 1. A separate function (not a
 * turnNumber parameter bolted onto topCard()) for the same reason as
 * topScoredOnBattlefield() above: zero risk to the already-shipped, already-
 * verified Most Played query. A row captured before this pass (turn_number
 * always null) can never match turn_number = 1, so old data simply doesn't
 * contribute here rather than being miscounted — consistent with this
 * feature's "no retroactive backfill" decision.
 */
function topTurnOnePlay(db, deckId) {
  const row = deckId
    ? db
        .prepare(
          `SELECT mce.card_name AS cardName, COUNT(*) AS count
           FROM match_card_events mce
           JOIN matches m ON m.id = mce.match_id
           WHERE mce.event_type = 'played' AND mce.turn_number = 1 AND m.deck_id = ?
           GROUP BY mce.card_name
           ORDER BY count DESC, mce.card_name ASC
           LIMIT 1`
        )
        .get(deckId)
    : db
        .prepare(
          `SELECT card_name AS cardName, COUNT(*) AS count
           FROM match_card_events
           WHERE event_type = 'played' AND turn_number = 1
           GROUP BY card_name
           ORDER BY count DESC, card_name ASC
           LIMIT 1`
        )
        .get()

  return row ?? null
}

/**
 * Backs Insights' Card Stats row — Most Played / Most Mulliganed (unchanged
 * by this pass) plus Most-Scored-On Battlefield / Most Common Turn-1 Play
 * (new). Nothing is stored, recomputed on every call from
 * match_card_events, the same "derive on read" approach the rest of
 * Insights already uses.
 */
export function getCardEventHighlights({ deckId } = {}) {
  const db = getDb()
  return {
    mostPlayedCard: topCard(db, 'played', deckId ?? null),
    mostMulliganedCard: topCard(db, 'mulliganed', deckId ?? null),
    mostScoredOnBattlefield: topScoredOnBattlefield(db, deckId ?? null),
    mostCommonTurnOnePlay: topTurnOnePlay(db, deckId ?? null)
  }
}
