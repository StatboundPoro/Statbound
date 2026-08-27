import { useEffect, useRef, useState } from 'react'

// Play Rate vs. Deck Count's full breakdown table (see
// src/main/cardPlayRate.js for the ratio formula and CLAUDE.md's Decision
// Log for why Main Deck + Champion are the only two sections counted).
// Same dismiss conventions as CardLightbox.jsx (outside click, close
// button, Escape) via the same .lightbox-backdrop overlay, but the content
// is a sortable data table, not an enlarged card image -- see styles.css's
// PLAYRATE LIGHTBOX rules for why this gets its own content styling closer
// to .modal than .lightbox-content.
const COLUMNS = [
  { key: 'cardName', label: 'Card', numeric: false },
  { key: 'copies', label: 'Copies', numeric: true },
  { key: 'timesPlayed', label: 'Times Played', numeric: true },
  { key: 'ratio', label: 'Play Rate', numeric: true }
]

function sortRows(rows, sortKey, sortDir) {
  const sorted = [...rows]
  sorted.sort((a, b) => {
    const cmp = sortKey === 'cardName' ? a.cardName.localeCompare(b.cardName) : a[sortKey] - b[sortKey]
    return sortDir === 'asc' ? cmp : -cmp
  })
  return sorted
}

export default function CardPlayRateBreakdown({ breakdown, deckName, onClose }) {
  const [sortKey, setSortKey] = useState('ratio')
  const [sortDir, setSortDir] = useState('asc')
  const contentRef = useRef(null)

  useEffect(() => {
    function handlePointerDown(e) {
      if (contentRef.current && !contentRef.current.contains(e.target)) onClose()
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  function handleSort(key) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sortedRows = sortRows(breakdown.rows, sortKey, sortDir)
  const lowestRatio = breakdown.rows.length > 0 ? Math.min(...breakdown.rows.map((r) => r.ratio)) : null
  const highestRatio = breakdown.rows.length > 0 ? Math.max(...breakdown.rows.map((r) => r.ratio)) : null

  return (
    <div className="lightbox-backdrop">
      <div className="playrate-lightbox-content" ref={contentRef}>
        <button
          type="button"
          className="lightbox-close playrate-lightbox-close"
          onClick={onClose}
          aria-label="Close"
          title="Close"
        >
          <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>

        <h2>Play Rate vs. Deck Count{deckName ? ` (${deckName})` : ''}</h2>
        <p className="playrate-lightbox-sub">
          Based on {breakdown.matchesWithCaptureData} logged match{breakdown.matchesWithCaptureData === 1 ? '' : 'es'} with
          captured play data. Play Rate is times played divided by copies times matches with capture data.
        </p>

        <div className="playrate-table-wrap">
          <table className="playrate-table">
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={col.numeric ? 'numeric' : ''}
                    onClick={() => handleSort(col.key)}
                    title={`Sort by ${col.label}`}
                  >
                    {col.label}
                    {sortKey === col.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const rowClasses = [
                  row.ratio === lowestRatio && 'playrate-row-lowest',
                  row.ratio === highestRatio && 'playrate-row-highest'
                ]
                  .filter(Boolean)
                  .join(' ')
                return (
                  <tr key={row.cardName} className={rowClasses}>
                    <td>{row.cardName}</td>
                    <td className="numeric">{row.copies}</td>
                    <td className="numeric">{row.timesPlayed}</td>
                    <td className="numeric">{Math.round(row.ratio * 100)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
