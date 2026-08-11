import { useEffect, useMemo, useState } from 'react'
import DeckCard from './DeckCard.jsx'
import RecentMatches from './RecentMatches.jsx'
import { computeStreak, computeWinRate, findBestDeck, formatRelativeTime } from '../lib/stats.js'

// This screen is the proof that the whole pipeline works end to end:
// React -> window.api (preload) -> ipcRenderer.invoke -> main process ->
// better-sqlite3 -> back again. Nothing here talks to SQLite directly.
export default function DeckLibrary() {
  const [decks, setDecks] = useState([])
  const [matches, setMatches] = useState([])
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    Promise.all([window.api.decks.list(), window.api.matches.list()])
      .then(([decksResult, matchesResult]) => {
        setDecks(decksResult)
        setMatches(matchesResult)
        setStatus('ready')
      })
      .catch((err) => {
        console.error('Failed to load deck library:', err)
        setStatus('error')
      })
  }, [])

  const matchesByDeckId = useMemo(() => {
    const map = new Map()
    for (const match of matches) {
      const list = map.get(match.deck_id) ?? []
      list.push(match)
      map.set(match.deck_id, list)
    }
    return map
  }, [matches])

  const decksById = useMemo(() => new Map(decks.map((deck) => [deck.id, deck])), [decks])

  const overallWinRate = useMemo(() => computeWinRate(matches), [matches])
  const currentStreak = useMemo(() => computeStreak(matches), [matches])
  const bestDeck = useMemo(() => findBestDeck(decks, matchesByDeckId), [decks, matchesByDeckId])
  const lastPlayedAt = matches[0]?.played_at ?? null

  if (status === 'loading') {
    return (
      <div className="main">
        <p>Loading deck library…</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="main">
        <p>Could not load the deck library. Check the main process console.</p>
      </div>
    )
  }

  return (
    <div className="main">
      <div className="topbar">
        <div>
          <h1>Deck Library</h1>
          <div className="sub">
            {decks.length} deck{decks.length === 1 ? '' : 's'} · {matches.length} games tracked
          </div>
        </div>
        <div className="topbar-actions">
          <button className="btn" disabled title="Not built yet">
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
              <path d="M12 4v16M4 12h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Import Deck
          </button>
          <button className="btn btn-primary" disabled title="Not built yet">
            <svg viewBox="0 0 24 24" fill="#151313" width="12" height="12">
              <path d="M6 4l14 8-14 8V4z" />
            </svg>
            Play
          </button>
        </div>
      </div>

      <div className="stat-strip">
        <div className="stat-cell">
          <div className="label">Overall Win Rate</div>
          <div className={`value ${overallWinRate !== null ? 'pos' : ''}`}>
            {overallWinRate === null ? '—' : `${Math.round(overallWinRate * 100)}%`}
          </div>
        </div>
        <div className="stat-cell">
          <div className="label">Current Streak</div>
          <div className={`value ${currentStreak ? (currentStreak.result === 'win' ? 'pos' : 'neg') : ''}`}>
            {currentStreak ? `${currentStreak.result === 'win' ? 'W' : 'L'}${currentStreak.count}` : '—'}
          </div>
        </div>
        <div className="stat-cell">
          <div className="label">Best Deck</div>
          <div className="value" style={{ fontSize: 15, paddingTop: 4, color: 'var(--text-dim)' }}>
            {bestDeck ? bestDeck.deck.name : '—'}
          </div>
        </div>
        <div className="stat-cell">
          <div className="label">Last Played</div>
          <div className="value" style={{ fontSize: 15, paddingTop: 4, color: 'var(--text-dim)' }}>
            {formatRelativeTime(lastPlayedAt)}
          </div>
        </div>
      </div>

      <div className="section-label">Your Decks</div>
      <div className="deck-grid">
        {decks.map((deck) => (
          <DeckCard key={deck.id} deck={deck} matches={matchesByDeckId.get(deck.id) ?? []} />
        ))}

        <div className="import-card" role="button" aria-disabled="true" title="Not built yet">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M12 4v16M4 12h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span>Add a deck</span>
        </div>
      </div>

      <div className="section-label">Recent Matches</div>
      <RecentMatches matches={matches} decksById={decksById} />
    </div>
  )
}
