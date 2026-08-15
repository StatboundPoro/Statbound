import { useState } from 'react'
import { computeMatchupRecords } from '../lib/stats.js'
import MatchDetailModal from './MatchDetailModal.jsx'

const SORT_OPTIONS = [
  { key: 'games', label: 'Games Played' },
  { key: 'winRate', label: 'Win Rate' },
  { key: 'legend', label: 'Legend' }
]

function sortRecords(records, sortKey) {
  const sorted = [...records]
  if (sortKey === 'winRate') {
    sorted.sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1))
  } else if (sortKey === 'legend') {
    sorted.sort((a, b) => a.legend.localeCompare(b.legend))
  } else {
    sorted.sort((a, b) => b.gamesPlayed - a.gamesPlayed)
  }
  return sorted
}

// One row per logged MATCH against this legend — not one row per game. A
// Bo3 match already carries its own overall result/score (derived from its
// games by matches.js's deriveMatchSummary, the same way Recent Matches
// gets its "WIN 2-1" text), so this reuses that directly instead of
// recomputing anything from the individual games. "Deck Used" is the same
// for every row here since Deck Detail is already scoped to one deck, but
// the column is kept for parity with how this data is described elsewhere
// and in case this component is ever reused unscoped.
function MatchupMatchesTable({ matches, deckName, onSelectMatch }) {
  if (matches.length === 0) {
    return <div className="matchup-games-empty">No matches recorded for this matchup.</div>
  }

  return (
    <table className="matchup-games-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Format</th>
          <th>Result</th>
          <th>Deck Used</th>
        </tr>
      </thead>
      <tbody>
        {matches.map((match) => (
          <tr key={match.id} onClick={() => onSelectMatch(match.id)}>
            <td>{new Date(match.played_at).toLocaleDateString()}</td>
            <td>{match.format}</td>
            <td className={`matchup-games-result ${match.result ?? ''}`}>
              {match.result?.toUpperCase()} {match.score}
            </td>
            <td>{deckName}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Matchup Record section on Deck Detail — a computed view over this
// deck's existing match history, grouped by opponent_legend. Nothing here
// is stored; it's entirely derived from `matches` on every render, the
// same "derive on read" approach matches.js uses for a match's own
// result/score. Deliberately has no link to the Notes section's matchup
// scope dropdown — the two stay fully separate per design. Clicking an
// expanded row's match opens the same MatchDetailModal used by Recent
// Matches; `onChanged` bubbles up to the caller to refetch matches after
// an edit/delete there, which recomputes this section's rows too since
// they're derived from the same `matches` prop.
export default function MatchupRecord({ matches, deckName, onChanged }) {
  const [sortKey, setSortKey] = useState('games')
  const [expandedLegend, setExpandedLegend] = useState(null)
  const [selectedMatchId, setSelectedMatchId] = useState(null)

  if (matches.length === 0) {
    return <div className="placeholder-panel">No matchup data yet. Log a match to start tracking.</div>
  }

  const records = sortRecords(computeMatchupRecords(matches), sortKey)

  return (
    <div className="matchup-record">
      <div className="matchup-controls">
        <div className="segmented">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`segmented-option ${sortKey === opt.key ? 'active' : ''}`}
              onClick={() => setSortKey(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="matchup-table">
        <div className="matchup-table-header">
          <div>Opponent Legend</div>
          <div>Record</div>
          <div>Win Rate</div>
          <div>Streak</div>
          <div>Games</div>
          <div />
        </div>
        {records.map((row) => {
          const isExpanded = expandedLegend === row.legend
          return (
            <div key={row.legend} className="matchup-row-group">
              <button
                type="button"
                className="matchup-row"
                onClick={() => setExpandedLegend(isExpanded ? null : row.legend)}
                aria-expanded={isExpanded}
              >
                <div className="matchup-row-legend">{row.legend}</div>
                <div className="matchup-row-record">
                  {row.record.wins}-{row.record.losses}
                </div>
                <div className={`matchup-row-winrate ${row.winRate === null ? '' : row.winRate >= 0.5 ? 'pos' : 'neg'}`}>
                  {row.winRate === null ? '-' : `${Math.round(row.winRate * 100)}%`}
                </div>
                <div className={`matchup-row-streak ${row.streak ? (row.streak.result === 'win' ? 'pos' : 'neg') : ''}`}>
                  {row.streak ? `${row.streak.result === 'win' ? 'W' : 'L'}${row.streak.count}` : '-'}
                </div>
                <div className="matchup-row-games">{row.gamesPlayed}</div>
                <div className="matchup-row-chevron">{isExpanded ? '▾' : '▸'}</div>
              </button>
              {isExpanded && (
                <div className="matchup-row-detail">
                  <MatchupMatchesTable matches={row.matches} deckName={deckName} onSelectMatch={setSelectedMatchId} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {selectedMatchId && (
        <MatchDetailModal matchId={selectedMatchId} onClose={() => setSelectedMatchId(null)} onChanged={onChanged} />
      )}
    </div>
  )
}
