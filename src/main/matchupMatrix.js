import { listDecks } from './decks.js'
import { listMatches } from './matches.js'

// Same threshold Insights' Matchup Breakdown already established
// (insights.js's own SMALL_SAMPLE_THRESHOLD) — duplicated rather than
// imported since the two files intentionally compute different shapes and
// there's no shared aggregation module between them yet; keep the two in
// sync if this threshold ever changes.
const SMALL_SAMPLE_THRESHOLD = 5

function round(rate) {
  return Math.round(rate * 100)
}

/**
 * Aggregates every deck's match history against every opponent Legend
 * actually faced, for the standalone Matchup Matrix screen. Unlike
 * getInsights() (src/main/insights.js), this is never scoped to one deck —
 * it's inherently a cross-deck view, so there's no deckId parameter at all.
 * Nothing is stored; recomputed from listDecks()/listMatches() on every
 * call, the same "derive on read" approach the rest of the app uses.
 *
 * Rows are every deck that has at least one logged match at all (not just
 * a decided one) — a deck with matches that are all still undecided, or
 * all missing an opponent Legend, still appears as a row with no filled
 * cells, rather than disappearing entirely. Columns are every distinct
 * opponent_legend value present across any match, decided or not (a match
 * with a null/empty opponent_legend never contributes a column, same
 * exclusion Insights already applies). A cell only exists for a
 * (deckId, legend) pair once at least one *decided* match exists for it —
 * an undecided-only pair leaves that cell absent from `cells`, distinct
 * from a real 0% result, so the UI can render "no data" differently from
 * "0% win rate."
 */
export function getMatchupMatrix() {
  const decks = listDecks()
  const deckById = new Map(decks.map((deck) => [deck.id, deck]))
  const allMatches = listMatches()

  const rowDeckIds = new Set()
  const columnLegends = new Set()
  for (const match of allMatches) {
    if (deckById.has(match.deck_id)) rowDeckIds.add(match.deck_id)
    const legend = match.opponent_legend?.trim()
    if (legend) columnLegends.add(legend)
  }

  const rows = Array.from(rowDeckIds)
    .map((id) => deckById.get(id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((deck) => ({
      id: deck.id,
      name: deck.name,
      domain_1: deck.domain_1,
      domain_2: deck.domain_2,
      legend_name: deck.legend_name
    }))

  const legends = Array.from(columnLegends).sort((a, b) => a.localeCompare(b))

  // cellsByDeck.get(deckId).get(legend) -> that pair's decided matches,
  // built up before summarizing so wins/losses/winRate all derive from the
  // same list every other per-cell field reads.
  const cellsByDeck = new Map()
  for (const match of allMatches) {
    if (match.result !== 'win' && match.result !== 'loss') continue
    const legend = match.opponent_legend?.trim()
    if (!legend) continue

    if (!cellsByDeck.has(match.deck_id)) cellsByDeck.set(match.deck_id, new Map())
    const deckCells = cellsByDeck.get(match.deck_id)
    if (!deckCells.has(legend)) deckCells.set(legend, [])
    deckCells.get(legend).push(match)
  }

  const cells = {}
  for (const [deckId, deckCells] of cellsByDeck) {
    cells[deckId] = {}
    for (const [legend, cellMatches] of deckCells) {
      const wins = cellMatches.filter((m) => m.result === 'win').length
      const losses = cellMatches.filter((m) => m.result === 'loss').length
      const total = wins + losses
      cells[deckId][legend] = {
        wins,
        losses,
        total,
        winRate: round(wins / total),
        smallSample: total < SMALL_SAMPLE_THRESHOLD,
        matches: cellMatches
      }
    }
  }

  return { decks: rows, legends, cells }
}
