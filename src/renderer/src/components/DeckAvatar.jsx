import { useEffect, useState } from 'react'
import { domainColor } from '../lib/domains.jsx'
import { domainIcon } from '../lib/domainIcons.js'

// In-memory, this-session-only cache of resolved art data URLs (or null for
// "no art available") keyed by Legend name -- so navigating between screens
// or mounting many DeckCards for the same Legend never re-invokes the
// legend-art IPC round trip once that Legend's art has already resolved
// once this session. The real cache (survives restarts) lives on disk in
// main, see src/main/legendArtCache.js; this is just a render-cheap layer
// on top of it.
const artUrlCache = new Map()

const SIZE_CLASSES = {
  xs: 'deck-avatar-xs',
  md: 'deck-avatar-md',
  lg: 'deck-avatar-lg'
}

/**
 * Renders a deck's Legend-art portrait avatar -- a rounded-square crop of
 * its Legend's own card art, sourced from Riftcodex and cached locally (see
 * src/main/legendArtCache.js) -- falling back to the existing diagonal
 * two-Domain-color crest whenever art isn't available for any reason (no
 * network, no Riftcodex match, a download/crop failure). This is always a
 * silent, progressive-enhancement fallback, never a visible error state --
 * see CLAUDE.md's Design Language entry.
 *
 * `deck` may be null/undefined (e.g. MatchDetailModal renders this before
 * its own deck fetch resolves) -- every field read below is optional-
 * chained, degrading straight to the crest fallback's own "unknown domain"
 * rendering rather than throwing.
 *
 * `size` selects a CSS size/radius variant ('xs' for the Matchup Matrix's
 * column header, 'md' for DeckCard/Match Detail/Import Deck's preview, 'lg'
 * for Deck Detail's header); `showGlyphs` only affects the crest fallback's
 * own small Domain-icon overlay (matches whichever crest this is replacing
 * at each call site). The real art avatar never shows a Domain-color ring
 * or icon overlay of its own -- the Domain pills/text elsewhere already
 * convey that.
 */
export default function DeckAvatar({ deck, size = 'md', showGlyphs = false, className = '' }) {
  const legendName = deck?.legend_name
  const [artUrl, setArtUrl] = useState(() => (legendName ? (artUrlCache.get(legendName) ?? null) : null))

  useEffect(() => {
    if (!legendName) {
      setArtUrl(null)
      return
    }
    if (artUrlCache.has(legendName)) {
      setArtUrl(artUrlCache.get(legendName))
      return
    }

    let cancelled = false
    window.api.legendArt.getUrl(legendName).then((url) => {
      artUrlCache.set(legendName, url)
      if (!cancelled) setArtUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [legendName])

  const sizeClass = SIZE_CLASSES[size] ?? SIZE_CLASSES.md

  if (artUrl) {
    return (
      <div className={`deck-avatar ${sizeClass} ${className}`}>
        <img src={artUrl} alt="" />
      </div>
    )
  }

  return (
    <div className={`deck-avatar deck-avatar-crest ${sizeClass} ${className}`}>
      <div className="half a" style={{ background: domainColor(deck?.domain_1) }} />
      <div className="half b" style={{ background: domainColor(deck?.domain_2) }} />
      {showGlyphs && (
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
      )}
    </div>
  )
}
