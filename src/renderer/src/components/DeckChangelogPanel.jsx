import { useEffect, useRef, useState } from 'react'

// Buckets the already-ordered flat rows listDeckChangelogByDeck() returns
// (version_number DESC, added before removed within a version, diff order
// within each -- see deckChangelog.js) by version_id, preserving that
// order. Since rows for one version are always contiguous in the source
// list, this is a single pass with no re-sorting needed -- the first
// version encountered is already the most recent.
function groupByVersion(entries) {
  const groups = []
  const byVersion = new Map()

  for (const entry of entries) {
    let group = byVersion.get(entry.version_id)
    if (!group) {
      group = {
        versionId: entry.version_id,
        versionNumber: entry.version_number,
        createdAt: entry.created_at,
        entries: []
      }
      byVersion.set(entry.version_id, group)
      groups.push(group)
    }
    group.entries.push(entry)
  }

  return groups
}

function formatVersionNumber(versionNumber) {
  return `v${String(versionNumber).padStart(2, '0')}`
}

function ChangeLine({ entry }) {
  const isAdded = entry.change_type === 'added'
  return (
    <div className={`changelog-line ${isAdded ? 'changelog-line-added' : 'changelog-line-removed'}`}>
      {isAdded ? '+' : '-'} {entry.count}x {entry.card_name}
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
//
// Entries group by edit (a "version"), not by calendar date -- a deck's
// edits are numbered sequentially starting at v01, most recent first, and
// each version's header shows both its date and its version number so
// neither is lost.
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

  const versionGroups = groupByVersion(entries)

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
          {status === 'ready' && versionGroups.length === 0 && (
            <p className="changelog-empty">No changes tracked yet — edits made from now on will appear here.</p>
          )}
          {status === 'ready' &&
            versionGroups.map((group) => (
              <div key={group.versionId} className="changelog-version-group">
                <div className="changelog-version-header">
                  <span className="changelog-version-date">{new Date(group.createdAt).toLocaleDateString()}</span>
                  <span className="changelog-version-number">{formatVersionNumber(group.versionNumber)}</span>
                </div>
                {group.entries.map((entry) => (
                  <ChangeLine key={entry.id} entry={entry} />
                ))}
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
