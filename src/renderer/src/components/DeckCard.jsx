import { domainColor, DomainGlyph } from '../lib/domains.jsx'
import { computeRecord, computeStreak, computeWinRate, formatRelativeTime } from '../lib/stats.js'

export default function DeckCard({ deck, matches }) {
  const winRate = computeWinRate(matches)
  const record = computeRecord(matches)
  const streak = computeStreak(matches)
  const lastPlayedAt = matches[0]?.played_at ?? null

  return (
    <div className="deck-card">
      <div className="deck-crest">
        <div className="half a" style={{ background: domainColor(deck.domain_1) }} />
        <div className="half b" style={{ background: domainColor(deck.domain_2) }} />
        <div className="glyphs">
          <div className="glyph">
            <DomainGlyph domain={deck.domain_1} />
          </div>
          {deck.domain_2 && (
            <div className="glyph">
              <DomainGlyph domain={deck.domain_2} />
            </div>
          )}
        </div>
      </div>

      <div className="deck-body">
        <div className="deck-name">{deck.name}</div>
        <div className="deck-domains">
          {[deck.domain_1, deck.domain_2].filter(Boolean).join(' · ')}
          {deck.legend_name ? ` — ${deck.legend_name}` : ''}
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
