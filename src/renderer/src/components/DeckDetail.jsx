import { useEffect, useMemo, useState } from 'react'
import { domainIcon } from '../lib/domainIcons.js'
import { computeRecord, computeStreak, computeWinRate } from '../lib/stats.js'
import { serializeDecklist } from '../lib/parseDecklist.js'
import { CardArtTile, sortCardsByCost, useCardArtResolution } from './DecklistCardArt.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import DeckAvatar from './DeckAvatar.jsx'
import DeckChangelogPanel from './DeckChangelogPanel.jsx'
import DeckNotes from './DeckNotes.jsx'
import ImportDeckModal from './ImportDeckModal.jsx'
import LogMatchModal from './LogMatchModal.jsx'
import MatchupRecord from './MatchupRecord.jsx'
import RecentMatches from './RecentMatches.jsx'

// Legend/Champion/Battlefields/Runes share one row of four narrow columns
// (each is a small, fixed-size section — 1, 1, 3, and 12 cards — so none of
// them need a full row to themselves); Main Deck and Sideboard each get
// their own full-width row below, in that order. Array order drives the
// grid's auto-placement (see .decklist-grid/.decklist-section.wide in
// styles.css), so reordering this list is what actually reorders the
// rendered sections — both List and Grid view read the same array.
//
// `cropMode` only matters to Grid view (List never renders an image) --
// 'none' shows a section's cards as their full, uncropped source image;
// 'auto' would let cardArtCache.js apply its Stage 1 art-region crop on
// portrait cards instead (still supported there, just unused below). Every
// section is 'none' now -- an art-only Stage 1 crop on Main Deck/
// Battlefields/Sideboard read as less recognizable than the full card, the
// same reasoning Legend/Champion/Runes already used, so the distinction
// was dropped in favor of one uniform treatment. See DecklistGridSection
// and cardArtCache.js.
const SECTIONS = [
  { key: 'legend', title: 'Legend', cropMode: 'none' },
  { key: 'champion', title: 'Champion', cropMode: 'none' },
  { key: 'battlefields', title: 'Battlefields', cropMode: 'none' },
  { key: 'runes', title: 'Runes', cropMode: 'none' },
  { key: 'main', title: 'Main Deck', wide: true, cropMode: 'none' },
  { key: 'sideboard', title: 'Sideboard', wide: true, cropMode: 'none' }
]

const GRID_SORT_OPTIONS = [
  { key: 'default', label: 'Deck Order' },
  { key: 'costAsc', label: 'Cost Low → High' },
  { key: 'costDesc', label: 'Cost High → Low' }
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
export default function DeckDetail({ deckId, onBack, onViewInsights }) {
  const [deck, setDeck] = useState(null)
  const [matches, setMatches] = useState([])
  const [status, setStatus] = useState('loading')
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  const [editOpen, setEditOpen] = useState(false)
  const [logMatchOpen, setLogMatchOpen] = useState(false)
  const [changelogOpen, setChangelogOpen] = useState(false)
  // List/Grid decklist view -- List is the default, unchanged from before
  // this existed; the persisted choice (see preferences.js's
  // decklistViewMode) is loaded once on mount below and may flip this to
  // 'grid' shortly after first render, the same async-preference-load
  // pattern the Play tab's own deck picker already uses. gridSort is
  // deliberately NOT persisted -- it's scoped to whatever's currently
  // showing, not a standing preference.
  const [viewMode, setViewMode] = useState('list')
  const [gridSort, setGridSort] = useState('default')

  useEffect(() => {
    let cancelled = false
    window.api.deckDetail.getViewMode().then((mode) => {
      if (!cancelled) setViewMode(mode)
    })
    return () => {
      cancelled = true
    }
  }, [])

  function handleViewModeChange(mode) {
    setViewMode(mode)
    window.api.deckDetail.setViewMode(mode)
  }

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

  // Only gathered/resolved once Grid view is actually showing -- an empty
  // array while on List (or before the deck has loaded) means
  // useCardArtResolution below has nothing to fetch, matching the "lazy,
  // never a bulk upfront fetch before the user has asked to see Grid"
  // requirement. Called unconditionally, before the status early-returns
  // below, since it's a hook -- deck may still be null here while loading.
  const allCardEntries = useMemo(() => {
    if (viewMode !== 'grid' || !deck) return []
    const seen = new Set()
    const entries = []
    for (const { key, cropMode } of SECTIONS) {
      for (const card of deck.decklist?.[key] ?? []) {
        if (seen.has(card.name)) continue
        seen.add(card.name)
        entries.push({ name: card.name, cropMode: cropMode ?? 'auto' })
      }
    }
    return entries
  }, [viewMode, deck])
  useCardArtResolution(allCardEntries)

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
          <button className="btn" onClick={() => onViewInsights(deckId)}>
            <svg viewBox="0 0 24 24" fill="none" width="13" height="13">
              <path d="M4 12 Q4 4 12 4 Q20 4 20 12 Q20 20 12 20" stroke="currentColor" strokeWidth="1.6" />
              <path d="M12 8v4l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            View Insights
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
          <button className="btn" onClick={() => setChangelogOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" width="13" height="13">
              <path
                d="M4 12a8 8 0 1 0 2.34-5.66M4 12V6m0 6h6"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Changelog
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
        <DeckAvatar deck={deck} size="lg" />

        <div className="deck-detail-heading">
          <h1>{deck.name}</h1>
          {(deck.legend_name || championName) && (
            <div className="deck-detail-champion">
              {[deck.legend_name, championName].filter(Boolean).join(' and ')}
            </div>
          )}
          <div className="deck-detail-domains">
            {[deck.domain_1, deck.domain_2].filter(Boolean).map((domain) => (
              <span key={domain} className="domain-pill">
                {domainIcon(domain) && <img className="domain-pill-icon" src={domainIcon(domain)} alt="" />}
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
            {winRate === null ? '-' : `${Math.round(winRate * 100)}%`}
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
            {streak ? `${streak.result === 'win' ? 'W' : 'L'}${streak.count}` : '-'}
          </div>
        </div>
      </div>

      <div className="section-label-row">
        <div className="section-label">Decklist</div>
        <div className="decklist-view-controls">
          <div className="segmented">
            <button
              type="button"
              className={`segmented-option ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => handleViewModeChange('list')}
            >
              List
            </button>
            <button
              type="button"
              className={`segmented-option ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => handleViewModeChange('grid')}
            >
              Grid
            </button>
          </div>
          {viewMode === 'grid' && (
            <div className="segmented">
              {GRID_SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`segmented-option ${gridSort === opt.key ? 'active' : ''}`}
                  onClick={() => setGridSort(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="decklist-grid">
        {SECTIONS.map(({ key, title, wide }) =>
          viewMode === 'grid' ? (
            <DecklistGridSection key={key} title={title} cards={decklist[key]} wide={wide} sort={gridSort} />
          ) : (
            <DecklistSection key={key} title={title} cards={decklist[key]} wide={wide} />
          )
        )}
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

      {changelogOpen && <DeckChangelogPanel deckId={deck.id} onClose={() => setChangelogOpen(false)} />}
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
        <div className="decklist-empty">-</div>
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

// Grid view's counterpart to DecklistSection above -- same section
// wrapper/title, but renders one CardArtTile per distinct card (art +
// quantity badge, or a placeholder) instead of a text row per card, and
// applies the section-local cost sort. `sort` is re-applied on every render
// (sortCardsByCost reads live cost data straight from DecklistCardArt.jsx's
// module-level cache), so the grid quietly re-sorts itself as more cards'
// costs resolve rather than freezing at whatever was known when a sort was
// first chosen.
function DecklistGridSection({ title, cards, wide, sort }) {
  const list = cards ?? []
  const sorted = sortCardsByCost(list, sort)

  return (
    <div className={`decklist-section ${wide ? 'wide' : ''}`}>
      <div className="decklist-section-title">{title}</div>
      {sorted.length === 0 ? (
        <div className="decklist-empty">-</div>
      ) : (
        <div className="card-art-grid">
          {sorted.map((card, index) => (
            <CardArtTile key={`${card.name}-${index}`} card={card} />
          ))}
        </div>
      )}
    </div>
  )
}
