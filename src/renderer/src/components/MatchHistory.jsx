import { useEffect, useMemo, useState } from 'react'
import { domainColor } from '../lib/domains.jsx'
import MatchDetailModal from './MatchDetailModal.jsx'

const RESULT_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'win', label: 'Win' },
  { key: 'loss', label: 'Loss' }
]

const FORMAT_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'Bo1', label: 'Bo1' },
  { key: 'Bo3', label: 'Bo3' }
]

const PAGE_SIZE = 50

// Match History — the rail-nav screen for every logged match across every
// deck, one row per match, most-recent first (matches:list's natural
// order). Unlike Deck Detail's Recent Matches or Matchup Record, this view
// is never scoped to a single deck. Filters are a pure client-side narrow
// of that same list; there's no separate filtered query. Clicking a row
// reuses the existing MatchDetailModal as-is — it already fetches its own
// match and deck by id, so it works unscoped with no changes needed.
export default function MatchHistory() {
  const [decks, setDecks] = useState([])
  const [matches, setMatches] = useState([])
  const [status, setStatus] = useState('loading')
  const [selectedMatchId, setSelectedMatchId] = useState(null)

  const [deckFilter, setDeckFilter] = useState('all')
  const [legendFilter, setLegendFilter] = useState('')
  const [resultFilter, setResultFilter] = useState('all')
  const [formatFilter, setFormatFilter] = useState('all')
  const [page, setPage] = useState(1)

  async function refresh() {
    const [decksResult, matchesResult] = await Promise.all([
      window.api.decks.list(),
      window.api.matches.list()
    ])
    setDecks(decksResult)
    setMatches(matchesResult)
  }

  useEffect(() => {
    refresh()
      .then(() => setStatus('ready'))
      .catch((err) => {
        console.error('Failed to load match history:', err)
        setStatus('error')
      })
  }, [])

  const decksById = useMemo(() => new Map(decks.map((deck) => [deck.id, deck])), [decks])

  const filtered = useMemo(() => {
    const legendQuery = legendFilter.trim().toLowerCase()
    return matches.filter((match) => {
      if (deckFilter !== 'all' && match.deck_id !== deckFilter) return false
      if (resultFilter !== 'all' && match.result !== resultFilter) return false
      if (formatFilter !== 'all' && match.format !== formatFilter) return false
      if (legendQuery && !(match.opponent_legend ?? '').toLowerCase().includes(legendQuery)) return false
      return true
    })
  }, [matches, deckFilter, resultFilter, formatFilter, legendFilter])

  // Narrowing the filters should always land back on page 1 rather than
  // leaving the user stranded on, say, page 4 of a now much shorter list.
  useEffect(() => {
    setPage(1)
  }, [deckFilter, resultFilter, formatFilter, legendFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  // Clamped rather than trusting `page` directly — a match getting deleted
  // out from under the current page (via MatchDetailModal's onChanged)
  // could otherwise leave `page` pointing past the new last page.
  const currentPage = Math.min(page, totalPages)
  const pageStart = (currentPage - 1) * PAGE_SIZE
  const pageMatches = filtered.slice(pageStart, pageStart + PAGE_SIZE)

  if (status === 'loading') {
    return (
      <div className="main">
        <p>Loading match history…</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="main">
        <p>Could not load match history. Check the main process console.</p>
      </div>
    )
  }

  return (
    <div className="main">
      <div className="topbar">
        <div>
          <h1>Match History</h1>
          <div className="sub">
            {matches.length} match{matches.length === 1 ? '' : 'es'} logged
          </div>
        </div>
      </div>

      <div className="match-history-filters">
        <div className="form-field">
          <span>Deck</span>
          <select value={deckFilter} onChange={(e) => setDeckFilter(e.target.value)}>
            <option value="all">All Decks</option>
            {decks.map((deck) => (
              <option key={deck.id} value={deck.id}>
                {deck.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <span>Opponent Legend</span>
          <input
            type="text"
            placeholder="Search legend…"
            value={legendFilter}
            onChange={(e) => setLegendFilter(e.target.value)}
          />
        </div>
        <div className="form-field">
          <span>Result</span>
          <div className="segmented">
            {RESULT_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={`segmented-option ${resultFilter === opt.key ? 'active' : ''}`}
                data-variant={opt.key === 'all' ? undefined : opt.key}
                onClick={() => setResultFilter(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="form-field">
          <span>Format</span>
          <div className="segmented">
            {FORMAT_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={`segmented-option ${formatFilter === opt.key ? 'active' : ''}`}
                onClick={() => setFormatFilter(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {matches.length === 0 ? (
        <div className="match-history-table">
          <div className="match-history-empty">No matches logged yet.</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="match-history-table">
          <div className="match-history-empty">No matches found for these filters.</div>
        </div>
      ) : (
        <>
          <div className="match-history-table">
            <div className="match-history-row-header">
              <div>Date</div>
              <div>Deck</div>
              <div>Opponent Legend</div>
              <div>Result</div>
              <div>Format</div>
            </div>
            {pageMatches.map((match) => {
              const deck = decksById.get(match.deck_id)
              const gradient = deck
                ? `linear-gradient(${domainColor(deck.domain_1)}, ${domainColor(deck.domain_2)})`
                : 'var(--border)'

              return (
                <button
                  key={match.id}
                  type="button"
                  className="match-history-row"
                  onClick={() => setSelectedMatchId(match.id)}
                >
                  <div>{new Date(match.played_at).toLocaleDateString()}</div>
                  <div className="match-history-deck">
                    <span className="match-history-deck-bar" style={{ background: gradient }} />
                    <span>{deck?.name ?? 'Unknown deck'}</span>
                  </div>
                  <div className="match-history-opponent">{match.opponent_legend ?? 'Unknown'}</div>
                  <div className={`match-history-result ${match.result ?? ''}`}>
                    {match.result ? `${match.result.toUpperCase()} ${match.score}` : '-'}
                  </div>
                  <div className="match-history-format">{match.format}</div>
                </button>
              )
            })}
          </div>

          {totalPages > 1 && (
            <div className="match-history-pagination">
              <div className="match-history-pagination-summary">
                Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filtered.length)} of {filtered.length}
              </div>
              <div className="match-history-pagination-controls">
                <button
                  type="button"
                  className="btn"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </button>
                <span className="match-history-pagination-page">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  className="btn"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {selectedMatchId && (
        <MatchDetailModal matchId={selectedMatchId} onClose={() => setSelectedMatchId(null)} onChanged={refresh} />
      )}
    </div>
  )
}
