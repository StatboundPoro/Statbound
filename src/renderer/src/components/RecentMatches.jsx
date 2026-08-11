import { useState } from 'react'
import { domainColor } from '../lib/domains.jsx'
import { formatRelativeTime } from '../lib/stats.js'
import MatchDetailModal from './MatchDetailModal.jsx'

const MAX_ROWS = 5

// `onChanged` bubbles up to the caller (Deck Library or Deck Detail) so it
// can refetch matches after a row's match is edited/deleted in the detail
// modal — everything derived from that list (stat strips, streaks,
// Matchup Record) then updates from the same refetch, no separate wiring.
export default function RecentMatches({ matches, decksById, onChanged }) {
  const [selectedMatchId, setSelectedMatchId] = useState(null)
  const recent = matches.slice(0, MAX_ROWS)

  if (recent.length === 0) {
    return (
      <div className="recent-panel">
        <div className="recent-row" style={{ gridTemplateColumns: '1fr', color: 'var(--text-faint)', cursor: 'default' }}>
          No matches recorded yet.
        </div>
      </div>
    )
  }

  return (
    <div className="recent-panel">
      {recent.map((match) => {
        const deck = decksById.get(match.deck_id)
        const gradient = deck
          ? `linear-gradient(${domainColor(deck.domain_1)}, ${domainColor(deck.domain_2)})`
          : 'var(--border)'

        return (
          <div
            className="recent-row"
            key={match.id}
            role="button"
            tabIndex={0}
            onClick={() => setSelectedMatchId(match.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setSelectedMatchId(match.id)
            }}
          >
            <div className="bar" style={{ background: gradient }} />
            <div className="deck">{deck?.name ?? 'Unknown deck'}</div>
            <div className="opp">vs. {match.opponent_legend ?? 'Unknown opponent'}</div>
            <div className={`result ${match.result}`}>
              {match.result?.toUpperCase()} {match.score}
            </div>
            <div className="time">{formatRelativeTime(match.played_at)}</div>
            <div className="play-icon">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 4l14 8-14 8V4z" />
              </svg>
            </div>
          </div>
        )
      })}

      {selectedMatchId && (
        <MatchDetailModal matchId={selectedMatchId} onClose={() => setSelectedMatchId(null)} onChanged={onChanged} />
      )}
    </div>
  )
}
