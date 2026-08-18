// Fetches the current list of real Riftbound Legend names from Riftcodex
// (api.riftcodex.com), a free, open, no-authentication REST API for
// Riftbound card data modeled on Scryfall. Outbound-only and read-only: this
// module only ever GETs public card data and never transmits anything about
// the user, their decks, or their matches — see CLAUDE.md's corrected trust
// claim wording for why that's consistent with the app's local-only design.
//
// Confirmed against the live API (not assumed from docs alone, which don't
// document a type filter): GET /cards has no server-side filter for
// card type, so this paginates through every card and filters
// classification.type === 'Legend' client-side. The exact 'Legend' string
// was confirmed via GET /index/card-types, which enumerates
// ["Battlefield","Gear","Legend","Rune","Spell","Unit"].
const RIFTCODEX_BASE = 'https://api.riftcodex.com'
const LEGEND_CARD_TYPE = 'Legend'
const PAGE_SIZE = 100
// Defensive cap, not a real expectation -- Riftcodex's own `pages` field
// drives the real loop bound. Guards against ever looping forever if a
// future API response shape stops giving a sane pages value.
const MAX_PAGES = 200

/**
 * Transforms one Riftcodex card name into this app's existing
 * "Name, Title" convention (matches decks.legend_name, deck_notes.scope,
 * and matches.opponent_legend, all of which already use a comma -- see
 * CLAUDE.md's Deck Import Format). Riftcodex names use a hyphen instead
 * ("Tryndamere - Barbarian"), and printing variants append a trailing
 * parenthetical ("Vi - Piltover Enforcer (Signature)", "(Overnumbered)",
 * "(Metal)", "(Alternate Art)", "(Starter)") that must be stripped first.
 *
 * Returns null (never a guessed/partial name) for anything that doesn't
 * cleanly fit that shape. Verified against a real, full pull of every
 * Legend printing from the live API: a small number of cards (all from one
 * in-progress set at the time of writing) ship with malformed `name` fields
 * upstream -- missing the champion prefix entirely (just "Butcher of the
 * Sands"), or with a stray comma already baked into the champion part
 * ("Yordle, Kennen - Heart of the Tempest", a race-tag artifact). Both are
 * rejected here rather than guessed at, matching this app's standing "never
 * fabricate a value" rule (see e.g. matchResultCapture.js) -- the bundled
 * fallback list covers any Legend a rejection like this leaves out.
 */
export function transformLegendName(rawName) {
  if (typeof rawName !== 'string') return null

  const base = rawName.replace(/\s*\([^)]*\)\s*$/, '').trim()
  const parts = base.split(' - ')
  if (parts.length !== 2) return null

  const champion = parts[0].trim()
  const title = parts[1].trim()
  if (!champion || !title || champion.includes(',')) return null

  return `${champion}, ${title}`
}

async function fetchCardsPage(page) {
  const url = `${RIFTCODEX_BASE}/cards?page=${page}&size=${PAGE_SIZE}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Riftcodex /cards request failed: HTTP ${response.status}`)
  }
  return response.json()
}

/**
 * Fetches every Legend card from Riftcodex, transforms each name to this
 * app's comma convention, and returns the deduplicated result. Never
 * throws -- a network failure, an unexpected response shape, or an empty
 * result all resolve to null, so callers can treat "no usable result" as
 * one uniform case and fall back to the bundled snapshot rather than
 * leaving the legends table stuck mid-update.
 */
export async function fetchLegendsFromRiftcodex() {
  try {
    const names = new Set()

    const first = await fetchCardsPage(1)
    if (!Array.isArray(first?.items)) return null

    const collectFromPage = (page) => {
      for (const card of page.items) {
        if (card?.classification?.type !== LEGEND_CARD_TYPE) continue
        const name = transformLegendName(card.name)
        if (name) names.add(name)
      }
    }
    collectFromPage(first)

    const totalPages = Math.min(Number(first.pages) || 1, MAX_PAGES)
    for (let page = 2; page <= totalPages; page++) {
      const next = await fetchCardsPage(page)
      if (!Array.isArray(next?.items)) break
      collectFromPage(next)
    }

    return names.size > 0 ? [...names] : null
  } catch (err) {
    console.error('Riftcodex legend fetch failed:', err)
    return null
  }
}
