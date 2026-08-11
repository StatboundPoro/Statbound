import { domainColor } from '../lib/domains.jsx'
import { formatRelativeTime } from '../lib/stats.js'

const MAX_ROWS = 5

export default function RecentMatches({ matches, decksById }) {
  const recent = matches.slice(0, MAX_ROWS)

  if (recent.length === 0) {
    return (
      <div className="recent-panel">
        <div className="recent-row" style={{ gridTemplateColumns: '1fr', color: 'var(--text-faint)' }}>
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
          <div className="recent-row" key={match.id}>
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
    </div>
  )
}
