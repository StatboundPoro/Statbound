import { useState } from 'react'
import { DecklistParseError, parseDecklist } from '../lib/parseDecklist.js'
import { domainColor } from '../lib/domains.jsx'
import { domainIcon } from '../lib/domainIcons.js'

const PLACEHOLDER = `Legend:
1 LeBlanc, Deceiver

Champion:
1 LeBlanc, Fragmented

MainDeck:
3 Watchful Sentry
3 Hidden Blade

Battlefields:
1 Windswept Hillock

Runes:
7 Order Rune
5 Mind Rune

Sideboard:
3 Imperial Decree`

// Paste -> parse -> preview -> save. Parsing happens client-side against
// pasted text (no IPC needed just to preview). In "create" mode (the
// default, used by Import Deck) the final save calls decks:create; in
// "edit" mode (used by Deck Detail's Edit Deck button, which pre-fills the
// textarea with the deck's current content via serializeDecklist) it calls
// decks:update against `deckId` instead. Everything else about the flow is
// identical.
export default function ImportDeckModal({
  onClose,
  onSaved,
  mode = 'create',
  deckId = null,
  initialText = '',
  initialName = ''
}) {
  const isEdit = mode === 'edit'

  const [text, setText] = useState(initialText)
  const [name, setName] = useState(initialName)
  const [parsed, setParsed] = useState(null)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  function handlePreview() {
    try {
      setParsed(parseDecklist(text))
      setError(null)
    } catch (err) {
      setParsed(null)
      setError(err instanceof DecklistParseError ? err.message : 'Could not parse this decklist.')
    }
  }

  function handleBack() {
    setParsed(null)
    setError(null)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const payload = { ...parsed, name: name.trim() || parsed.legend_name }
      const deck = isEdit
        ? await window.api.decks.update(deckId, payload)
        : await window.api.decks.create(payload)
      onSaved(deck)
    } catch (err) {
      console.error(`Failed to ${isEdit ? 'update' : 'save imported'} deck:`, err)
      setError('Could not save this deck. Check the main process console.')
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? 'Edit Deck' : 'Import Deck'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {!parsed ? (
          <>
            <textarea
              className="import-textarea"
              placeholder={PLACEHOLDER}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={16}
              autoFocus
            />
            {error && <div className="import-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handlePreview} disabled={!text.trim()}>
                Preview
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="form-field import-name-field">
              <span>Deck Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`Defaults to "${parsed.legend_name}"`}
                autoFocus
              />
            </label>
            <div className="import-preview">
              <div className="import-preview-crest">
                <div className="half a" style={{ background: domainColor(parsed.domain_1) }} />
                <div className="half b" style={{ background: domainColor(parsed.domain_2) }} />
                <div className="glyphs">
                  <div className="glyph">
                    {domainIcon(parsed.domain_1) && <img src={domainIcon(parsed.domain_1)} alt="" />}
                  </div>
                  {parsed.domain_2 && (
                    <div className="glyph">
                      {domainIcon(parsed.domain_2) && <img src={domainIcon(parsed.domain_2)} alt="" />}
                    </div>
                  )}
                </div>
              </div>
              <div className="import-preview-body">
                <div className="deck-domains">
                  {[parsed.domain_1, parsed.domain_2].filter(Boolean).join(' · ')}
                  {parsed.legend_name ? ` · ${parsed.legend_name}` : ''}
                </div>
                <div className="import-preview-stats">
                  <div>
                    <span>{parsed.summary.championCount}</span> Chosen
                  </div>
                  <div>
                    <span>{parsed.summary.mainCount}</span> Main
                  </div>
                  <div>
                    <span>{parsed.summary.battlefieldsCount}</span> Battlefields
                  </div>
                  <div>
                    <span>{parsed.summary.runesCount}</span> Runes
                  </div>
                  <div>
                    <span>{parsed.summary.sideboardCount}</span> Sideboard
                  </div>
                  <div>
                    <span>{parsed.summary.totalCount}</span> Total
                  </div>
                </div>
              </div>
            </div>
            {error && <div className="import-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn" onClick={handleBack} disabled={saving}>
                Back
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Deck'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
