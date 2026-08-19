export function formatRelativeTime(isoString) {
  if (!isoString) return 'Never'

  const diffMs = Date.now() - new Date(isoString).getTime()
  const minutes = Math.floor(diffMs / 60000)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`

  return new Date(isoString).toLocaleDateString()
}

// "Today, 3:42 PM" / "Yesterday, 3:42 PM" / "8/10/2026, 3:42 PM" — backs
// the Pending Recordings queue's per-session start time, where a bare
// formatRelativeTime()'s "2h ago" reads worse once you also need the exact
// clock time to distinguish two sessions from the same day.
export function formatSessionTime(isoString) {
  const date = new Date(isoString)
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  const now = new Date()
  if (date.toDateString() === now.toDateString()) return `Today, ${time}`

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`

  return `${date.toLocaleDateString()}, ${time}`
}

// Whole minutes between two ISO timestamps, floored to "<1 min" rather
// than "0 min" for a very short recording.
export function formatDuration(startIsoString, endIsoString) {
  const ms = new Date(endIsoString) - new Date(startIsoString)
  const minutes = Math.floor(ms / 60000)
  return minutes < 1 ? '<1 min' : `${minutes} min`
}

// matches must already be sorted most-recent-first.
export function computeWinRate(matches) {
  const decided = matches.filter((m) => m.result === 'win' || m.result === 'loss')
  if (decided.length === 0) return null
  const wins = decided.filter((m) => m.result === 'win').length
  return wins / decided.length
}

// matches must already be sorted most-recent-first.
export function computeStreak(matches) {
  const decided = matches.filter((m) => m.result === 'win' || m.result === 'loss')
  if (decided.length === 0) return null

  const result = decided[0].result
  let count = 0
  for (const match of decided) {
    if (match.result !== result) break
    count++
  }
  return { result, count }
}

export function computeRecord(matches) {
  const wins = matches.filter((m) => m.result === 'win').length
  const losses = matches.filter((m) => m.result === 'loss').length
  return { wins, losses }
}

// A win rate only means something once there's enough of a sample behind
// it, otherwise a single 1-0 record would out-rank a real 40-15 one just
// because 100% > 73%. Shared by findBestDeck below and, via
// computeMatchupBreakdown, by the Insights screen's own Matchup Breakdown
// small-sample badge.
const SMALL_SAMPLE_THRESHOLD = 5

// Groups a list of matches by opponent legend into the shared matchup
// breakdown Insights' Matchup Breakdown table (MatchupBreakdownTable.jsx)
// renders from — the sole place this data is shown now that Deck Detail's
// own embedded Matchup Record section has been removed in favor of its
// "View Insights" deep link (see DeckDetail.jsx and App.jsx's
// handleViewDeckInsights). `matches` must already be sorted most-recent-
// first (matches:list's natural order) so each group's streak comes out
// correct with no second sort pass. Matches with no opponent_legend
// recorded still get grouped, under "Unknown Legend", rather than
// silently dropped. A group can include matches with no decided result
// (an incomplete Bo3) alongside decided ones — record/winRate/streak/
// smallSample are all derived from the decided subset only (via
// computeRecord/computeWinRate/computeStreak, which already filter to
// 'win'/'loss'), but `matches` itself keeps every match for that legend so
// an expanded row's match history is complete, not silently missing an
// undecided one.
export function computeMatchupBreakdown(matches) {
  const groups = new Map()
  for (const match of matches) {
    const legend = match.opponent_legend?.trim() || 'Unknown Legend'
    if (!groups.has(legend)) groups.set(legend, [])
    groups.get(legend).push(match)
  }

  return Array.from(groups.entries()).map(([legend, legendMatches]) => {
    const record = computeRecord(legendMatches)
    const gamesPlayed = record.wins + record.losses
    return {
      legend,
      matches: legendMatches,
      record,
      winRate: computeWinRate(legendMatches),
      streak: computeStreak(legendMatches),
      gamesPlayed,
      smallSample: gamesPlayed < SMALL_SAMPLE_THRESHOLD
    }
  })
}

// Picks the deck with the best win rate among decks with at least
// SMALL_SAMPLE_THRESHOLD decided matches. Returns null if no deck clears
// that bar yet, even if some deck has a match history at all.
export function findBestDeck(decks, matchesByDeckId) {
  let best = null
  for (const deck of decks) {
    const deckMatches = matchesByDeckId.get(deck.id) ?? []
    const { wins, losses } = computeRecord(deckMatches)
    if (wins + losses < SMALL_SAMPLE_THRESHOLD) continue
    const winRate = computeWinRate(deckMatches)
    if (winRate === null) continue
    if (!best || winRate > best.winRate) {
      best = { deck, winRate }
    }
  }
  return best
}
