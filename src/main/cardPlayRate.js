import { getDb } from './db.js'
import { getDeckById } from './decks.js'

/**
 * Backs Insights' "Play Rate vs. Deck Count" card and its lightbox
 * breakdown table — see CLAUDE.md's Decision Log for the full ratio
 * formula this implements. Deliberately its own module rather than folded
 * into matchCardEvents.js/insights.js: unlike every other Card Stats
 * highlight, this needs a deck's own decklist (from decks.js), not just
 * match_card_events, and it's deck-specific by definition (see below) —
 * different enough in shape to warrant its own file.
 *
 * "The deck" for this ratio is Main Deck + Champion only — the two
 * sections whose cards can ever actually generate a 'played'
 * match_card_events row (see matchResultCapture.js's PLAYED capture, which
 * reads either a "Played ... from hand" row or a Chosen Champion's "Moved
 * ... to base" entrance). Legend/Runes never enter play as playable cards
 * at all; Battlefields get their own 'scored_on_battlefield' event type
 * instead of ever being 'played'; Sideboard cards sit outside the active
 * decklist and are never actually drawable during a logged match. Including
 * any of those in the denominator would make every one of their cards look
 * permanently, meaninglessly "underplayed."
 *
 * A match only counts toward `matchesWithCaptureData` if it has at least
 * one match_card_events row of ANY event type — proof this feature's DOM
 * capture actually ran for it, as opposed to a match logged before this
 * pipeline existed, or one where capture failed silently for every field.
 * Matches with no capture data are excluded from the denominator entirely
 * rather than counted as "0 plays," so they can't drag every card's ratio
 * down to look artificially underplayed.
 *
 * ratio = timesPlayed / (copies * matchesWithCaptureData) — how often a
 * card has actually been played relative to how often it theoretically
 * could have been (once per copy, in every match this deck's plays were
 * actually captured for). Lower is more underplayed. Ties break
 * alphabetically, same convention as every other Card Stats highlight.
 *
 * Returns null when there's nothing meaningful to show: no deckId (this
 * stat is deck-specific, see Insights' own "hide for All Decks" handling),
 * no such deck, an empty Main Deck/Champion (shouldn't happen for a real
 * deck), or zero matches with capture data for this deck yet.
 */
export function getCardPlayRateBreakdown(deckId) {
  if (!deckId) return null
  const deck = getDeckById(deckId)
  if (!deck) return null

  const cardCounts = new Map()
  for (const entry of deck.decklist?.main ?? []) {
    if (!entry?.name) continue
    cardCounts.set(entry.name, (cardCounts.get(entry.name) ?? 0) + (entry.count ?? 0))
  }
  for (const entry of deck.decklist?.champion ?? []) {
    if (!entry?.name) continue
    cardCounts.set(entry.name, (cardCounts.get(entry.name) ?? 0) + (entry.count ?? 0))
  }
  if (cardCounts.size === 0) return null

  const db = getDb()

  const { count: matchesWithCaptureData } = db
    .prepare(
      `SELECT COUNT(DISTINCT mce.match_id) AS count
       FROM match_card_events mce
       JOIN matches m ON m.id = mce.match_id
       WHERE m.deck_id = ?`
    )
    .get(deckId)
  if (matchesWithCaptureData === 0) return null

  const playedCountRows = db
    .prepare(
      `SELECT mce.card_name AS cardName, COUNT(*) AS count
       FROM match_card_events mce
       JOIN matches m ON m.id = mce.match_id
       WHERE m.deck_id = ? AND mce.event_type = 'played'
       GROUP BY mce.card_name`
    )
    .all(deckId)
  const playedCounts = new Map(playedCountRows.map((row) => [row.cardName, row.count]))

  const rows = Array.from(cardCounts.entries()).map(([cardName, copies]) => {
    const timesPlayed = playedCounts.get(cardName) ?? 0
    const opportunities = copies * matchesWithCaptureData
    const ratio = opportunities > 0 ? timesPlayed / opportunities : 0
    return { cardName, copies, timesPlayed, ratio }
  })
  rows.sort((a, b) => a.ratio - b.ratio || a.cardName.localeCompare(b.cardName))

  return {
    deckId,
    matchesWithCaptureData,
    rows,
    mostUnderplayed: rows[0] ?? null
  }
}
