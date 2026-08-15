// The `?no-inline` suffix forces Vite to always emit these as real asset
// files rather than inlining small ones as base64 data: URIs (its default
// for anything under 4kb, which these all are — plain `?url` still allows
// inlining, it only picks the import shape). The app's CSP is `default-src
// 'self'` with no `data:` allowance, so an inlined icon silently fails to
// load in a production build despite rendering fine in dev (where Vite
// serves everything, inlined or not, from its own dev-server origin).
import body from '../assets/domains/body.png?no-inline'
import calm from '../assets/domains/calm.png?no-inline'
import chaos from '../assets/domains/chaos.png?no-inline'
import fury from '../assets/domains/fury.png?no-inline'
import mind from '../assets/domains/mind.png?no-inline'
import order from '../assets/domains/order.png?no-inline'

// Keyed lowercase since domain names come straight from the decks table
// (domain_1/domain_2, ultimately parsed from a deck's Runes section text)
// with no guaranteed casing — see domainIcon()'s normalization below.
export const DOMAIN_ICONS = {
  body,
  calm,
  chaos,
  fury,
  mind,
  order
}

export function domainIcon(domain) {
  if (!domain) return null
  return DOMAIN_ICONS[domain.toLowerCase()] ?? null
}
