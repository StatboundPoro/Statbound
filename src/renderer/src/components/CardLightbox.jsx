import { useEffect, useRef } from 'react'
import { useFullCardArt } from './DecklistCardArt.jsx'

// Deck Detail Grid view's card lightbox: an enlarged view of one card's
// full, uncropped image (art + frame + name + rules text, exactly as
// Riftcodex serves it -- see src/main/cardArtFullCache.js, a cache
// entirely separate from Grid's own cropped/uncropped tile thumbnails).
// `cards` is the exact sorted array the section currently being viewed
// rendered its tiles from (DeckDetail.jsx snapshots it at click time), and
// `index` is this card's position within it -- Next/Previous walk that
// same array, so navigation always respects whatever sort was active and
// never crosses into a different section. Dismissible via its own close
// button, an outside click, or Escape -- the same convention
// DeckChangelogPanel.jsx's slide-out panel and LegendAutocomplete's
// suggestion dropdown already establish elsewhere in the app.
export default function CardLightbox({ cards, index, onClose, onNavigate }) {
  const card = cards[index]
  // undefined = still resolving (first open of this card), null = resolved
  // but unavailable (no Riftcodex match, network failure/timeout), a
  // string = the ready-to-render statbound-card-art-full:// URL.
  const fullUrl = useFullCardArt(card.name)

  const contentRef = useRef(null)
  const canGoPrev = index > 0
  const canGoNext = index < cards.length - 1

  useEffect(() => {
    function handlePointerDown(e) {
      if (contentRef.current && !contentRef.current.contains(e.target)) {
        onClose()
      }
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowLeft' && canGoPrev) {
        onNavigate(index - 1)
      } else if (e.key === 'ArrowRight' && canGoNext) {
        onNavigate(index + 1)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, onNavigate, index, canGoPrev, canGoNext])

  return (
    <div className="lightbox-backdrop">
      <div className="lightbox-content" ref={contentRef}>
        <button type="button" className="lightbox-close" onClick={onClose} aria-label="Close" title="Close">
          <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>

        {canGoPrev && (
          <button
            type="button"
            className="lightbox-nav lightbox-nav-prev"
            onClick={() => onNavigate(index - 1)}
            aria-label="Previous card"
            title="Previous card"
          >
            <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
              <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {canGoNext && (
          <button
            type="button"
            className="lightbox-nav lightbox-nav-next"
            onClick={() => onNavigate(index + 1)}
            aria-label="Next card"
            title="Next card"
          >
            <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
              <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        <div className="lightbox-image-wrap">
          {fullUrl === undefined && <div className="lightbox-status">Loading…</div>}
          {fullUrl === null && <div className="lightbox-status">Image unavailable</div>}
          {fullUrl && <img src={fullUrl} alt={card.name} className="lightbox-image" />}
        </div>
      </div>
    </div>
  )
}
