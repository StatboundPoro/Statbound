import { useEffect, useMemo, useState } from 'react'
import { computeStreak } from '../lib/stats.js'

const DEFAULT_SORT = 'winRateDesc'

const SORT_OPTIONS = [
  { key: 'winRateDesc', label: 'High → Low' },
  { key: 'winRateAsc', label: 'Low → High' },
  { key: 'alpha', label: 'A–Z' }
]

function formatRate(rate) {
  return rate === null ? '-' : `${rate}%`
}

function rateClass(rate) {
  if (rate === null) return ''
  return rate >= 50 ? 'pos' : 'neg'
}

// Shared by Battlefield Win Rate and Matchup Breakdown — both tables get
// the same three sort options (win rate desc/asc, or alphabetical by
// whichever field `nameKey` points at), so the sort logic itself lives in
// one place rather than being duplicated per table. Every row in both
// arrays always has a real (non-null) winRate, since getInsights() only
// ever creates a row once at least one decided match/game exists for it.
function sortRows(rows, sortKey, nameKey) {
  const sorted = [...rows]
  if (sortKey === 'winRateAsc') {
    sorted.sort((a, b) => a.winRate - b.winRate)
  } else if (sortKey === 'alpha') {
    sorted.sort((a, b) => a[nameKey].localeCompare(b[nameKey]))
  } else {
    sorted.sort((a, b) => b.winRate - a.winRate)
  }
  return sorted
}

function SortControl({ value, onChange }) {
  return (
    <div className="segmented">
      {SORT_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          type="button"
          className={`segmented-option ${value === opt.key ? 'active' : ''}`}
          onClick={() => onChange(opt.key)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// Insights — the rail-nav screen for aggregate stats across every deck (or
// one, via the filter dropdown). Everything here is computed on read by
// insights:get/getInsights() in src/main/insights.js; this component just
// renders whatever shape that returns, sorts the two tables client-side
// (see sortRows above — getInsights() itself has no opinion on display
// order), and figures out which single matchup (if any) counts as
// "best"/"worst" for the highlight treatment and the summary cards above
// the table — see the bestRow/worstRow useMemo below for why that's a
// renderer-side decision rather than something the backend bakes in.
//
// `initialDeckId` is optional and only ever set by Deck Detail's "View
// Insights" button (App.jsx's handleViewDeckInsights) as a one-time deep
// link — App.jsx fully unmounts this component whenever `screen` leaves
// 'insights', so a plain useState initializer is enough to pick it up on
// every fresh visit; no prop-sync effect is needed. Reaching this screen
// via the Sidebar nav item instead always passes no prop, landing on "All
// Decks" as before.
export default function InsightsScreen({ initialDeckId = null }) {
  const [decks, setDecks] = useState([])
  const [matches, setMatches] = useState([])
  const [deckId, setDeckId] = useState(initialDeckId ?? 'all')
  const [insights, setInsights] = useState(null)
  const [status, setStatus] = useState('loading')
  const [battlefieldSort, setBattlefieldSort] = useState(DEFAULT_SORT)
  const [matchupSort, setMatchupSort] = useState(DEFAULT_SORT)

  useEffect(() => {
    window.api.decks
      .list()
      .then(setDecks)
      .catch((err) => console.error('Failed to load decks:', err))
  }, [])

  // Fetched separately from insights:get, purely to compute the Current
  // Streak box the same way Deck Detail already does — via computeStreak()
  // in stats.js, reusing that logic rather than re-deriving a streak from
  // getInsights()'s aggregated numbers (which don't preserve per-match
  // order/detail anyway).
  useEffect(() => {
    window.api.matches
      .list()
      .then(setMatches)
      .catch((err) => console.error('Failed to load matches:', err))
  }, [])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    window.api.insights
      .get({ deckId: deckId === 'all' ? null : deckId })
      .then((result) => {
        if (cancelled) return
        setInsights(result)
        setStatus('ready')
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Failed to load insights:', err)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [deckId])

  // A sort order chosen for the previous deck's dataset isn't necessarily
  // meaningful for a newly-filtered one, so both tables snap back to the
  // default whenever the deck filter changes rather than persisting a
  // stale order.
  useEffect(() => {
    setBattlefieldSort(DEFAULT_SORT)
    setMatchupSort(DEFAULT_SORT)
  }, [deckId])

  const sortedDecks = useMemo(() => [...decks].sort((a, b) => a.name.localeCompare(b.name)), [decks])

  // matches:list() already returns played_at DESC (matches.js's natural
  // order), and computeStreak() requires most-recent-first input — so a
  // plain .filter() here (no re-sort) keeps that ordering intact, the same
  // way DeckDetail.jsx already relies on it.
  const scopedMatches = useMemo(
    () => (deckId === 'all' ? matches : matches.filter((m) => m.deck_id === deckId)),
    [matches, deckId]
  )
  const streak = useMemo(() => computeStreak(scopedMatches), [scopedMatches])

  // Highlighting (both the inline table row and the summary cards below)
  // only makes sense among matchups with enough games to mean something —
  // a 1-0 record shouldn't out-rank a real 14-6 one just because 100% >
  // 70%. If every matchup is small-sample, there's nothing eligible to
  // highlight at all. bestRow/worstRow are the single source of truth for
  // both the summary cards and the table's highlighted row, so the two
  // can never disagree.
  const { bestRow, worstRow } = useMemo(() => {
    if (!insights) return {}
    const eligible = insights.matchupStats.filter((row) => !row.smallSample)
    if (eligible.length === 0) return {}
    const sorted = [...eligible].sort((a, b) => b.winRate - a.winRate)
    return { bestRow: sorted[0], worstRow: sorted[sorted.length - 1] }
  }, [insights])

  const sortedBattlefields = useMemo(
    () => (insights ? sortRows(insights.battlefieldStats, battlefieldSort, 'battlefield') : []),
    [insights, battlefieldSort]
  )
  const sortedMatchups = useMemo(
    () => (insights ? sortRows(insights.matchupStats, matchupSort, 'opponentLegend') : []),
    [insights, matchupSort]
  )

  const selectedDeckName = deckId === 'all' ? null : decks.find((deck) => deck.id === deckId)?.name

  if (status === 'loading') {
    return (
      <div className="main">
        <p>Loading insights…</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="main">
        <p>Could not load insights. Check the main process console.</p>
      </div>
    )
  }

  const hasData = insights.totalDecidedMatches > 0

  return (
    <div className="main">
      <div className="topbar">
        <div>
          <h1>Insights</h1>
        </div>
      </div>

      <div className="insights-filter-bar">
        <div className="form-field">
          <span>Deck</span>
          <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
            <option value="all">All Decks</option>
            {sortedDecks.map((deck) => (
              <option key={deck.id} value={deck.id}>
                {deck.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!hasData ? (
        <div className="placeholder-panel">
          {selectedDeckName
            ? `No match data yet for "${selectedDeckName}". Log some matches to see insights here.`
            : 'No match data yet. Log some matches to see insights here.'}
        </div>
      ) : (
        <>
          <div className="section-label">Overall</div>
          <div className="insights-overview-row">
            <div className="insights-overall">
              <div className={`insights-headline-value ${rateClass(insights.winRate)}`}>
                {formatRate(insights.winRate)}
              </div>
              <div className="insights-overall-meta">
                <div className="insights-overall-record">
                  {insights.wins}-{insights.losses}
                </div>
                <div className="insights-overall-total">
                  {insights.totalDecidedMatches} decided match{insights.totalDecidedMatches === 1 ? '' : 'es'}
                </div>
              </div>
            </div>
            <div className="stat-cell insights-side-card">
              <div className="label">Last {insights.trend.recent.count}</div>
              <div className={`value ${rateClass(insights.trend.recent.winRate)}`}>
                {formatRate(insights.trend.recent.winRate)}
              </div>
            </div>
            <div className="stat-cell insights-side-card">
              <div className="label">Current Streak</div>
              <div className={`value ${streak ? (streak.result === 'win' ? 'pos' : 'neg') : ''}`}>
                {streak ? `${streak.result === 'win' ? 'W' : 'L'}${streak.count}` : '-'}
              </div>
            </div>
          </div>

          <div className="section-label">Seat Advantage</div>
          <div className="stat-strip stat-strip-2">
            <div className="stat-cell">
              <div className="label">Went 1st</div>
              <div className={`value ${rateClass(insights.seatStats.went_1st.winRate)}`}>
                {formatRate(insights.seatStats.went_1st.winRate)}
              </div>
              <div className="stat-cell-sub">({insights.seatStats.went_1st.total} games)</div>
            </div>
            <div className="stat-cell">
              <div className="label">Went 2nd</div>
              <div className={`value ${rateClass(insights.seatStats.went_2nd.winRate)}`}>
                {formatRate(insights.seatStats.went_2nd.winRate)}
              </div>
              <div className="stat-cell-sub">({insights.seatStats.went_2nd.total} games)</div>
            </div>
          </div>

          <div className="section-label">Battlefield Win Rate</div>
          {insights.battlefieldStats.length === 0 ? (
            <div className="placeholder-panel">No battlefield data recorded yet.</div>
          ) : (
            <>
              <div className="insights-table-controls">
                <SortControl value={battlefieldSort} onChange={setBattlefieldSort} />
              </div>
              <div className="insights-table">
                <div className="insights-table-header">
                  <div>Battlefield</div>
                  <div>Win Rate</div>
                  <div>Games</div>
                </div>
                {sortedBattlefields.map((row) => (
                  <div key={row.battlefield} className="insights-table-row">
                    <div className="insights-table-name">{row.battlefield}</div>
                    <div className={`insights-table-winrate ${rateClass(row.winRate)}`}>{formatRate(row.winRate)}</div>
                    <div className="insights-table-games">{row.total}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="section-label">Best / Worst Matchup</div>
          {!bestRow ? (
            <div className="insights-note">Not enough match data yet to highlight a best/worst matchup.</div>
          ) : (
            <div className="insights-bestworst-row">
              <div className="insights-bestworst-card insights-bestworst-best">
                <div className="label">Best Matchup</div>
                <div className="insights-bestworst-legend">{bestRow.opponentLegend}</div>
                <div className={`insights-bestworst-rate ${rateClass(bestRow.winRate)}`}>
                  {formatRate(bestRow.winRate)}
                </div>
                <div className="stat-cell-sub">({bestRow.total} games)</div>
              </div>
              <div className="insights-bestworst-card insights-bestworst-worst">
                <div className="label">Worst Matchup</div>
                <div className="insights-bestworst-legend">{worstRow.opponentLegend}</div>
                <div className={`insights-bestworst-rate ${rateClass(worstRow.winRate)}`}>
                  {formatRate(worstRow.winRate)}
                </div>
                <div className="stat-cell-sub">({worstRow.total} games)</div>
              </div>
            </div>
          )}

          <div className="section-label">Matchup Breakdown</div>
          {insights.matchupStats.length === 0 ? (
            <div className="placeholder-panel">No opponent legend data recorded yet.</div>
          ) : (
            <>
              <div className="insights-table-controls">
                <SortControl value={matchupSort} onChange={setMatchupSort} />
              </div>
              <div className="insights-table insights-table-matchups">
                <div className="insights-table-header">
                  <div>Opponent Legend</div>
                  <div>Win Rate</div>
                  <div>Games</div>
                </div>
                {sortedMatchups.map((row) => {
                  const isBest = row.opponentLegend === bestRow?.opponentLegend
                  const isWorst = row.opponentLegend === worstRow?.opponentLegend
                  return (
                    <div
                      key={row.opponentLegend}
                      className={`insights-table-row ${isBest ? 'insights-row-best' : ''} ${
                        isWorst ? 'insights-row-worst' : ''
                      }`}
                    >
                      <div className="insights-table-name">
                        {row.opponentLegend}
                        {isBest && <span className="insights-badge insights-badge-best">Best</span>}
                        {isWorst && <span className="insights-badge insights-badge-worst">Worst</span>}
                        {row.smallSample && <span className="insights-badge">Small sample</span>}
                      </div>
                      <div className={`insights-table-winrate ${rateClass(row.winRate)}`}>
                        {formatRate(row.winRate)}
                      </div>
                      <div className="insights-table-games">{row.total}</div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
