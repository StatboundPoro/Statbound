import { useEffect, useRef, useState } from 'react'
import { domainColor } from '../lib/domains.jsx'
import { MatchupMatchesTable } from './MatchupRecord.jsx'
import MatchDetailModal from './MatchDetailModal.jsx'

// Same fury -> calm hex values as :root's --fury/--calm in styles.css,
// hardcoded here (not read via getComputedStyle) since the heatmap needs
// to numerically interpolate between them, not just reference them as a
// CSS value — the same "hardcoded, kept in sync by hand" tradeoff
// lib/appMark.jsx already makes for its own crest colors. Keep these in
// sync if the palette ever changes.
const HEAT_LOW = [214, 72, 63] // --fury
const HEAT_HIGH = [76, 158, 104] // --calm

function heatmapBackground(winRate) {
  const t = Math.max(0, Math.min(1, winRate / 100))
  const [r, g, b] = HEAT_LOW.map((low, i) => Math.round(low + (HEAT_HIGH[i] - low) * t))
  return `rgba(${r}, ${g}, ${b}, 0.38)`
}

const POPOVER_WIDTH = 340

// Matchup Matrix — a standalone, cross-deck screen: every deck (columns)
// that has logged at least one match, against every opponent Legend (rows)
// actually faced across ANY deck, no deck-scoping anywhere. Structurally
// different from Deck Detail's own Matchup Record (one deck vs. many
// legends) — see src/main/matchupMatrix.js's getMatchupMatrix() for the
// aggregation this renders, computed fresh on every fetch, same "derive on
// read" approach the rest of the app uses. Small-sample handling reuses
// Insights' Matchup Breakdown's own 5+ games convention (getMatchupMatrix's
// SMALL_SAMPLE_THRESHOLD) rather than introducing a second one.
//
// Decks run across the top (usually the shorter axis — most collections
// have far fewer decks than opponent Legends faced) and Legends run down
// the side, so the sticky column of row labels stays a manageable width
// even as more Legends are faced over time.
export default function MatchupMatrixScreen() {
  const [matrix, setMatrix] = useState(null)
  const [status, setStatus] = useState('loading')
  const [popover, setPopover] = useState(null)
  const [selectedMatchId, setSelectedMatchId] = useState(null)
  const popoverRef = useRef(null)

  function refetch() {
    return window.api.matchupMatrix
      .get()
      .then((result) => {
        setMatrix(result)
        setStatus('ready')
      })
      .catch((err) => {
        console.error('Failed to load the matchup matrix:', err)
        setStatus('error')
      })
  }

  useEffect(() => {
    refetch()
  }, [])

  // Outside click / Escape close the popover, the same convention
  // LegendAutocomplete's suggestion dropdown and Sidebar's popovers
  // already use elsewhere in the app.
  useEffect(() => {
    if (!popover) return
    function handlePointerDown(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setPopover(null)
      }
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') setPopover(null)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [popover])

  function openPopover(e, deck, legend, cell) {
    const rect = e.currentTarget.getBoundingClientRect()
    let left = rect.left
    if (left + POPOVER_WIDTH > window.innerWidth - 16) {
      left = Math.max(16, rect.right - POPOVER_WIDTH)
    }
    setPopover({ deckId: deck.id, deckName: deck.name, legend, cell, left, top: rect.bottom + 8 })
  }

  // An edit/delete inside the drill-down changes the very matches this
  // screen aggregates, so the whole matrix is refetched — and since the
  // popover's snapshot of that cell's matches would otherwise go stale, it
  // closes rather than keep showing pre-edit data.
  function handleMatchChanged() {
    setPopover(null)
    refetch()
  }

  if (status === 'loading') {
    return (
      <div className="main">
        <p>Loading matchup matrix…</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="main">
        <p>Could not load the matchup matrix. Check the main process console.</p>
      </div>
    )
  }

  return (
    <div className="main">
      <div className="topbar">
        <div>
          <h1>Matchup Matrix</h1>
        </div>
      </div>

      {matrix.decks.length === 0 ? (
        <div className="placeholder-panel">No matches logged yet. Log a match to start building your matchup matrix.</div>
      ) : matrix.legends.length === 0 ? (
        <div className="placeholder-panel">No opponent legend data recorded yet.</div>
      ) : (
        <div className="matrix-scroll">
          <table className="matrix-table">
            <thead>
              <tr>
                <th className="matrix-corner">Legend</th>
                {matrix.decks.map((deck) => (
                  <th key={deck.id} className="matrix-col-header">
                    <div className="matrix-deck-name">
                      <span
                        className="matrix-deck-swatch"
                        style={{
                          background: `linear-gradient(135deg, ${domainColor(deck.domain_1)} 50%, ${domainColor(
                            deck.domain_2
                          )} 50%)`
                        }}
                      />
                      <span className="matrix-deck-name-text">{deck.name}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.legends.map((legend) => (
                <tr key={legend}>
                  <th scope="row" className="matrix-row-header">
                    {legend}
                  </th>
                  {matrix.decks.map((deck) => {
                    const cell = matrix.cells[deck.id]?.[legend]
                    if (!cell) {
                      return (
                        <td key={deck.id}>
                          <div className="matrix-cell matrix-cell-empty" />
                        </td>
                      )
                    }
                    return (
                      <td key={deck.id}>
                        <button
                          type="button"
                          className="matrix-cell"
                          style={{ background: heatmapBackground(cell.winRate) }}
                          onClick={(e) => openPopover(e, deck, legend, cell)}
                          title={`${deck.name} vs ${legend}: ${cell.wins}-${cell.losses} (${cell.winRate}%)`}
                        >
                          {cell.winRate}%
                          {cell.smallSample && <span className="matrix-cell-badge" title="Small sample (fewer than 5 games)" />}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {popover && (
        <div ref={popoverRef} className="matrix-popover" style={{ left: popover.left, top: popover.top }}>
          <div className="matrix-popover-header">
            <div className="matrix-popover-deck">{popover.deckName}</div>
            <div className="matrix-popover-legend">vs {popover.legend}</div>
          </div>
          <div className="matrix-popover-summary">
            <span className={`matrix-popover-rate ${popover.cell.winRate >= 50 ? 'pos' : 'neg'}`}>
              {popover.cell.winRate}%
            </span>
            <span className="matrix-popover-record">
              {popover.cell.wins}-{popover.cell.losses}
            </span>
            {popover.cell.smallSample && <span className="insights-badge">Small sample</span>}
          </div>
          <div className="matrix-popover-matches">
            <MatchupMatchesTable matches={popover.cell.matches} deckName={popover.deckName} onSelectMatch={setSelectedMatchId} />
          </div>
        </div>
      )}

      {selectedMatchId && (
        <MatchDetailModal matchId={selectedMatchId} onClose={() => setSelectedMatchId(null)} onChanged={handleMatchChanged} />
      )}
    </div>
  )
}
