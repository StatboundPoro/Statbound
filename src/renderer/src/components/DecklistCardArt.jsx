import { useEffect, useState } from 'react'

// In-memory, this-session-only cache of resolved { url, cost } entries (or
// null for "no art available") keyed by normalized card name -- mirrors
// DeckAvatar.jsx's own artUrlCache exactly, and for the same reason: once
// one deck's Grid view has resolved a card this session, a second deck
// sharing that card (or the same deck's Grid view being reopened) reuses it
// with no further IPC round trip. The real cache (survives restarts) lives
// on disk in main -- see src/main/cardArtCache.js -- this is just a
// render-cheap layer on top of it.
const cardArtCache = new Map()

function normalizeKey(name) {
  return name.trim().toLowerCase()
}

/**
 * Kicks off lazy resolution for every distinct card in `cardEntries` (each
 * `{ name, cropMode }` -- 'auto' or 'none', see cardArtCache.js) that isn't
 * already cached this session, and returns the shared cardArtCache map so
 * callers can read whatever's resolved so far. Callers re-render as entries
 * stream in (each resolved card bumps a local counter), so a Grid view
 * populates progressively rather than waiting on every card at once -- and
 * a card that was already resolved (this deck's Grid view was opened
 * before, or another deck already resolved the same card name) shows up
 * immediately with no loading flash. The cache itself is keyed by name
 * alone, not name+cropMode -- safe because a given card name is only ever
 * requested under one crop mode in practice (Legend/Champion/Rune names
 * never collide with Main Deck/Battlefield/Sideboard names), so there's no
 * risk of two different sections fighting over the same cache slot.
 *
 * `cardEntries` should be a stable (memoized) array reference -- it's only
 * meant to change when the set of cards actually being displayed changes
 * (e.g. switching decks), not on every render.
 */
export function useCardArtResolution(cardEntries) {
  const [, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    const toFetch = cardEntries.filter((entry) => !cardArtCache.has(normalizeKey(entry.name)))

    toFetch.forEach((entry) => {
      window.api.cardArt.getUrl(entry.name, entry.cropMode).then((result) => {
        cardArtCache.set(normalizeKey(entry.name), result)
        if (!cancelled) setVersion((v) => v + 1)
      })
    })

    return () => {
      cancelled = true
    }
  }, [cardEntries])

  return cardArtCache
}

export function getCardArtEntry(cardName) {
  return cardArtCache.get(normalizeKey(cardName))
}

// In-memory, this-session-only cache of resolved full-card image URLs (or
// `null` for "unavailable") keyed by normalized card name -- the
// lightbox's own counterpart to cardArtCache above. Deliberately a
// separate Map: Grid tiles and the lightbox resolve independently (see
// src/main/cardArtCache.js vs. src/main/cardArtFullCache.js), so a card
// whose tile art is still loading or failed can still resolve its full
// image the moment the lightbox asks for it, and vice versa.
const fullCardArtCache = new Map()

/**
 * Returns a card's cached full-image URL, or `undefined` if it hasn't
 * resolved yet (kicking off that resolution as a side effect the first
 * time it's asked for), or `null` if it resolved to "unavailable."
 * CardLightbox.jsx is the only caller -- unlike useCardArtResolution
 * above, this fetches one card at a time, on demand, never a batch, since
 * the lightbox only ever shows one card at once.
 */
export function useFullCardArt(cardName) {
  const key = normalizeKey(cardName)
  const [, setVersion] = useState(0)

  useEffect(() => {
    if (fullCardArtCache.has(key)) return
    let cancelled = false
    window.api.cardArt.getFullUrl(cardName).then((url) => {
      fullCardArtCache.set(key, url)
      if (!cancelled) setVersion((v) => v + 1)
    })
    return () => {
      cancelled = true
    }
  }, [key, cardName])

  return fullCardArtCache.has(key) ? fullCardArtCache.get(key) : undefined
}

/**
 * One Grid view tile: a card's art with a quantity badge overlaid in the
 * corner (only shown for count > 1 -- a single copy shows no badge, since
 * badging every one of a 39-card Main Deck's mostly-single-copy cards would
 * be noisier than useful), or a plain name+count placeholder tile if art
 * isn't available yet (still resolving) or never resolves (no Riftcodex
 * match, network failure). The placeholder and the not-yet-resolved state
 * render identically on purpose -- both are non-blocking, and there's
 * nothing meaningful to tell the user apart between "still loading" and
 * "never found," since either way the rest of the grid keeps rendering
 * normally around it.
 *
 * `onOpen`, if provided, makes the tile clickable (opens the card
 * lightbox) regardless of whether this tile's own thumbnail resolved --
 * the lightbox fetches the full card independently (see useFullCardArt
 * above), so a card stuck on its placeholder here can still open
 * successfully.
 */
export function CardArtTile({ card, onOpen }) {
  const entry = getCardArtEntry(card.name)
  const clickable = typeof onOpen === 'function'
  const interactiveProps = clickable
    ? {
        onClick: onOpen,
        role: 'button',
        tabIndex: 0,
        onKeyDown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }
      }
    : {}

  if (entry?.url) {
    return (
      <div
        className={`card-art-tile ${clickable ? 'card-art-tile-clickable' : ''}`}
        title={card.name}
        {...interactiveProps}
      >
        <img src={entry.url} alt={card.name} />
        {card.count > 1 && <span className="card-art-badge">×{card.count}</span>}
      </div>
    )
  }

  return (
    <div
      className={`card-art-tile card-art-tile-placeholder ${clickable ? 'card-art-tile-clickable' : ''}`}
      title={card.name}
      {...interactiveProps}
    >
      <span className="card-art-placeholder-name">{card.name}</span>
      <span className="card-art-placeholder-count">×{card.count}</span>
    </div>
  )
}

/**
 * Sorts a section's cards by Riftcodex energy cost, ascending or
 * descending. Cards with no known cost yet (still resolving, or resolved
 * with no numeric cost at all -- Legends, and possibly other types) always
 * sink to the end regardless of direction, rather than clumping
 * unpredictably at whichever end a raw numeric comparison would put a
 * missing value. Re-run on every render as more art/cost data streams in
 * via useCardArtResolution above, so the grid re-sorts itself as costs
 * resolve rather than freezing at whatever was known when the sort was
 * first chosen.
 */
export function sortCardsByCost(cards, direction) {
  if (direction !== 'costAsc' && direction !== 'costDesc') return cards

  const withCost = cards.map((card) => ({ card, cost: getCardArtEntry(card.name)?.cost ?? null }))
  withCost.sort((a, b) => {
    if (a.cost === null && b.cost === null) return 0
    if (a.cost === null) return 1
    if (b.cost === null) return -1
    return direction === 'costAsc' ? a.cost - b.cost : b.cost - a.cost
  })
  return withCost.map((entry) => entry.card)
}
