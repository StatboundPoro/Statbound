import { useEffect, useState } from 'react'
import { domainColor } from '../lib/domains.jsx'
import { domainIcon } from '../lib/domainIcons.js'
import ConfirmDialog from './ConfirmDialog.jsx'
import LogMatchModal from './LogMatchModal.jsx'
import ReplayPlayer from './ReplayPlayer.jsx'

const SEAT_LABELS = {
  went_1st: 'Went 1st',
  went_2nd: 'Went 2nd'
}

function formatGameResult(game) {
  if (game.result === 'win' || game.result === 'loss') return game.result === 'win' ? 'Win' : 'Loss'
  if (game.result === 'incomplete') return 'Incomplete'
  return 'Not recorded'
}

function GameDetail({ game }) {
  return (
    <div className="match-detail-game">
      <div className="match-detail-game-header">
        <span className="match-detail-game-title">Game {game.game_number}</span>
        <span className={`match-detail-game-result ${game.result ?? ''}`}>{formatGameResult(game)}</span>
      </div>
      <div className="match-detail-field-grid">
        <div className="match-detail-field">
          <span className="match-detail-field-label">My Score</span>
          <span className="match-detail-field-value mono">{game.my_score ?? '—'}</span>
        </div>
        <div className="match-detail-field">
          <span className="match-detail-field-label">Opponent Score</span>
          <span className="match-detail-field-value mono">{game.opponent_score ?? '—'}</span>
        </div>
        <div className="match-detail-field">
          <span className="match-detail-field-label">Seat</span>
          <span className="match-detail-field-value">{SEAT_LABELS[game.seat] ?? '—'}</span>
        </div>
        <div className="match-detail-field">
          <span className="match-detail-field-label">My Battlefield</span>
          <span className="match-detail-field-value">{game.my_battlefield ?? '—'}</span>
        </div>
        <div className="match-detail-field">
          <span className="match-detail-field-label">Opponent Battlefield</span>
          <span className="match-detail-field-value">{game.opponent_battlefield ?? '—'}</span>
        </div>
        <div className="match-detail-field">
          <span className="match-detail-field-label">Extra Battlefields</span>
          <span className="match-detail-field-value">
            {game.extra_battlefields?.length > 0 ? game.extra_battlefields.join(', ') : '—'}
          </span>
        </div>
      </div>
    </div>
  )
}

function MatchDetailView({ match, deck, replay, onWatchReplay, onEdit, onDeleteClick, onClose }) {
  return (
    <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
      <div className="modal-header">
        <h2>Match Details</h2>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="match-detail-summary">
        <div className="match-detail-crest">
          <div className="half a" style={{ background: domainColor(deck?.domain_1) }} />
          <div className="half b" style={{ background: domainColor(deck?.domain_2) }} />
          <div className="glyphs">
            <div className="glyph">
              {domainIcon(deck?.domain_1) && <img src={domainIcon(deck?.domain_1)} alt="" />}
            </div>
            {deck?.domain_2 && (
              <div className="glyph">
                {domainIcon(deck.domain_2) && <img src={domainIcon(deck.domain_2)} alt="" />}
              </div>
            )}
          </div>
        </div>
        <div className="match-detail-summary-body">
          <div className="match-detail-deck-name">{deck?.name ?? 'Unknown deck'}</div>
          <div className="match-detail-vs">vs. {match.opponent_legend ?? 'Unknown opponent'}</div>
        </div>
        <div className="match-detail-summary-right">
          <div className="field-label">Format</div>
          <div className="match-detail-format">{match.format}</div>
        </div>
        <div className="match-detail-summary-right">
          <div className="field-label">Result</div>
          <div className={`result-badge ${match.result ?? ''}`}>
            {match.result ? `${match.result.toUpperCase()} ${match.score}` : '—'}
          </div>
        </div>
      </div>

      <div className="form-columns">
        <div className="form-column">
          <div className="form-column-title">My Side</div>
          <div className="match-detail-field">
            <span className="match-detail-field-label">Deck</span>
            <span className="match-detail-field-value">{deck?.name ?? 'Unknown deck'}</span>
          </div>
          <div className="match-detail-field">
            <span className="match-detail-field-label">My Legend</span>
            <span className="match-detail-field-value">{deck?.legend_name ?? '—'}</span>
          </div>
        </div>
        <div className="form-column">
          <div className="form-column-title">Opponent</div>
          <div className="match-detail-field">
            <span className="match-detail-field-label">Opponent Name</span>
            <span className="match-detail-field-value">{match.opponent_name ?? '—'}</span>
          </div>
          <div className="match-detail-field">
            <span className="match-detail-field-label">Opponent Legend</span>
            <span className="match-detail-field-value">{match.opponent_legend ?? '—'}</span>
          </div>
        </div>
      </div>

      <div className="section-label">Flags</div>
      {match.flags?.length > 0 ? (
        <div className="match-detail-flags">
          {match.flags.map((flag) => (
            <span key={flag} className="tag-pill match-detail-flag-pill">
              {flag}
            </span>
          ))}
        </div>
      ) : (
        <div className="match-detail-empty">No flags on this match.</div>
      )}

      <div className="section-label">Notes</div>
      {match.notes ? (
        <div className="match-detail-notes">{match.notes}</div>
      ) : (
        <div className="match-detail-empty">No notes on this match.</div>
      )}

      <div className="section-label">Games</div>
      <div className="match-detail-games">
        {match.games.map((game) => (
          <GameDetail key={game.id} game={game} />
        ))}
      </div>

      <div className="modal-actions match-detail-actions">
        <button className="btn btn-danger-outline" onClick={onDeleteClick}>
          Delete Match
        </button>
        <div className="match-detail-actions-right">
          {replay && (
            <button className="btn" onClick={onWatchReplay}>
              Watch Replay
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-primary" onClick={onEdit}>
            Edit
          </button>
        </div>
      </div>
    </div>
  )
}

// Click-to-view modal for a single match, wired up wherever a match row
// already appears (Recent Matches on both Deck Library and Deck Detail,
// and Matchup Record's expanded per-legend table). Self-contained: given
// only a `matchId`, it fetches the match and its deck itself rather than
// relying on whatever data shape each caller happens to already have —
// the same reasoning LogMatchModal already fetches its own deck list
// regardless of context. Starts in read-only view mode; "Edit" swaps in
// the real LogMatchModal (pre-filled, calling matches:update) rather than
// duplicating a second form, and "Delete Match" goes through the same
// ConfirmDialog pattern used for deck deletion. `onChanged` is called
// after a successful save or delete so the caller can refetch its own
// match list — the stat strip, Matchup Record, and Recent Matches are all
// derived from that same list, so one refetch keeps everything consistent.
export default function MatchDetailModal({ matchId, onClose, onChanged }) {
  const [match, setMatch] = useState(null)
  const [deck, setDeck] = useState(null)
  const [replay, setReplay] = useState(null)
  const [status, setStatus] = useState('loading')
  const [mode, setMode] = useState('view')
  const [replayPlayerOpen, setReplayPlayerOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')

    window.api.matches
      .get(matchId)
      .then((matchResult) => {
        if (cancelled) return
        if (!matchResult) {
          setStatus('not-found')
          return
        }
        setMatch(matchResult)
        return Promise.all([window.api.decks.get(matchResult.deck_id), window.api.replays.getByMatch(matchId)])
      })
      .then((results) => {
        if (cancelled || results === undefined) return
        const [deckResult, replayResult] = results
        setDeck(deckResult)
        setReplay(replayResult)
        setStatus('ready')
      })
      .catch((err) => {
        console.error('Failed to load match detail:', err)
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [matchId])

  function handleSaved(updatedMatch) {
    setMatch(updatedMatch)
    setMode('view')
    onChanged?.()
  }

  async function handleConfirmDelete() {
    setDeleting(true)
    setDeleteError(null)
    try {
      await window.api.matches.delete(matchId)
      onChanged?.()
      onClose()
    } catch (err) {
      console.error('Failed to delete match:', err)
      setDeleteError('Could not delete this match. Check the main process console.')
      setDeleting(false)
    }
  }

  if (mode === 'edit' && match) {
    return <LogMatchModal mode="edit" match={match} onClose={() => setMode('view')} onSaved={handleSaved} />
  }

  return (
    <>
      <div className="modal-backdrop" onClick={onClose}>
        {status === 'loading' && (
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <p>Loading match…</p>
          </div>
        )}
        {status === 'error' && (
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <p>Could not load this match. Check the main process console.</p>
          </div>
        )}
        {status === 'not-found' && (
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <p>This match no longer exists.</p>
          </div>
        )}
        {status === 'ready' && (
          <MatchDetailView
            match={match}
            deck={deck}
            replay={replay}
            onWatchReplay={() => setReplayPlayerOpen(true)}
            onEdit={() => setMode('edit')}
            onDeleteClick={() => setConfirmDeleteOpen(true)}
            onClose={onClose}
          />
        )}
      </div>

      {replayPlayerOpen && replay && (
        <ReplayPlayer src={replay.url} onClose={() => setReplayPlayerOpen(false)} />
      )}

      {confirmDeleteOpen && (
        <ConfirmDialog
          title="Delete Match"
          message="Delete this match? This can't be undone."
          confirmLabel="Delete"
          danger
          busy={deleting}
          error={deleteError}
          onConfirm={handleConfirmDelete}
          onCancel={() => {
            setConfirmDeleteOpen(false)
            setDeleteError(null)
          }}
        />
      )}
    </>
  )
}
