// Resolves a deck's own Legend name to its card art image URL on Riftcodex
// (api.riftcodex.com), the same free/open/no-auth API legendSync.js already
// uses for the Legend name registry. This is a separate module with its own
// separate in-memory cache -- legendSync.js's sync is a throttled,
// once-a-day background job that only cares about names; this one is
// triggered lazily, the first time a deck with a given Legend is actually
// displayed, and additionally needs each matching card's art URL.
//
// Confirmed live (not assumed from docs): GET /cards has no server-side
// name or type filter -- a `name=`/`search=` query param is silently
// ignored, same finding legendSync.js's own comment already documents for
// the type filter. Finding one Legend's art therefore means paginating the
// same way legendSync.js's name sync does. At the time of writing this is a
// small, cheap catalog (15 pages at the API's own max page size of 100), so
// building the full index once per app run and reusing it for every
// subsequent distinct Legend lookup is fine -- nothing here is re-fetched
// per deck, only once per Legend name per app run at most, and never at all
// once that Legend's cropped art is cached to disk (see legendArtCache.js).
import { RIFTCODEX_BASE, transformLegendName } from './legendSync.js'

const LEGEND_CARD_TYPE = 'Legend'
const PAGE_SIZE = 100
// Defensive cap, not a real expectation -- mirrors legendSync.js's own
// MAX_PAGES guard for the same reason (never loop forever if a future API
// response shape stops giving a sane `pages` value).
const MAX_PAGES = 200

function normalizeForLookup(name) {
  return name.trim().toLowerCase()
}

async function fetchCardsPage(page) {
  const url = `${RIFTCODEX_BASE}/cards?page=${page}&size=${PAGE_SIZE}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Riftcodex /cards request failed: HTTP ${response.status}`)
  }
  return response.json()
}

// A card counts as a "canonical" printing if it's not a Signature,
// Alternate Art, or Overnumbered variant -- preferred as the cached
// avatar's source art over a special-printing variant, but not required: if
// a Legend only ever appears as a special printing, that's used rather than
// leaving it with no art at all.
function isCanonicalPrinting(card) {
  const metadata = card?.metadata ?? {}
  return !metadata.alternate_art && !metadata.overnumbered && !metadata.signature
}

async function buildLegendArtIndex() {
  const index = new Map()

  const collectFromPage = (page) => {
    for (const card of page.items) {
      if (card?.classification?.type !== LEGEND_CARD_TYPE) continue
      const name = transformLegendName(card.name)
      const imageUrl = card?.media?.image_url
      if (!name || !imageUrl) continue

      const key = normalizeForLookup(name)
      const existing = index.get(key)
      if (!existing || (!isCanonicalPrinting(existing.card) && isCanonicalPrinting(card))) {
        index.set(key, { imageUrl, card })
      }
    }
  }

  const first = await fetchCardsPage(1)
  if (!Array.isArray(first?.items)) return index
  collectFromPage(first)

  const totalPages = Math.min(Number(first.pages) || 1, MAX_PAGES)
  for (let page = 2; page <= totalPages; page++) {
    const next = await fetchCardsPage(page)
    if (!Array.isArray(next?.items)) break
    collectFromPage(next)
  }

  return index
}

let cachedIndexPromise = null

function getLegendArtIndex() {
  if (!cachedIndexPromise) {
    cachedIndexPromise = buildLegendArtIndex().catch((err) => {
      console.error('Riftcodex legend art fetch failed:', err)
      // Don't cache the failure itself -- allow a fresh attempt on the next
      // lazy lookup rather than treating one transient network drop as "no
      // art, ever, for the rest of this app run."
      cachedIndexPromise = null
      return new Map()
    })
  }
  return cachedIndexPromise
}

/**
 * Resolves one deck's Legend name to its Riftcodex card art image URL, or
 * null if it can't be found for any reason (no network, no matching card,
 * a malformed response). Callers treat null as "fall back to the crest,"
 * never as an error -- see legendArtCache.js.
 */
export async function resolveLegendArtUrl(legendName) {
  if (!legendName) return null
  const index = await getLegendArtIndex()
  return index.get(normalizeForLookup(legendName))?.imageUrl ?? null
}
