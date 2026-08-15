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
