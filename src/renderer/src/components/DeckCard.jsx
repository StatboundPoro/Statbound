import { domainColor } from '../lib/domains.jsx'
import { domainIcon } from '../lib/domainIcons.js'
import { computeRecord, computeStreak, computeWinRate, formatRelativeTime } from '../lib/stats.js'

export default function DeckCard({ deck, matches, onClick, onDeleteClick }) {
  const winRate = computeWinRate(matches)
  const record = computeRecord(matches)
  const streak = computeStreak(matches)
  const lastPlayedAt = matches[0]?.played_at ?? null

  return (
    <div
      className="deck-card"
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.target !== e.currentTarget) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
    >
      <div className="deck-crest">
        <div className="half a" style={{ background: domainColor(deck.domain_1) }} />
        <div className="half b" style={{ background: domainColor(deck.domain_2) }} />
        <div className="glyphs">
          <div className="glyph">
            {domainIcon(deck.domain_1) && <img src={domainIcon(deck.domain_1)} alt="" />}
          </div>
          {deck.domain_2 && (
            <div className="glyph">
              {domainIcon(deck.domain_2) && <img src={domainIcon(deck.domain_2)} alt="" />}
            </div>
          )}
        </div>
      </div>

      <div className="deck-body">
        <div className="deck-body-top">
          <div>
            <div className="deck-name">{deck.name}</div>
            <div className="deck-domains">
              {[deck.domain_1, deck.domain_2].filter(Boolean).join(' · ')}
              {deck.legend_name ? ` — ${deck.legend_name}` : ''}
            </div>
          </div>
          {onDeleteClick && (
            <button
              className="deck-card-delete"
              aria-label={`Delete ${deck.name}`}
              onClick={(e) => {
                e.stopPropagation()
                onDeleteClick()
              }}
            >
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0-1 13a1 1 0 01-1 1H8a1 1 0 01-1-1L6 7h12z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>

        <div className="deck-stat-row">
          {winRate === null ? (
            <div className="deck-record" style={{ color: 'var(--text-faint)' }}>
              No games yet
            </div>
          ) : (
            <div>
              <div className="deck-record">
                <span
                  className="wr"
                  style={{ color: winRate >= 0.5 ? 'var(--calm)' : 'var(--text)' }}
                >
                  {Math.round(winRate * 100)}%
                </span>{' '}
                WR · {record.wins}-{record.losses}
              </div>
              {streak && streak.count > 1 && (
                <div className={`streak-pill ${streak.result === 'win' ? 'hot' : 'cold'}`}>
                  {streak.result === 'win' ? '▲' : '▼'} {streak.result === 'win' ? 'W' : 'L'}
                  {streak.count}
                </div>
              )}
            </div>
          )}
          <div className="deck-meta">
            Last played
            <br />
            {formatRelativeTime(lastPlayedAt)}
          </div>
        </div>
      </div>
    </div>
  )
}
