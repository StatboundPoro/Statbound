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

// Picks the deck with the best win rate among decks that have at least
// one decided match. Returns null when no deck has any match history yet.
export function findBestDeck(decks, matchesByDeckId) {
  let best = null
  for (const deck of decks) {
    const deckMatches = matchesByDeckId.get(deck.id) ?? []
    const winRate = computeWinRate(deckMatches)
    if (winRate === null) continue
    if (!best || winRate > best.winRate) {
      best = { deck, winRate }
    }
  }
  return best
}
