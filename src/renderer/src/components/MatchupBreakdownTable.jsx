import { useState } from 'react'
import MatchDetailModal from './MatchDetailModal.jsx'

// Matches Match History's own PAGE_SIZE convention (client-side, resets on
// state change) -- see MatchHistory.jsx -- just applied per expanded row
// here instead of to the whole page.
const PAGE_SIZE = 15

// One row per logged MATCH against this legend — not one row per game. A
// Bo3 match already carries its own overall result/score (derived from its
// games by matches.js's deriveMatchSummary, the same way Recent Matches
// gets its "WIN 2-1" text), so this reuses that directly instead of
// recomputing anything from the individual games. `resolveDeckName` is a
// function rather than a plain string since this table is shared across
// contexts that aren't always scoped to one deck — Insights' "All Decks"
// filter can group several different decks' matches under one opponent
// legend, so each row needs to resolve its own match's deck rather than
// assuming a single caller-supplied name; the Matchup Matrix's per-cell
// drill-down popover (its other caller) is always one deck, so it just
// passes a function that returns the same name for every match. Exported
// so both of those call sites can reuse the exact same rendering rather
// than duplicating this table a second time.
export function MatchupMatchesTable({ matches, resolveDeckName, onSelectMatch }) {
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
            <td>{resolveDeckName(match)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Matchup Breakdown — Insights' per-legend matchup table, and the sole
// place this data is shown anywhere in the app now that Deck Detail's own
// embedded Matchup Record section has been removed in favor of its "View
// Insights" button, which deep-links here already pre-scoped to that deck
// (see DeckDetail.jsx and App.jsx's handleViewDeckInsights). This
// component combines what used to be two separate, near-identical tables:
// Insights' own Best/Worst and Small-sample badging (`bestLegend`/
// `worstLegend`, computed by the caller alongside the Best/Worst Matchup
// summary cards above this table so the two can never disagree — see
// InsightsScreen.jsx) plus the old Matchup Record's expandable per-match
// detail (MatchupMatchesTable above), Record/Streak columns, and its
// Unknown Legend bucketing for matches logged with no opponent_legend (see
// computeMatchupBreakdown() in lib/stats.js, which produces `rows`).
// `rows` must already be sorted by the caller — InsightsScreen owns sort
// state/control for this table exactly the way it already owns Battlefield
// Win Rate's, so this component only renders and manages its own
// expand/collapse and match-detail-modal state, matching the old Matchup
// Record's own self-contained behavior for those two pieces.
//
// `expandedPage` is a single piece of state, not one per legend, because
// only one row can ever be expanded at a time (`expandedLegend` is a bare
// string, not a set) — toggling to a different row already can't leave a
// stale page number visible for a row that isn't showing, since only the
// currently-expanded row ever reads `expandedPage` at render time. It's
// still reset to 1 on every expand (including re-expanding the same row
// after collapsing it), matching Match History's own "a state change
// always lands back on page 1" convention, so if per-row expansion is
// ever added later this already does the right thing rather than leaking
// one row's page into another's.
export default function MatchupBreakdownTable({ rows, bestLegend, worstLegend, resolveDeckName, onChanged, emptyMessage }) {
  const [expandedLegend, setExpandedLegend] = useState(null)
  const [expandedPage, setExpandedPage] = useState(1)
  const [selectedMatchId, setSelectedMatchId] = useState(null)

  if (rows.length === 0) {
    return <div className="placeholder-panel">{emptyMessage}</div>
  }

  function toggleExpanded(legend) {
    if (expandedLegend === legend) {
      setExpandedLegend(null)
    } else {
      setExpandedLegend(legend)
      setExpandedPage(1)
    }
  }

  return (
    <div className="matchup-table">
      <div className="matchup-table-header">
        <div>Opponent Legend</div>
        <div>Record</div>
        <div>Win Rate</div>
        <div>Streak</div>
        <div>Games</div>
        <div />
      </div>
      {rows.map((row) => {
        const isExpanded = expandedLegend === row.legend
        const isBest = row.legend === bestLegend
        const isWorst = row.legend === worstLegend

        // Only computed for the row actually being rendered expanded --
        // clamped against totalPages (not trusted as-is) the same way
        // MatchHistory.jsx clamps its own `page`, since a match getting
        // edited/deleted out from under an open row (via onChanged below)
        // could otherwise leave `expandedPage` pointing past the new last
        // page for a now-shorter list.
        let pageMatches = row.matches
        let totalPages = 1
        let currentPage = 1
        if (isExpanded) {
          totalPages = Math.max(1, Math.ceil(row.matches.length / PAGE_SIZE))
          currentPage = Math.min(expandedPage, totalPages)
          const pageStart = (currentPage - 1) * PAGE_SIZE
          pageMatches = row.matches.slice(pageStart, pageStart + PAGE_SIZE)
        }

        return (
          <div key={row.legend} className="matchup-row-group">
            <button
              type="button"
              className="matchup-row"
              onClick={() => toggleExpanded(row.legend)}
              aria-expanded={isExpanded}
            >
              <div className="matchup-row-legend">
                {row.legend}
                {isBest && <span className="insights-badge insights-badge-best">Best</span>}
                {isWorst && <span className="insights-badge insights-badge-worst">Worst</span>}
                {row.smallSample && <span className="insights-badge">Small sample</span>}
              </div>
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
                <MatchupMatchesTable matches={pageMatches} resolveDeckName={resolveDeckName} onSelectMatch={setSelectedMatchId} />
                {totalPages > 1 && (
                  <div className="matchup-games-pagination">
                    <button
                      type="button"
                      className="matchup-games-page-arrow"
                      disabled={currentPage <= 1}
                      onClick={() => setExpandedPage(currentPage - 1)}
                      aria-label="Previous page"
                      title="Previous page"
                    >
                      <svg viewBox="0 0 24 24" fill="none" width="13" height="13">
                        <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <span className="matchup-games-pagination-page">
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      type="button"
                      className="matchup-games-page-arrow"
                      disabled={currentPage >= totalPages}
                      onClick={() => setExpandedPage(currentPage + 1)}
                      aria-label="Next page"
                      title="Next page"
                    >
                      <svg viewBox="0 0 24 24" fill="none" width="13" height="13">
                        <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {selectedMatchId && (
        <MatchDetailModal matchId={selectedMatchId} onClose={() => setSelectedMatchId(null)} onChanged={onChanged} />
      )}
    </div>
  )
}
