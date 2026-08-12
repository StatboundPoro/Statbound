import { useEffect, useState } from 'react'

// Free-text input with legend-name suggestions, used on deck_notes.scope
// (DeckNotes' "+ Add Matchup" field) and matches.opponent_legend
// (LogMatchModal). This is a UX assist only — it never locks input to the
// suggestion list. Any typed value is accepted as-is; the caller's existing
// value/onChange contract is unchanged from a plain <input type="text">.
export default function LegendAutocomplete({
  value,
  onChange,
  onKeyDown,
  placeholder,
  autoFocus,
  className
}) {
  const [legends, setLegends] = useState([])
  const [open, setOpen] = useState(false)

  // Fetched once on mount, then filtered client-side on every keystroke —
  // the list is tens of rows, not thousands, so there's no need to round-trip
  // through IPC per character typed. An empty/failed result just means no
  // suggestions ever show; the input still works as plain free text.
  useEffect(() => {
    let cancelled = false
    window.api.legends
      .list()
      .then((result) => {
        if (!cancelled) setLegends(result)
      })
      .catch((err) => {
        console.error('Failed to load legends:', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const query = value.trim().toLowerCase()
  const suggestions = query ? legends.filter((l) => l.name.toLowerCase().includes(query)) : []

  function handleSelect(name) {
    onChange(name)
    setOpen(false)
  }

  function handleKeyDown(e) {
    // Escape closes the suggestion dropdown first; only once it's already
    // closed does Escape fall through to the caller's own handler (e.g.
    // DeckNotes' "cancel add matchup" behavior).
    if (e.key === 'Escape' && open) {
      e.stopPropagation()
      setOpen(false)
      return
    }
    onKeyDown?.(e)
  }

  return (
    <div className={`legend-autocomplete ${className ?? ''}`}>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <ul className="legend-autocomplete-menu">
          {suggestions.map((legend) => (
            <li key={legend.id}>
              {/* onMouseDown (not onClick) + preventDefault fires before the
                  input's onBlur and keeps focus in the input, so selecting a
                  suggestion never races the blur-close above. */}
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleSelect(legend.name)
                }}
              >
                {legend.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
