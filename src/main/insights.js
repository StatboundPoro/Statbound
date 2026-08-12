import { listMatches } from './matches.js'

const SMALL_SAMPLE_THRESHOLD = 5
const RECENT_TREND_COUNT = 10

function round(rate) {
  return Math.round(rate * 100)
}

// Shared by every section below: given a list of "decided" items (matches
// or games already known to have a result of 'win' or 'loss'), returns the
// total/wins/losses/winRate every section needs — always alongside the
// count it's based on, since the UI shows "(N games)" next to every rate.
function summarize(decidedItems) {
  const wins = decidedItems.filter((item) => item.result === 'win').length
  const losses = decidedItems.filter((item) => item.result === 'loss').length
  const total = wins + losses
  return { total, wins, losses, winRate: total === 0 ? null : round(wins / total) }
}

/**
 * Aggregates match/game stats for the Insights screen, either across every
 * deck (deckId omitted/null) or narrowed to one. Nothing here is stored —
 * every number is recomputed from listMatches() on each call, the same
 * "derive on read" approach matches.js already uses for a single match's
 * own result/score. Dataset size (personal match history) doesn't justify
 * a materialized stats table.
 *
 * Overall win rate, trend, and matchup breakdown are computed at MATCH
 * level, using each match's derived result exactly as
 * listMatches()/getMatchById() already compute it. Matches with a null
 * result (undecided, e.g. an incomplete Bo3) are excluded entirely — not
 * counted as a loss, and not dropped without also narrowing the
 * denominator.
 *
 * Seat advantage and battlefield win rate are computed at GAME level
 * instead, since seat/my_battlefield are per-game fields — a match can
 * have some decided games and some incomplete ones regardless of whether
 * the match overall has landed on a result yet. Games are only counted
 * here if their own result is 'win' or 'loss' (which also naturally
 * excludes 'incomplete' and not-yet-entered null-result games); games
 * with no my_battlefield recorded are further excluded, but only from the
 * battlefield breakdown specifically.
 */
export function getInsights({ deckId } = {}) {
  const allMatches = listMatches()
  const matches = deckId ? allMatches.filter((m) => m.deck_id === deckId) : allMatches
  const decidedMatches = matches.filter((m) => m.result === 'win' || m.result === 'loss')

  const overall = summarize(decidedMatches)

  const recentMatches = decidedMatches.slice(0, Math.min(RECENT_TREND_COUNT, decidedMatches.length))
  const recentSummary = summarize(recentMatches)

  const decidedGames = matches
    .flatMap((match) => match.games)
    .filter((game) => game.result === 'win' || game.result === 'loss')

  const battlefieldGroups = new Map()
  for (const game of decidedGames) {
    if (!game.my_battlefield) continue
    if (!battlefieldGroups.has(game.my_battlefield)) battlefieldGroups.set(game.my_battlefield, [])
    battlefieldGroups.get(game.my_battlefield).push(game)
  }

  const matchupGroups = new Map()
  for (const match of decidedMatches) {
    const legend = match.opponent_legend?.trim()
    if (!legend) continue
    if (!matchupGroups.has(legend)) matchupGroups.set(legend, [])
    matchupGroups.get(legend).push(match)
  }

  return {
    totalDecidedMatches: overall.total,
    wins: overall.wins,
    losses: overall.losses,
    winRate: overall.winRate,

    trend: {
      recent: {
        count: recentSummary.total,
        wins: recentSummary.wins,
        losses: recentSummary.losses,
        winRate: recentSummary.winRate
      },
      allTime: { count: overall.total, wins: overall.wins, losses: overall.losses, winRate: overall.winRate }
    },

    seatStats: {
      went_1st: summarize(decidedGames.filter((game) => game.seat === 'went_1st')),
      went_2nd: summarize(decidedGames.filter((game) => game.seat === 'went_2nd'))
    },

    battlefieldStats: Array.from(battlefieldGroups.entries())
      .map(([battlefield, games]) => ({ battlefield, ...summarize(games) }))
      .sort((a, b) => b.total - a.total),

    matchupStats: Array.from(matchupGroups.entries())
      .map(([opponentLegend, legendMatches]) => {
        const s = summarize(legendMatches)
        return { opponentLegend, ...s, smallSample: s.total < SMALL_SAMPLE_THRESHOLD }
      })
      .sort((a, b) => b.winRate - a.winRate)
  }
}
