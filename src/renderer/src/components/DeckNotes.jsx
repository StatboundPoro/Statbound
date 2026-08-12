import { useEffect, useState } from 'react'
import LegendAutocomplete from './LegendAutocomplete'

const GENERAL_SCOPE = 'general'

const FIXED_CATEGORIES = [
  {
    key: 'general',
    title: 'General Notes',
    empty: 'No general notes yet. Jot down anything worth remembering about this deck.'
  },
  {
    key: 'mulligan',
    title: 'Mulligan Notes',
    empty: 'No mulligan notes yet. What do you look for in an opening hand?'
  },
  {
    key: 'game_plan',
    title: 'Game Plan',
    empty: 'Add your game plan for this deck.'
  }
]

// Renders note content as plain paragraphs, except a run of consecutive
// lines starting with "-" or "*" which becomes a real <ul> — the "simple
// bullet-point support" called for alongside preserved line breaks. Editing
// still works on the raw text (typing "- " makes a bullet), so there's no
// separate rich-text state to keep in sync.
function renderContent(content) {
  const lines = (content ?? '').split('\n')
  const isBulletLine = (line) => /^\s*[-*]\s+/.test(line)

  const blocks = []
  let currentList = null

  lines.forEach((line, index) => {
    if (isBulletLine(line)) {
      if (!currentList) {
        currentList = []
        blocks.push({ type: 'list', items: currentList })
      }
      currentList.push(line.replace(/^\s*[-*]\s+/, ''))
    } else {
      currentList = null
      blocks.push({ type: 'line', text: line, key: index })
    }
  })

  return blocks.map((block, i) =>
    block.type === 'list' ? (
      <ul key={i} className="note-bullets">
        {block.items.map((item, j) => (
          <li key={j}>{item}</li>
        ))}
      </ul>
    ) : (
      <p key={i} className="note-line">
        {block.text || ' '}
      </p>
    )
  )
}

// One saved note. `showTitle` switches on the extra title input/display
// used only by custom notes — everything else (content, edit/delete) is
// shared with the four fixed categories and the per-battlefield slots.
function NoteEntry({ note, showTitle, onSave, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [draftContent, setDraftContent] = useState(note.content)
  const [draftTitle, setDraftTitle] = useState(note.custom_title ?? '')
  const [saving, setSaving] = useState(false)

  function cancelEdit() {
    setDraftContent(note.content)
    setDraftTitle(note.custom_title ?? '')
    setEditing(false)
  }

  async function handleSave() {
    setSaving(true)
    try {
      await onSave(note.id, showTitle ? { content: draftContent, custom_title: draftTitle } : { content: draftContent })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="note-entry note-entry-editing">
        {showTitle && (
          <input
            type="text"
            className="note-title-input"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="Title…"
            autoFocus
          />
        )}
        <textarea
          className="notes-textarea note-entry-textarea"
          value={draftContent}
          onChange={(e) => setDraftContent(e.target.value)}
          rows={4}
          autoFocus={!showTitle}
        />
        <div className="note-entry-actions">
          <button className="btn" onClick={cancelEdit} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="note-entry">
      {showTitle && <div className="note-entry-title">{note.custom_title || 'Untitled'}</div>}
      <div className="note-entry-content">{renderContent(note.content)}</div>
      <div className="note-entry-footer">
        <button type="button" className="note-entry-link" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button type="button" className="note-entry-link danger" onClick={() => onDelete(note.id)}>
          Delete
        </button>
      </div>
    </div>
  )
}

// Inline "new note" form appended below a category's existing notes.
function NewNoteComposer({ onCancel, onCreate, placeholder, showTitle }) {
  const [content, setContent] = useState('')
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)

  const canSave = content.trim().length > 0 || (showTitle && title.trim().length > 0)

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    try {
      await onCreate({ content: content.trim(), custom_title: title.trim() })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="note-entry note-entry-editing">
      {showTitle && (
        <input
          type="text"
          className="note-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title…"
          autoFocus
        />
      )}
      <textarea
        className="notes-textarea note-entry-textarea"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={4}
        placeholder={placeholder}
        autoFocus={!showTitle}
      />
      <div className="note-entry-actions">
        <button className="btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving || !canSave}>
          {saving ? 'Saving…' : 'Add Note'}
        </button>
      </div>
    </div>
  )
}

function CategorySection({
  title,
  emptyPrompt,
  notes,
  composerOpen,
  onAddClick,
  onCancelCompose,
  onCreateNote,
  onSaveNote,
  onDeleteNote
}) {
  return (
    <div className="note-category">
      <div className="note-category-header">
        <div className="note-category-title">{title}</div>
        <button type="button" className="note-add-btn" onClick={onAddClick} aria-label={`Add ${title}`}>
          +
        </button>
      </div>
      {notes.length === 0 && !composerOpen && <div className="note-empty">{emptyPrompt}</div>}
      {notes.map((note) => (
        <NoteEntry key={note.id} note={note} onSave={onSaveNote} onDelete={onDeleteNote} />
      ))}
      {composerOpen && (
        <NewNoteComposer onCancel={onCancelCompose} onCreate={onCreateNote} placeholder="Write a note…" />
      )}
    </div>
  )
}

// Notes section on Deck Detail, replacing the old "Prep Notes" placeholder.
// Notes are organized into "sets" (a scope) — General by default, or a
// specific opponent matchup added via free-text legend name — and within a
// scope into five categories: the three fixed freeform ones, one slot per
// this deck's actual named Battlefields, and open-ended custom-titled notes.
// A matchup scope only persists once its first note is saved (there's no
// separate "matchups" table — see deckNotes.js) — until then it's just
// local state, cleared if the page is left without writing anything to it.
export default function DeckNotes({ deckId, battlefields }) {
  const [notes, setNotes] = useState([])
  const [status, setStatus] = useState('loading')
  const [scope, setScope] = useState(GENERAL_SCOPE)
  const [pendingScopes, setPendingScopes] = useState([])
  const [addMatchupOpen, setAddMatchupOpen] = useState(false)
  const [addMatchupValue, setAddMatchupValue] = useState('')
  const [openComposers, setOpenComposers] = useState({})

  useEffect(() => {
    let cancelled = false
    setStatus('loading')

    window.api.deckNotes
      .list(deckId)
      .then((result) => {
        if (cancelled) return
        setNotes(result)
        setStatus('ready')
      })
      .catch((err) => {
        console.error('Failed to load deck notes:', err)
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [deckId])

  // Composer state is keyed by category (or "battlefield:<name>" / "custom"),
  // not by scope — reset it on scope change so switching matchups doesn't
  // leave a stale "new note" form open against the wrong set.
  useEffect(() => {
    setOpenComposers({})
  }, [scope])

  const persistedMatchupScopes = Array.from(
    new Set(notes.filter((n) => n.scope !== GENERAL_SCOPE).map((n) => n.scope))
  )
  const matchupScopes = Array.from(new Set([...persistedMatchupScopes, ...pendingScopes])).sort((a, b) =>
    a.localeCompare(b)
  )

  function notesFor(category, extra) {
    return notes.filter((n) => n.scope === scope && n.category === category && (extra ? extra(n) : true))
  }

  function toggleComposer(key) {
    setOpenComposers((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function makeCreateHandler(category, extraFields, composerKey) {
    return async ({ content, custom_title }) => {
      const created = await window.api.deckNotes.create({
        deck_id: deckId,
        scope,
        category,
        content,
        custom_title,
        ...extraFields
      })
      setNotes((prev) => [...prev, created])
      setOpenComposers((prev) => ({ ...prev, [composerKey]: false }))
      setPendingScopes((prev) => prev.filter((s) => s !== scope))
    }
  }

  async function handleSaveNote(id, patch) {
    const updated = await window.api.deckNotes.update(id, patch)
    setNotes((prev) => prev.map((n) => (n.id === id ? updated : n)))
  }

  async function handleDeleteNote(id) {
    await window.api.deckNotes.delete(id)
    setNotes((prev) => prev.filter((n) => n.id !== id))
  }

  function handleAddMatchupConfirm() {
    const name = addMatchupValue.trim()
    setAddMatchupOpen(false)
    setAddMatchupValue('')
    if (!name) return

    if (name.toLowerCase() === GENERAL_SCOPE) {
      setScope(GENERAL_SCOPE)
      return
    }
    const existing = matchupScopes.find((s) => s.toLowerCase() === name.toLowerCase())
    if (existing) {
      setScope(existing)
      return
    }

    setPendingScopes((prev) => [...prev, name])
    setScope(name)
  }

  if (status === 'loading') {
    return <div className="placeholder-panel">Loading notes…</div>
  }
  if (status === 'error') {
    return <div className="placeholder-panel">Could not load notes. Check the main process console.</div>
  }

  return (
    <div className="deck-notes">
      <div className="notes-scope-bar">
        <select className="notes-scope-select" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value={GENERAL_SCOPE}>General Notes</option>
          {matchupScopes.map((s) => (
            <option key={s} value={s}>
              vs {s}
            </option>
          ))}
        </select>
        {!addMatchupOpen ? (
          <button type="button" className="btn" onClick={() => setAddMatchupOpen(true)}>
            + Add Matchup
          </button>
        ) : (
          <div className="notes-add-matchup-form">
            <LegendAutocomplete
              value={addMatchupValue}
              onChange={setAddMatchupValue}
              placeholder="Opponent legend…"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddMatchupConfirm()
                } else if (e.key === 'Escape') {
                  setAddMatchupOpen(false)
                  setAddMatchupValue('')
                }
              }}
            />
            <button type="button" className="btn btn-primary" onClick={handleAddMatchupConfirm}>
              Add
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setAddMatchupOpen(false)
                setAddMatchupValue('')
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {FIXED_CATEGORIES.map(({ key, title, empty }) => (
        <CategorySection
          key={key}
          title={title}
          emptyPrompt={empty}
          notes={notesFor(key)}
          composerOpen={!!openComposers[key]}
          onAddClick={() => toggleComposer(key)}
          onCancelCompose={() => toggleComposer(key)}
          onCreateNote={makeCreateHandler(key, {}, key)}
          onSaveNote={handleSaveNote}
          onDeleteNote={handleDeleteNote}
        />
      ))}

      <div className="note-category">
        <div className="note-category-header">
          <div className="note-category-title">Battlefield Notes</div>
        </div>
        {battlefields.length === 0 ? (
          <div className="note-empty">This deck has no named Battlefields yet.</div>
        ) : (
          <div className="note-battlefield-grid">
            {battlefields.map((name) => {
              const composerKey = `battlefield:${name}`
              const slotNotes = notesFor('battlefield', (n) => n.battlefield_name === name)
              return (
                <div key={name} className="note-battlefield-slot">
                  <div className="note-battlefield-header">
                    <div className="note-battlefield-name">{name}</div>
                    <button
                      type="button"
                      className="note-add-btn"
                      onClick={() => toggleComposer(composerKey)}
                      aria-label={`Add note for ${name}`}
                    >
                      +
                    </button>
                  </div>
                  {slotNotes.length === 0 && !openComposers[composerKey] && (
                    <div className="note-empty">No notes yet for {name}.</div>
                  )}
                  {slotNotes.map((note) => (
                    <NoteEntry key={note.id} note={note} onSave={handleSaveNote} onDelete={handleDeleteNote} />
                  ))}
                  {openComposers[composerKey] && (
                    <NewNoteComposer
                      onCancel={() => toggleComposer(composerKey)}
                      onCreate={makeCreateHandler('battlefield', { battlefield_name: name }, composerKey)}
                      placeholder={`Notes for ${name}…`}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="note-category">
        <div className="note-category-header">
          <div className="note-category-title">Custom Notes</div>
          <button type="button" className="note-add-btn" onClick={() => toggleComposer('custom')} aria-label="Add custom note">
            +
          </button>
        </div>
        {notesFor('custom').length === 0 && !openComposers.custom && (
          <div className="note-empty">No custom notes yet. Add a note with its own title.</div>
        )}
        {notesFor('custom').map((note) => (
          <NoteEntry key={note.id} note={note} showTitle onSave={handleSaveNote} onDelete={handleDeleteNote} />
        ))}
        {openComposers.custom && (
          <NewNoteComposer
            onCancel={() => toggleComposer('custom')}
            onCreate={makeCreateHandler('custom', {}, 'custom')}
            placeholder="Write a note…"
            showTitle
          />
        )}
      </div>
    </div>
  )
}
