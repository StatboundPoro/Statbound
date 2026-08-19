import { useEffect, useRef, useState } from 'react'

const SECTION_LABELS = {
  mainDeck: 'Main Deck',
  battlefields: 'Battlefields',
  runes: 'Runes',
  sideboard: 'Sideboard'
}
const SECTION_ORDER = ['mainDeck', 'battlefields', 'runes', 'sideboard']

// Groups already-DESC-ordered rows (see deckChangelog.js's
// listDeckChangelogByDeck) by calendar date, preserving the order dates are
// first encountered -- which is already most-recent-first, since the rows
// themselves arrive that way. Multiple edits made on the same calendar day
// land under one shared date heading, by design (see CLAUDE.md's Deck
// Changelog entry).
function groupByDate(entries) {
  const groups = []
  const byDate = new Map()

  for (const entry of entries) {
    const dateKey = new Date(entry.created_at).toLocaleDateString()
    let group = byDate.get(dateKey)
    if (!group) {
      group = { dateKey, entries: [] }
      byDate.set(dateKey, group)
      groups.push(group)
    }
    group.entries.push(entry)
  }

  return groups
}

// Sub-groups one date's entries by section, in a fixed display order,
// dropping any section with nothing changed that day.
function groupBySection(entries) {
  const bySection = new Map(SECTION_ORDER.map((section) => [section, []]))
  for (const entry of entries) {
    bySection.get(entry.section)?.push(entry)
  }
  return SECTION_ORDER.map((section) => [section, bySection.get(section)]).filter(([, list]) => list.length > 0)
}

function ChangeLine({ entry }) {
  if (entry.change_type === 'added') {
    return <div className="changelog-line changelog-line-added">+ {entry.card_name}</div>
  }
  if (entry.change_type === 'removed') {
    return <div className="changelog-line changelog-line-removed">- {entry.card_name}</div>
  }
  return (
    <div className="changelog-line changelog-line-changed">
      {entry.card_name}: {entry.old_count} &rarr; {entry.new_count}
    </div>
  )
}

// Slide-out panel from the right edge of the screen, overlaying Deck
// Detail's content rather than navigating away -- the first use of this UI
// pattern in the app (see CLAUDE.md's Current State entry if a future
// feature wants to reuse it). Dismissible via its own close button, an
// outside click, or Escape -- the same convention the Matchup Matrix's
// drill-down popover and LegendAutocomplete's suggestion dropdown already
// establish elsewhere in the app.
export default function DeckChangelogPanel({ deckId, onClose }) {
  const [entries, setEntries] = useState([])
  const [status, setStatus] = useState('loading')
  const panelRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')

    window.api.deckChangelog
      .list(deckId)
      .then((result) => {
        if (cancelled) return
        setEntries(result)
        setStatus('ready')
      })
      .catch((err) => {
        console.error('Failed to load deck changelog:', err)
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [deckId])

  useEffect(() => {
    function handlePointerDown(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        onClose()
      }
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

  const dateGroups = groupByDate(entries)

  return (
    <div className="changelog-backdrop">
      <div className="changelog-panel" ref={panelRef}>
        <div className="changelog-panel-header">
          <h2>Changelog</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="changelog-panel-body">
          {status === 'loading' && <p className="changelog-empty">Loading…</p>}
          {status === 'error' && <p className="changelog-empty">Could not load this deck's changelog.</p>}
          {status === 'ready' && dateGroups.length === 0 && (
            <p className="changelog-empty">No changes tracked yet — edits made from now on will appear here.</p>
          )}
          {status === 'ready' &&
            dateGroups.map((group) => (
              <div key={group.dateKey} className="changelog-date-group">
                <div className="changelog-date-heading">{group.dateKey}</div>
                {groupBySection(group.entries).map(([section, sectionEntries]) => (
                  <div key={section} className="changelog-section">
                    <div className="changelog-section-title">{SECTION_LABELS[section]}</div>
                    {sectionEntries.map((entry) => (
                      <ChangeLine key={entry.id} entry={entry} />
                    ))}
                  </div>
                ))}
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
