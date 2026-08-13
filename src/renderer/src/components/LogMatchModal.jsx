import { useEffect, useState } from 'react'
import LegendAutocomplete from './LegendAutocomplete'
import { formatRelativeTime } from '../lib/stats.js'

const EXTRA_BATTLEFIELD_OPTIONS = ['Baron Pit', 'Brush']

function makeEmptyGame(gameNumber) {
  return {
    game_number: gameNumber,
    result: '',
    my_score: '',
    opponent_score: '',
    seat: '',
    my_battlefield: '',
    opponent_battlefield: '',
    extra_battlefields: []
  }
}

// Same "derive on read" logic as the main process's deriveMatchSummary —
// duplicated here (not imported) because this is a renderer-only live
// preview of a match that doesn't exist in the database yet, so there's
// nothing to read from IPC. Keep the two in sync if the rule ever changes.
function summarizeMatch(games) {
  const decided = games.filter((g) => g.result === 'win' || g.result === 'loss')
  const wins = decided.filter((g) => g.result === 'win').length
  const losses = decided.filter((g) => g.result === 'loss').length
  const result = wins === losses ? null : wins > losses ? 'win' : 'loss'
  return { result, score: `${wins}-${losses}` }
}

function summarizeGame(game) {
  if (game.result === 'win' || game.result === 'loss') {
    const hasScore = game.my_score !== '' && game.opponent_score !== ''
    return `${game.result === 'win' ? 'Win' : 'Loss'}${hasScore ? ` · ${game.my_score}-${game.opponent_score}` : ''}`
  }
  if (game.result === 'incomplete') return 'Incomplete'
  return 'Not recorded yet'
}

function isMatchDecided(games) {
  const wins = games.filter((g) => g.result === 'win').length
  const losses = games.filter((g) => g.result === 'loss').length
  return wins >= 2 || losses >= 2
}

// A deck has exactly 3 Battlefields. Once "My battlefield" is used in one
// game it can't be reused later in the same match, and once only one
// battlefield remains unused, it's auto-selected rather than offered as a
// choice. This walks the games in order, clearing any pick that collides
// with an earlier game and auto-filling any game left with exactly one
// legal option.
function reconcileBattlefields(games, battlefieldOptions) {
  const used = []
  const reconciled = games.map((game) => {
    let value = game.my_battlefield
    if (value && used.includes(value)) {
      value = ''
    }
    const available = battlefieldOptions.filter((name) => !used.includes(name))
    if (!value && available.length === 1) {
      value = available[0]
    }
    if (value) used.push(value)
    return { ...game, my_battlefield: value }
  })
  return reconciled
}

function battlefieldOptionsForGame(games, battlefieldOptions, gameNumber) {
  const used = games
    .filter((g) => g.game_number < gameNumber && g.my_battlefield)
    .map((g) => g.my_battlefield)
  return battlefieldOptions.filter((name) => !used.includes(name))
}

function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="segmented">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          data-variant={opt.variant}
          className={`segmented-option ${value === opt.value ? 'active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function TagInput({ value, onChange }) {
  const [draft, setDraft] = useState('')

  function commitDraft() {
    const tag = draft.trim()
    if (tag && !value.includes(tag)) {
      onChange([...value, tag])
    }
    setDraft('')
  }

  return (
    <div className="tag-input">
      {value.map((tag) => (
        <span key={tag} className="tag-pill">
          {tag}
          <button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(value.filter((t) => t !== tag))}>
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commitDraft()
          } else if (e.key === 'Backspace' && !draft && value.length > 0) {
            onChange(value.slice(0, -1))
          }
        }}
        placeholder={value.length === 0 ? 'Add a flag (ladder, tournament, testing…) and press Enter' : ''}
      />
    </div>
  )
}

function GameCard({ game, isBo1, isExpanded, onToggle, onChange, availableBattlefields, canRemove, onRemove }) {
  const isForced = availableBattlefields.length === 1 && availableBattlefields[0] === game.my_battlefield

  return (
    <div className="game-card">
      {!isBo1 && (
        <button type="button" className="game-card-header" onClick={onToggle}>
          <span className="game-card-title">Game {game.game_number}</span>
          <span className="game-card-summary">{summarizeGame(game)}</span>
          <span className="game-card-chevron">{isExpanded ? '▾' : '▸'}</span>
        </button>
      )}

      {isExpanded && (
        <div className="game-card-body">
          <div className="field-label">Result</div>
          <SegmentedControl
            options={[
              { value: 'win', label: 'Win', variant: 'win' },
              { value: 'loss', label: 'Loss', variant: 'loss' },
              { value: 'incomplete', label: 'Incomplete', variant: 'incomplete' }
            ]}
            value={game.result}
            onChange={(v) => onChange({ result: v })}
          />

          <div className="form-columns game-columns">
            <div className="form-column">
              <div className="form-column-title">My Side</div>
              <label className="form-field">
                <span>My Score</span>
                <input
                  type="number"
                  min="0"
                  value={game.my_score}
                  onChange={(e) => onChange({ my_score: e.target.value })}
                />
              </label>
              <label className="form-field">
                <span>Seat</span>
                <SegmentedControl
                  options={[
                    { value: 'went_1st', label: 'Went 1st' },
                    { value: 'went_2nd', label: 'Went 2nd' }
                  ]}
                  value={game.seat}
                  onChange={(v) => onChange({ seat: v })}
                />
              </label>
              <label className="form-field">
                <span>My Battlefield</span>
                {isForced ? (
                  <div className="static-field">
                    {game.my_battlefield} <span className="auto-tag">auto</span>
                  </div>
                ) : availableBattlefields.length === 0 ? (
                  <div className="static-field muted">No battlefields left</div>
                ) : (
                  <select
                    value={game.my_battlefield}
                    onChange={(e) => onChange({ my_battlefield: e.target.value })}
                  >
                    <option value="">Select…</option>
                    {availableBattlefields.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            </div>

            <div className="form-column">
              <div className="form-column-title">Opponent</div>
              <label className="form-field">
                <span>Opponent Score</span>
                <input
                  type="number"
                  min="0"
                  value={game.opponent_score}
                  onChange={(e) => onChange({ opponent_score: e.target.value })}
                />
              </label>
              <label className="form-field">
                <span>Opponent Battlefield</span>
                <input
                  type="text"
                  value={game.opponent_battlefield}
                  onChange={(e) => onChange({ opponent_battlefield: e.target.value })}
                  placeholder="Type a battlefield…"
                />
              </label>
            </div>
          </div>

          <label className="form-field">
            <span>Extra Battlefields</span>
            <div className="checkbox-row">
              {EXTRA_BATTLEFIELD_OPTIONS.map((name) => (
                <label key={name} className="checkbox-pill">
                  <input
                    type="checkbox"
                    checked={game.extra_battlefields.includes(name)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...game.extra_battlefields, name]
                        : game.extra_battlefields.filter((n) => n !== name)
                      onChange({ extra_battlefields: next })
                    }}
                  />
                  {name}
                </label>
              ))}
            </div>
          </label>

          {canRemove && (
            <button type="button" className="remove-game-link" onClick={onRemove}>
              Remove Game {game.game_number}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function gamesFromMatch(match) {
  return match.games.map((g) => ({
    game_number: g.game_number,
    result: g.result ?? '',
    my_score: g.my_score ?? '',
    opponent_score: g.opponent_score ?? '',
    seat: g.seat ?? '',
    my_battlefield: g.my_battlefield ?? '',
    opponent_battlefield: g.opponent_battlefield ?? '',
    extra_battlefields: g.extra_battlefields ?? []
  }))
}

// Manual match-entry form. In "create" mode (the default, launched from
// Deck Detail's "Log Match" button) it starts blank and posts a new match
// via matches:create. In "edit" mode (launched from MatchDetailModal's
// "Edit" button) it's pre-filled from `match` and calls matches:update
// against `match.id` instead — same form either way, no second component.
// No auto-capture or replay parsing in either mode; every field is typed
// in by hand.
export default function LogMatchModal({ initialDeckId, mode = 'create', match, onClose, onSaved }) {
  const isEdit = mode === 'edit'

  const [decks, setDecks] = useState([])
  const [decksStatus, setDecksStatus] = useState('loading')
  const [deckId, setDeckId] = useState(isEdit ? match.deck_id : initialDeckId)
  const [opponentName, setOpponentName] = useState(isEdit ? match.opponent_name ?? '' : '')
  const [opponentLegend, setOpponentLegend] = useState(isEdit ? match.opponent_legend ?? '' : '')
  const [format, setFormat] = useState(isEdit ? match.format : 'Bo1')
  const [games, setGames] = useState(isEdit ? gamesFromMatch(match) : [makeEmptyGame(1)])
  const [expandedGameNumber, setExpandedGameNumber] = useState(games[0]?.game_number ?? 1)
  const [flags, setFlags] = useState(isEdit ? match.flags ?? [] : [])
  const [notes, setNotes] = useState(isEdit ? match.notes ?? '' : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Recording linking only ever happens at initial match creation (see
  // module comment above) — editing an existing match never touches this,
  // so none of this state or its fetch even runs in edit mode.
  const [unlinkedReplays, setUnlinkedReplays] = useState([])
  const [selectedReplayPath, setSelectedReplayPath] = useState('')

  useEffect(() => {
    window.api.decks
      .list()
      .then((result) => {
        setDecks(result)
        setDecksStatus('ready')
      })
      .catch((err) => {
        console.error('Failed to load decks for match log:', err)
        setDecksStatus('error')
      })
  }, [])

  useEffect(() => {
    if (isEdit) return
    window.api.replays
      .listUnlinked()
      .then((files) => {
        setUnlinkedReplays(files)
        // Simplest correct default: the most recent unlinked recording,
        // since normally at most one is pending at a time. The dropdown
        // below still lets a different one (or "No recording") be picked.
        if (files.length > 0) setSelectedReplayPath(files[0].filePath)
      })
      .catch((err) => console.error('Failed to load unlinked recordings:', err))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedDeck = decks.find((d) => d.id === deckId) ?? null
  const myLegend = selectedDeck?.legend_name ?? ''
  const battlefieldOptions = (selectedDeck?.decklist?.battlefields ?? []).map((b) => b.name)
  const displayGames = reconcileBattlefields(games, battlefieldOptions)
  const matchSummary = summarizeMatch(displayGames)
  const decidedGamesCount = displayGames.filter((g) => g.result === 'win' || g.result === 'loss').length
  const canAddMoreGames = format === 'Bo3' && games.length < 3 && !isMatchDecided(games)

  // Bo3 games 2/3 appear either via "Add Game" or automatically once the
  // prior game gets a result — but not once the match is already decided
  // (first to 2 game wins), so a clean 2-0 sweep doesn't demand a
  // pointless Game 3. This only appends the new (collapsed) card; it
  // deliberately does NOT change which card is expanded, so setting a
  // game's result doesn't yank focus away to the next game before the
  // user has finished entering that game's other fields.
  useEffect(() => {
    if (format !== 'Bo3' || games.length >= 3) return
    const last = games[games.length - 1]
    if (last.result !== 'win' && last.result !== 'loss') return
    if (isMatchDecided(games)) return

    const nextNumber = games.length + 1
    setGames((prev) => [...prev, makeEmptyGame(nextNumber)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, format])

  function handleFormatChange(nextFormat) {
    setFormat(nextFormat)
    if (nextFormat === 'Bo1') {
      setGames((prev) => prev.slice(0, 1))
      setExpandedGameNumber(1)
    }
  }

  function updateGame(gameNumber, patch) {
    setGames((prev) => prev.map((g) => (g.game_number === gameNumber ? { ...g, ...patch } : g)))
  }

  function addGame() {
    if (games.length >= 3) return
    const nextNumber = games.length + 1
    setGames((prev) => [...prev, makeEmptyGame(nextNumber)])
    setExpandedGameNumber(nextNumber)
  }

  function removeLastGame() {
    if (games.length <= 1) return
    const next = games.slice(0, -1)
    setGames(next)
    setExpandedGameNumber(next[next.length - 1].game_number)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        deck_id: deckId,
        opponent_name: opponentName.trim() || null,
        opponent_legend: opponentLegend.trim() || null,
        format,
        flags,
        notes: notes.trim() || null,
        games: displayGames.map((g) => ({
          game_number: g.game_number,
          result: g.result || null,
          my_score: g.my_score === '' ? null : Number(g.my_score),
          opponent_score: g.opponent_score === '' ? null : Number(g.opponent_score),
          seat: g.seat || null,
          my_battlefield: g.my_battlefield || null,
          opponent_battlefield: g.opponent_battlefield.trim() || null,
          extra_battlefields: g.extra_battlefields
        }))
      }
      const saved = isEdit
        ? await window.api.matches.update(match.id, payload)
        : await window.api.matches.create({ ...payload, played_at: new Date().toISOString() })

      if (!isEdit && selectedReplayPath) {
        try {
          await window.api.replays.create({ match_id: saved.id, file_path: selectedReplayPath })
        } catch (err) {
          // The match itself already saved successfully — a failed link
          // shouldn't lose that. The file stays unlinked on disk and can
          // still be picked up manually the next time a match is logged.
          console.error('Failed to link recording to match:', err)
        }
      }

      onSaved(saved)
    } catch (err) {
      console.error(`Failed to ${isEdit ? 'update' : 'save'} match:`, err)
      setError(`Could not ${isEdit ? 'update' : 'save'} this match. Check the main process console.`)
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? 'Edit Match' : 'Log Match'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="log-match-topline">
          <div>
            <div className="field-label">Result</div>
            <div className={`result-badge ${matchSummary.result ?? ''}`}>
              {matchSummary.result ? `${matchSummary.result === 'win' ? 'WIN' : 'LOSS'} ${matchSummary.score}` : '—'}
            </div>
          </div>
          <div>
            <div className="field-label">Format</div>
            <SegmentedControl
              options={[
                { value: 'Bo1', label: 'Bo1' },
                { value: 'Bo3', label: 'Bo3' }
              ]}
              value={format}
              onChange={handleFormatChange}
            />
          </div>
        </div>

        <div className="form-columns">
          <div className="form-column">
            <div className="form-column-title">My Side</div>
            <label className="form-field">
              <span>Deck</span>
              <select value={deckId} onChange={(e) => setDeckId(e.target.value)} disabled={decksStatus !== 'ready'}>
                {decksStatus === 'loading' && <option>Loading decks…</option>}
                {decksStatus === 'error' && <option>Could not load decks</option>}
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>My Legend</span>
              <input type="text" value={myLegend} readOnly disabled placeholder="Set by the selected deck" />
            </label>
          </div>

          <div className="form-column">
            <div className="form-column-title">Opponent</div>
            <label className="form-field">
              <span>Opponent Name</span>
              <input
                type="text"
                value={opponentName}
                onChange={(e) => setOpponentName(e.target.value)}
                placeholder="Optional"
              />
            </label>
            <label className="form-field">
              <span>Opponent Legend</span>
              <LegendAutocomplete
                value={opponentLegend}
                onChange={setOpponentLegend}
                placeholder="Optional"
              />
            </label>
          </div>
        </div>

        <div className="section-label">Games</div>
        <div className="games-stack">
          {displayGames.map((game, index) => (
            <GameCard
              key={game.game_number}
              game={game}
              isBo1={format === 'Bo1'}
              isExpanded={format === 'Bo1' || expandedGameNumber === game.game_number}
              onToggle={() =>
                setExpandedGameNumber(expandedGameNumber === game.game_number ? null : game.game_number)
              }
              onChange={(patch) => updateGame(game.game_number, patch)}
              availableBattlefields={battlefieldOptionsForGame(displayGames, battlefieldOptions, game.game_number)}
              canRemove={format === 'Bo3' && index === displayGames.length - 1 && displayGames.length > 1}
              onRemove={removeLastGame}
            />
          ))}
        </div>
        {canAddMoreGames && (
          <button type="button" className="btn add-game-btn" onClick={addGame}>
            + Add Game
          </button>
        )}
        {decidedGamesCount === 0 && (
          <div className="form-hint">Enter a result for at least one game to save.</div>
        )}

        {!isEdit && (
          <>
            <div className="section-label">Recording</div>
            {unlinkedReplays.length === 0 ? (
              <div className="form-hint">No unlinked recordings found.</div>
            ) : (
              <label className="form-field">
                <span>Link a Recording</span>
                <select value={selectedReplayPath} onChange={(e) => setSelectedReplayPath(e.target.value)}>
                  <option value="">No recording</option>
                  {unlinkedReplays.map((file) => (
                    <option key={file.filePath} value={file.filePath}>
                      {file.fileName} — {formatRelativeTime(file.createdAt)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}

        <div className="section-label">Flags</div>
        <TagInput value={flags} onChange={setFlags} />

        <div className="section-label">Notes</div>
        <textarea
          className="notes-textarea"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Mulligans, sideboard plan, anything worth remembering…"
        />

        {error && <div className="import-error">{error}</div>}

        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || decidedGamesCount === 0}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Match'}
          </button>
        </div>
      </div>
    </div>
  )
}
