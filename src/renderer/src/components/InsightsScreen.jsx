import { useEffect, useMemo, useState } from 'react'

function formatRate(rate) {
  return rate === null ? '—' : `${rate}%`
}

function rateClass(rate) {
  if (rate === null) return ''
  return rate >= 50 ? 'pos' : 'neg'
}

// Insights — the rail-nav screen for aggregate stats across every deck (or
// one, via the filter dropdown). Everything here is computed on read by
// insights:get/getInsights() in src/main/insights.js; this component just
// renders whatever shape that returns, plus figuring out which single
// matchup (if any) counts as "best"/"worst" for the highlight treatment —
// see findBestWorst below for why that's a renderer-side decision rather
// than something the backend bakes into the response.
export default function InsightsScreen() {
  const [decks, setDecks] = useState([])
  const [deckId, setDeckId] = useState('all')
  const [insights, setInsights] = useState(null)
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    window.api.decks
      .list()
      .then(setDecks)
      .catch((err) => console.error('Failed to load decks:', err))
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

  // Highlighting only makes sense among matchups with enough games to mean
  // something — a 1-0 record shouldn't out-rank a real 14-6 one just
  // because 100% > 70%. If every matchup is small-sample, there's nothing
  // eligible to highlight at all.
  const { bestLegend, worstLegend } = useMemo(() => {
    if (!insights) return {}
    const eligible = insights.matchupStats.filter((row) => !row.smallSample)
    if (eligible.length === 0) return {}
    const sorted = [...eligible].sort((a, b) => b.winRate - a.winRate)
    return {
      bestLegend: sorted[0].opponentLegend,
      worstLegend: sorted[sorted.length - 1].opponentLegend
    }
  }, [insights])

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
          <div className="sub">Aggregate stats computed from your match history — nothing here is stored.</div>
        </div>
      </div>

      <div className="insights-filter-bar">
        <div className="form-field">
          <span>Deck</span>
          <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
            <option value="all">All Decks</option>
            {decks.map((deck) => (
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
            ? `No match data yet for "${selectedDeckName}" — log some matches to see insights here.`
            : 'No match data yet — log some matches to see insights here.'}
        </div>
      ) : (
        <>
          <div className="section-label">Overall</div>
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

          <div className="insights-trend">
            Last {insights.trend.recent.count}:{' '}
            <strong className={rateClass(insights.trend.recent.winRate)}>
              {formatRate(insights.trend.recent.winRate)}
            </strong>
            {'  —  '}
            All-time:{' '}
            <strong className={rateClass(insights.trend.allTime.winRate)}>
              {formatRate(insights.trend.allTime.winRate)}
            </strong>
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
            <div className="insights-table">
              <div className="insights-table-header">
                <div>Battlefield</div>
                <div>Win Rate</div>
                <div>Games</div>
              </div>
              {insights.battlefieldStats.map((row) => (
                <div key={row.battlefield} className="insights-table-row">
                  <div className="insights-table-name">{row.battlefield}</div>
                  <div className={`insights-table-winrate ${rateClass(row.winRate)}`}>{formatRate(row.winRate)}</div>
                  <div className="insights-table-games">{row.total}</div>
                </div>
              ))}
            </div>
          )}

          <div className="section-label">Matchup Breakdown</div>
          {insights.matchupStats.length === 0 ? (
            <div className="placeholder-panel">No opponent legend data recorded yet.</div>
          ) : (
            <>
              {!bestLegend && (
                <div className="insights-note">
                  Not enough match data yet to highlight a best/worst matchup.
                </div>
              )}
              <div className="insights-table insights-table-matchups">
                <div className="insights-table-header">
                  <div>Opponent Legend</div>
                  <div>Win Rate</div>
                  <div>Games</div>
                </div>
                {insights.matchupStats.map((row) => {
                  const isBest = row.opponentLegend === bestLegend
                  const isWorst = row.opponentLegend === worstLegend
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
