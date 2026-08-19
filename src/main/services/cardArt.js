// Resolves ANY card name (not just Legends) to its Riftcodex card art image
// URL, energy cost, and orientation -- backs Deck Detail's Grid view (see
// cardArtCache.js). This is a separate lookup path from legendArt.js's,
// deliberately not built on top of it: legendArt.js builds one full-catalog
// index once per app run because it only ever needs to resolve a handful of
// distinct Legend names across a whole session, but a decklist grid can
// reference dozens of distinct Main Deck/Battlefield/Rune/Sideboard cards
// per deck, across any number of decks -- indexing the *entire* card
// catalog just to look up a handful of names per deck would be far more
// work than necessary.
//
// Confirmed live (https://riftcodex.com/docs/, GET /cards/name): unlike
// GET /cards' own name=/search= params (confirmed ignored server-side, see
// legendSync.js/legendArt.js), GET /cards/name?exact=<name> performs real
// server-side exact-name filtering -- verified against a live query
// ("Bewitching Spirit") that returned exactly one matching item rather than
// the unfiltered list. This lets each card resolve with one small, targeted
// request instead of a bulk index build.
import { RIFTCODEX_BASE } from './legendSync.js'

const NAME_LOOKUP_SIZE = 20

// A bounded request timeout, shared by every fetch this feature makes
// (this module's own name lookup, plus the image downloads in
// cardArtCache.js and cardArtFullCache.js) -- a slow/hung connection
// shouldn't be able to leave a Grid view tile or an open lightbox stuck
// indefinitely. A timeout (or any other network failure) is never cached
// as "this card has no art": every caller here and in both cache modules
// only ever writes to disk on a genuine success, so a transient failure is
// simply retried the next time that card is asked for, never permanently
// remembered as unavailable.
const FETCH_TIMEOUT_MS = 8000

export async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

// Same definition legendArt.js's isCanonicalPrinting() uses -- duplicated
// rather than imported since the two lookups hit different endpoints with
// no shared card-fetching code path to hang a common helper off of.
function isCanonicalPrinting(card) {
  const metadata = card?.metadata ?? {}
  return !metadata.alternate_art && !metadata.overnumbered && !metadata.signature
}

// Riftcodex names Legends/Champions "Champion - Title" (hyphen); this app's
// own decklist convention (see CLAUDE.md's Deck Import Format and
// legendSync.js's transformLegendName()) stores those same cards as
// "Champion, Title" (comma) -- the only decklist card names that ever
// contain a comma. Every other card type (Unit, Spell, Gear, Battlefield,
// Rune) keeps a plain name with no comma, which already matches Riftcodex's
// `name` field verbatim and needs no conversion. This is the inverse of
// transformLegendName()'s own hyphen-to-comma conversion, reversing the
// exact same convention back to Riftcodex's format before querying.
function toRiftcodexQueryName(name) {
  if (typeof name !== 'string') return null
  const trimmed = name.trim()
  if (!trimmed) return null

  const commaIndex = trimmed.indexOf(', ')
  if (commaIndex === -1) return trimmed

  const champion = trimmed.slice(0, commaIndex).trim()
  const title = trimmed.slice(commaIndex + 2).trim()
  return champion && title ? `${champion} - ${title}` : trimmed
}

async function fetchExactName(name) {
  const url = `${RIFTCODEX_BASE}/cards/name?exact=${encodeURIComponent(name)}&size=${NAME_LOOKUP_SIZE}`
  const response = await fetchWithTimeout(url)
  if (!response.ok) {
    throw new Error(`Riftcodex /cards/name request failed: HTTP ${response.status}`)
  }
  return response.json()
}

/**
 * Resolves one card name (any type) to its Riftcodex art image URL, energy
 * cost (attributes.energy, null for cards with no cost -- Legends, and
 * possibly others), and orientation ('portrait' | 'landscape', confirmed
 * live that Battlefields are the one landscape type while Legend/Unit/
 * Spell/Gear are portrait). Never throws -- a network failure, no exact
 * match, or a malformed response all resolve to null, which cardArtCache.js
 * treats as "this card's grid slot falls back to a plain placeholder,"
 * never as an error -- the same per-card degrade legendArt.js/
 * legendArtCache.js already establish for the Legend avatar pipeline.
 */
export async function resolveCardArt(cardName) {
  try {
    const queryName = toRiftcodexQueryName(cardName)
    if (!queryName) return null

    const result = await fetchExactName(queryName)
    const items = Array.isArray(result?.items) ? result.items : []
    if (items.length === 0) return null

    const card = items.find(isCanonicalPrinting) ?? items[0]
    const imageUrl = card?.media?.image_url ?? null
    if (!imageUrl) return null

    return {
      imageUrl,
      cost: typeof card?.attributes?.energy === 'number' ? card.attributes.energy : null,
      orientation: card?.orientation === 'landscape' ? 'landscape' : 'portrait'
    }
  } catch (err) {
    console.error(`Riftcodex card art lookup failed for "${cardName}":`, err)
    return null
  }
}
