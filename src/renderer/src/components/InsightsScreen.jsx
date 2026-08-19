import { useEffect, useMemo, useRef, useState } from 'react'
import { computeMatchupBreakdown, computeStreak } from '../lib/stats.js'
import MatchupBreakdownTable from './MatchupBreakdownTable.jsx'

const DEFAULT_SORT = 'winRateDesc'

const SORT_OPTIONS = [
  { key: 'winRateDesc', label: 'WR% High → Low' },
  { key: 'winRateAsc', label: 'WR% Low → High' },
  { key: 'alpha', label: 'A–Z' }
]

// Shared by both Battlefield Win Rate and Matchup Breakdown: everything
// SORT_OPTIONS has, plus a "Most Games" option, so a battlefield/legend
// faced often (even at a mediocre win rate) can be surfaced ahead of one
// faced only once or twice with a headline-grabbing 100%/0% record.
const SORT_OPTIONS_WITH_GAMES = [...SORT_OPTIONS, { key: 'gamesDesc', label: 'Most Games' }]

function formatRate(rate) {
  return rate === null ? '-' : `${rate}%`
}

function rateClass(rate) {
  if (rate === null) return ''
  return rate >= 50 ? 'pos' : 'neg'
}

// Battlefield Win Rate's own sort — win rate desc/asc, alphabetical by
// battlefield name, or most games played (`total`, descending). Every row
// here always has a real (non-null) winRate and a real `total`, since
// getInsights() only ever creates a battlefield row once at least one
// decided game exists for it — no null-handling needed here the way
// sortMatchupRows below needs for its own win-rate sorts.
function sortRows(rows, sortKey, nameKey) {
  const sorted = [...rows]
  if (sortKey === 'winRateAsc') {
    sorted.sort((a, b) => a.winRate - b.winRate)
  } else if (sortKey === 'alpha') {
    sorted.sort((a, b) => a[nameKey].localeCompare(b[nameKey]))
  } else if (sortKey === 'gamesDesc') {
    sorted.sort((a, b) => b.total - a.total)
  } else {
    sorted.sort((a, b) => b.winRate - a.winRate)
  }
  return sorted
}

// Matchup Breakdown's own counterpart to sortRows above — can't reuse it
// as-is because, unlike a battlefield row, a matchup row from
// computeMatchupBreakdown() can have a null winRate (a legend faced only
// in still-undecided matches, e.g. an incomplete Bo3, kept in the table
// via Unknown Legend bucketing's "don't silently drop it" principle rather
// than excluded outright). A null-winRate row always sinks to the end
// under either win-rate sort direction, the same "no known value always
// sinks to the end regardless of direction" convention Deck Detail's own
// Grid view cost sort already uses for a still-resolving card's cost — but
// stays in its natural position under the alphabetical sort, since that
// one doesn't care about winRate at all. `gamesDesc` (Most Games) needs no
// such null-handling — gamesPlayed is always a real number, never null.
function sortMatchupRows(rows, sortKey) {
  const sorted = [...rows]
  if (sortKey === 'alpha') {
    sorted.sort((a, b) => a.legend.localeCompare(b.legend))
    return sorted
  }
  if (sortKey === 'gamesDesc') {
    sorted.sort((a, b) => b.gamesPlayed - a.gamesPlayed)
    return sorted
  }
  sorted.sort((a, b) => {
    if (a.winRate === null && b.winRate === null) return 0
    if (a.winRate === null) return 1
    if (b.winRate === null) return -1
    return sortKey === 'winRateAsc' ? a.winRate - b.winRate : b.winRate - a.winRate
  })
  return sorted
}

function SortControl({ value, onChange, options = SORT_OPTIONS }) {
  return (
    <div className="segmented">
      {options.map((opt) => (
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
// one, via the filter dropdown), and the sole place in the app the Matchup
// Breakdown table (record/streak/expandable per-match history per opponent
// legend) is shown — Deck Detail's own former embedded copy of this table
// was removed in favor of its "View Insights" deep link, which lands here
// pre-scoped to that deck (see the initialDeckId comment below). Overall
// win rate, trend, seat advantage, and battlefield win rate are computed
// on read by insights:get/getInsights() in src/main/insights.js; this
// component renders whatever shape that returns and sorts Battlefield Win
// Rate client-side (see sortRows above — getInsights() itself has no
// opinion on display order). Matchup Breakdown is different: it's computed
// entirely client-side from the raw matches list via computeMatchupBreakdown()
// in lib/stats.js (see insights.js's own doc comment for why), sorted via
// sortMatchupRows above, and figures out which single matchup (if any)
// counts as "best"/"worst" for the highlight treatment and the summary
// cards above the table — see the bestRow/worstRow useMemo below for why
// that's a renderer-side decision rather than something the backend bakes
// in.
//
// `initialDeckId` is optional and only ever set by Deck Detail's "View
// Insights" button (App.jsx's handleViewDeckInsights) as a one-time deep
// link — App.jsx fully unmounts this component whenever `screen` leaves
// 'insights', so a plain useState initializer is enough to pick it up on
// every fresh visit; no prop-sync effect is needed. Reaching this screen
// via the Sidebar nav item instead always passes no prop, landing on "All
// Decks" as before. It's also the trigger for the one-time auto-scroll
// down to Matchup Breakdown below (see the scroll effect near the bottom
// of this component) — that section is exactly what Deck Detail's own
// former Matchup Record section used to show inline, and it now sits
// several sections down the page, so a deck-scoped deep link jumps
// straight to it instead of leaving the user to scroll past Overview/Seat
// Advantage/Battlefield Win Rate/Best-Worst first.
export default function InsightsScreen({ initialDeckId = null }) {
  const [decks, setDecks] = useState([])
  const [matches, setMatches] = useState([])
  const [deckId, setDeckId] = useState(initialDeckId ?? 'all')
  const [insights, setInsights] = useState(null)
  const [status, setStatus] = useState('loading')
  const [battlefieldSort, setBattlefieldSort] = useState(DEFAULT_SORT)
  const [matchupSort, setMatchupSort] = useState(DEFAULT_SORT)
  const matchupSectionRef = useRef(null)
  const hasAutoScrolled = useRef(false)

  useEffect(() => {
    window.api.decks
      .list()
      .then(setDecks)
      .catch((err) => console.error('Failed to load decks:', err))
  }, [])

  // Fetched separately from insights:get: partly to compute the Current
  // Streak box the same way Deck Detail already does (via computeStreak()
  // in stats.js, reusing that logic rather than re-deriving a streak from
  // getInsights()'s aggregated numbers, which don't preserve per-match
  // order/detail anyway), and partly because the Matchup Breakdown table
  // below is now computed entirely client-side from this same raw list
  // (computeMatchupBreakdown() in stats.js) rather than from insights:get
  // — see insights.js's own doc comment for why that moved out of main.
  // Exposed as a function (not just fired once) so a match edited/deleted
  // from inside the Matchup Breakdown table's expanded rows can refetch
  // both this and the aggregate insights below, rather than leaving either
  // showing stale data.
  function refetchMatches() {
    return window.api.matches
      .list()
      .then(setMatches)
      .catch((err) => console.error('Failed to load matches:', err))
  }

  useEffect(() => {
    refetchMatches()
  }, [])

  function refetchInsights() {
    return window.api.insights
      .get({ deckId: deckId === 'all' ? null : deckId })
      .then(setInsights)
      .catch((err) => console.error('Failed to load insights:', err))
  }

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

  function handleMatchupTableChanged() {
    refetchMatches()
    refetchInsights()
  }

  // A sort order chosen for the previous deck's dataset isn't necessarily
  // meaningful for a newly-filtered one, so both tables snap back to the
  // default whenever the deck filter changes rather than persisting a
  // stale order.
  useEffect(() => {
    setBattlefieldSort(DEFAULT_SORT)
    setMatchupSort(DEFAULT_SORT)
  }, [deckId])

  const sortedDecks = useMemo(() => [...decks].sort((a, b) => a.name.localeCompare(b.name)), [decks])
  const decksById = useMemo(() => new Map(decks.map((deck) => [deck.id, deck])), [decks])
  const resolveDeckName = (match) => decksById.get(match.deck_id)?.name ?? 'Unknown Deck'

  // matches:list() already returns played_at DESC (matches.js's natural
  // order), and computeStreak()/computeMatchupBreakdown() both require
  // most-recent-first input — so a plain .filter() here (no re-sort) keeps
  // that ordering intact, the same way DeckDetail.jsx already relies on it.
  const scopedMatches = useMemo(
    () => (deckId === 'all' ? matches : matches.filter((m) => m.deck_id === deckId)),
    [matches, deckId]
  )
  const streak = useMemo(() => computeStreak(scopedMatches), [scopedMatches])
  const matchupRows = useMemo(() => computeMatchupBreakdown(scopedMatches), [scopedMatches])

  // Highlighting (both the summary cards and the table's highlighted row)
  // only makes sense among matchups with enough games to mean something —
  // a 1-0 record shouldn't out-rank a real 14-6 one just because 100% >
  // 70%. If every matchup is small-sample (or has no decided matches at
  // all yet), there's nothing eligible to highlight. bestRow/worstRow are
  // the single source of truth for both the summary cards and the table's
  // highlighted row, so the two can never disagree.
  const { bestRow, worstRow } = useMemo(() => {
    const eligible = matchupRows.filter((row) => !row.smallSample)
    if (eligible.length === 0) return {}
    const sorted = [...eligible].sort((a, b) => b.winRate - a.winRate)
    return { bestRow: sorted[0], worstRow: sorted[sorted.length - 1] }
  }, [matchupRows])

  const sortedBattlefields = useMemo(
    () => (insights ? sortRows(insights.battlefieldStats, battlefieldSort, 'battlefield') : []),
    [insights, battlefieldSort]
  )
  const sortedMatchupRows = useMemo(() => sortMatchupRows(matchupRows, matchupSort), [matchupRows, matchupSort])

  const selectedDeckName = deckId === 'all' ? null : decks.find((deck) => deck.id === deckId)?.name

  // Fires once, only for a deck-scoped deep link (see the initialDeckId
  // comment above this component), the first time this screen actually has
  // real data to show — a status still stuck on 'loading'/'error', or a
  // hasData-less placeholder state, has nothing to scroll to yet.
  useEffect(() => {
    if (!initialDeckId || hasAutoScrolled.current) return
    if (status !== 'ready' || !insights || insights.totalDecidedMatches === 0) return
    hasAutoScrolled.current = true
    matchupSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [initialDeckId, status, insights])

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
                <SortControl value={battlefieldSort} onChange={setBattlefieldSort} options={SORT_OPTIONS_WITH_GAMES} />
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
                <div className="insights-bestworst-legend">{bestRow.legend}</div>
                <div className={`insights-bestworst-rate ${rateClass(Math.round(bestRow.winRate * 100))}`}>
                  {formatRate(Math.round(bestRow.winRate * 100))}
                </div>
                <div className="stat-cell-sub">({bestRow.gamesPlayed} games)</div>
              </div>
              <div className="insights-bestworst-card insights-bestworst-worst">
                <div className="label">Worst Matchup</div>
                <div className="insights-bestworst-legend">{worstRow.legend}</div>
                <div className={`insights-bestworst-rate ${rateClass(Math.round(worstRow.winRate * 100))}`}>
                  {formatRate(Math.round(worstRow.winRate * 100))}
                </div>
                <div className="stat-cell-sub">({worstRow.gamesPlayed} games)</div>
              </div>
            </div>
          )}

          <div className="section-label" ref={matchupSectionRef}>
            Matchup Breakdown
          </div>
          {matchupRows.length === 0 ? (
            <div className="placeholder-panel">No opponent legend data recorded yet.</div>
          ) : (
            <>
              <div className="insights-table-controls">
                <SortControl value={matchupSort} onChange={setMatchupSort} options={SORT_OPTIONS_WITH_GAMES} />
              </div>
              <MatchupBreakdownTable
                rows={sortedMatchupRows}
                bestLegend={bestRow?.legend}
                worstLegend={worstRow?.legend}
                resolveDeckName={resolveDeckName}
                onChanged={handleMatchupTableChanged}
                emptyMessage="No opponent legend data recorded yet."
              />
            </>
          )}
        </>
      )}
    </div>
  )
}
