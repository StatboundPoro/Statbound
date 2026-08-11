// Maps Riftbound's six domains to the color/icon system from the design
// mockup. Domain names come straight from the decks table (domain_1 /
// domain_2), so lookups are case-insensitive to stay tolerant of how the
// user types them.
const DOMAINS = {
  fury: { color: 'var(--fury)' },
  calm: { color: 'var(--calm)' },
  mind: { color: 'var(--mind)' },
  body: { color: 'var(--body)' },
  chaos: { color: 'var(--chaos)' },
  order: { color: 'var(--order)' }
}

const FALLBACK_COLOR = 'var(--text-faint)'

export function domainColor(domain) {
  if (!domain) return FALLBACK_COLOR
  return DOMAINS[domain.toLowerCase()]?.color ?? FALLBACK_COLOR
}

export function DomainGlyph({ domain }) {
  const key = domain?.toLowerCase()

  switch (key) {
    case 'fury':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3z"
            stroke="#ECE9E2"
            strokeWidth="1.6"
          />
        </svg>
      )
    case 'body':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <rect x="4" y="4" width="16" height="16" rx="2" stroke="#ECE9E2" strokeWidth="1.6" />
        </svg>
      )
    case 'mind':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="7" stroke="#ECE9E2" strokeWidth="1.6" />
          <path d="M12 5v14" stroke="#ECE9E2" strokeWidth="1.6" />
        </svg>
      )
    case 'chaos':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M4 4l16 16M20 4L4 20" stroke="#ECE9E2" strokeWidth="1.6" />
        </svg>
      )
    case 'calm':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M12 4c4 3 4 7 0 16c-4-9-4-13 0-16z" stroke="#ECE9E2" strokeWidth="1.6" />
        </svg>
      )
    case 'order':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="8" cy="8" r="2.5" stroke="#ECE9E2" strokeWidth="1.5" />
          <circle cx="16" cy="8" r="2.5" stroke="#ECE9E2" strokeWidth="1.5" />
          <circle cx="12" cy="17" r="2.5" stroke="#ECE9E2" strokeWidth="1.5" />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="7" stroke="#ECE9E2" strokeWidth="1.6" opacity="0.5" />
        </svg>
      )
  }
}
