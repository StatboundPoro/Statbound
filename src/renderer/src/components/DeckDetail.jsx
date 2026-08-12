import { useEffect, useState } from 'react'
import { domainColor, DomainGlyph } from '../lib/domains.jsx'
import { computeRecord, computeStreak, computeWinRate } from '../lib/stats.js'
import { serializeDecklist } from '../lib/parseDecklist.js'
import ConfirmDialog from './ConfirmDialog.jsx'
import DeckNotes from './DeckNotes.jsx'
import ImportDeckModal from './ImportDeckModal.jsx'
import LogMatchModal from './LogMatchModal.jsx'
import MatchupRecord from './MatchupRecord.jsx'
import RecentMatches from './RecentMatches.jsx'

const SECTIONS = [
  { key: 'legend', title: 'Legend' },
  { key: 'champion', title: 'Champion' },
  { key: 'main', title: 'Main Deck', wide: true },
  { key: 'battlefields', title: 'Battlefields' },
  { key: 'runes', title: 'Runes' },
  { key: 'sideboard', title: 'Sideboard' }
]

// Deck detail page for one deck, reached by clicking a card in the Deck
// Library. Renders the decklist already stored on the deck record from
// import — nothing here re-parses anything. Win rate/record/streak and the
// Recent Matches panel are computed from this deck's real matches, so they
// render honest empty states until the first match is logged and real data
// from then on — no separate "empty" vs. "real" code path needed. Matchup
// Record and Notes are both fully implemented now (see MatchupRecord.jsx
// and DeckNotes.jsx) — the two are deliberately unconnected, with no
// cross-navigation between them.
export default function DeckDetail({ deckId, onBack }) {
  const [deck, setDeck] = useState(null)
  const [matches, setMatches] = useState([])
  const [status, setStatus] = useState('loading')
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  const [editOpen, setEditOpen] = useState(false)
  const [logMatchOpen, setLogMatchOpen] = useState(false)

  async function refetchMatches() {
    const matchesResult = await window.api.matches.list()
    setMatches(matchesResult.filter((m) => m.deck_id === deckId))
  }

  useEffect(() => {
    let cancelled = false
    setStatus('loading')

    Promise.all([window.api.decks.get(deckId), window.api.matches.list()])
      .then(([deckResult, matchesResult]) => {
        if (cancelled) return
        if (!deckResult) {
          setStatus('not-found')
          return
        }
        setDeck(deckResult)
        setMatches(matchesResult.filter((m) => m.deck_id === deckId))
        setStatus('ready')
      })
      .catch((err) => {
        console.error('Failed to load deck detail:', err)
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [deckId])

  async function handleConfirmDelete() {
    setDeleting(true)
    setDeleteError(null)
    try {
      await window.api.decks.delete(deckId)
      onBack()
    } catch (err) {
      console.error('Failed to delete deck:', err)
      setDeleteError('Could not delete this deck. Check the main process console.')
      setDeleting(false)
    }
  }

  function handleDeckSaved(updatedDeck) {
    setEditOpen(false)
    if (!updatedDeck) {
      // The deck was deleted elsewhere between opening this page and
      // saving the edit — nothing left to show here.
      setStatus('not-found')
      return
    }
    setDeck(updatedDeck)
  }

  async function handleMatchLogged() {
    setLogMatchOpen(false)
    try {
      await refetchMatches()
    } catch (err) {
      console.error('Failed to refresh matches:', err)
    }
  }

  if (status === 'loading') {
    return (
      <div className="main">
        <p>Loading deck…</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="main">
        <p>Could not load this deck. Check the main process console.</p>
      </div>
    )
  }

  if (status === 'not-found') {
    return (
      <div className="main">
        <BackLink onBack={onBack} />
        <p>This deck no longer exists.</p>
      </div>
    )
  }

  const winRate = computeWinRate(matches)
  const record = computeRecord(matches)
  const streak = computeStreak(matches)
  const decklist = deck.decklist ?? {}
  const championName = decklist.champion?.[0]?.name ?? null
  const decksById = new Map([[deck.id, deck]])

  return (
    <div className="main">
      <div className="detail-topbar">
        <BackLink onBack={onBack} />
        <div className="detail-topbar-actions">
          <button className="btn btn-primary" onClick={() => setLogMatchOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" width="13" height="13">
              <path d="M12 5v14M5 12h14" stroke="#151313" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Log Match
          </button>
          <button className="btn" onClick={() => setEditOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" width="13" height="13">
              <path
                d="M4 20h4L18.5 9.5a2.121 2.121 0 0 0-3-3L5 17v3z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Edit Deck
          </button>
          <button className="btn btn-danger-outline" onClick={() => setConfirmDeleteOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" width="13" height="13">
              <path
                d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0-1 13a1 1 0 01-1 1H8a1 1 0 01-1-1L6 7h12z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Delete Deck
          </button>
        </div>
      </div>

      <div className="deck-detail-header">
        <div className="deck-detail-crest">
          <div className="half a" style={{ background: domainColor(deck.domain_1) }} />
          <div className="half b" style={{ background: domainColor(deck.domain_2) }} />
          <div className="glyphs">
            <div className="glyph">
              <DomainGlyph domain={deck.domain_1} />
            </div>
            {deck.domain_2 && (
              <div className="glyph">
                <DomainGlyph domain={deck.domain_2} />
              </div>
            )}
          </div>
        </div>

        <div className="deck-detail-heading">
          <h1>{deck.legend_name ?? deck.name}</h1>
          {championName && <div className="deck-detail-champion">{championName}</div>}
          <div className="deck-detail-domains">
            {[deck.domain_1, deck.domain_2].filter(Boolean).map((domain) => (
              <span key={domain} className="domain-pill" style={{ '--pill-color': domainColor(domain) }}>
                <span className="swatch" />
                {domain}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="stat-strip stat-strip-3">
        <div className="stat-cell">
          <div className="label">Win Rate</div>
          <div className={`value ${winRate !== null ? 'pos' : ''}`}>
            {winRate === null ? '—' : `${Math.round(winRate * 100)}%`}
          </div>
        </div>
        <div className="stat-cell">
          <div className="label">Record</div>
          {matches.length === 0 ? (
            <div className="value" style={{ fontSize: 14, paddingTop: 5, color: 'var(--text-faint)' }}>
              No matches yet
            </div>
          ) : (
            <div className="value">
              {record.wins}-{record.losses}
            </div>
          )}
        </div>
        <div className="stat-cell">
          <div className="label">Current Streak</div>
          <div className={`value ${streak ? (streak.result === 'win' ? 'pos' : 'neg') : ''}`}>
            {streak ? `${streak.result === 'win' ? 'W' : 'L'}${streak.count}` : '—'}
          </div>
        </div>
      </div>

      <div className="section-label">Decklist</div>
      <div className="decklist-grid">
        {SECTIONS.map(({ key, title, wide }) => (
          <DecklistSection key={key} title={title} cards={decklist[key]} wide={wide} />
        ))}
      </div>

      <div className="section-label">Matchup Record</div>
      <MatchupRecord matches={matches} deckName={deck.name} onChanged={refetchMatches} />

      <div className="section-label">Recent Matches</div>
      <RecentMatches matches={matches} decksById={decksById} onChanged={refetchMatches} />

      <div className="section-label">Notes</div>
      <DeckNotes deckId={deck.id} battlefields={(decklist.battlefields ?? []).map((b) => b.name)} />

      {confirmDeleteOpen && (
        <ConfirmDialog
          title="Delete Deck"
          message={`Delete "${deck.name}"? This can't be undone.`}
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

      {editOpen && (
        <ImportDeckModal
          mode="edit"
          deckId={deck.id}
          initialText={serializeDecklist(decklist)}
          initialName={deck.name}
          onClose={() => setEditOpen(false)}
          onSaved={handleDeckSaved}
        />
      )}

      {logMatchOpen && (
        <LogMatchModal initialDeckId={deck.id} onClose={() => setLogMatchOpen(false)} onSaved={handleMatchLogged} />
      )}
    </div>
  )
}

function BackLink({ onBack }) {
  return (
    <button className="back-link" onClick={onBack}>
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Deck Library
    </button>
  )
}

function DecklistSection({ title, cards, wide }) {
  const list = cards ?? []

  return (
    <div className={`decklist-section ${wide ? 'wide' : ''}`}>
      <div className="decklist-section-title">{title}</div>
      {list.length === 0 ? (
        <div className="decklist-empty">—</div>
      ) : (
        <ul className="decklist-cards">
          {list.map((card, index) => (
            <li key={`${card.name}-${index}`}>
              <span className="count">{card.count}</span>
              <span className="name">{card.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
