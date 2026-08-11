// Parses the plain-text decklist format exported by the game client into a
// structured deck record. Sections are marked by a header line ending in
// ":" (Legend, Champion, MainDeck, Battlefields, Runes, Sideboard); each
// card line below a header is "<count> <name>", split only on the first
// space since card names can themselves contain commas (e.g.
// "LeBlanc, Deceiver").

export class DecklistParseError extends Error {}

const SECTION_KEYS = {
  legend: 'legend',
  champion: 'champion',
  maindeck: 'main',
  battlefields: 'battlefields',
  runes: 'runes',
  sideboard: 'sideboard'
}

const SECTION_TITLES = [
  ['legend', 'Legend'],
  ['champion', 'Champion'],
  ['main', 'MainDeck'],
  ['battlefields', 'Battlefields'],
  ['runes', 'Runes'],
  ['sideboard', 'Sideboard']
]

function sumCounts(cards) {
  return cards.reduce((sum, card) => sum + card.count, 0)
}

// The inverse of parseDecklist: turns a stored decklist object back into
// the same paste format, so editing a saved deck can start from a textarea
// pre-filled with its current contents instead of a blank one.
export function serializeDecklist(decklist) {
  return SECTION_TITLES.map(([key, title]) => {
    const cards = decklist?.[key] ?? []
    return [`${title}:`, ...cards.map((card) => `${card.count} ${card.name}`)].join('\n')
  }).join('\n\n')
}

export function parseDecklist(text) {
  if (!text || !text.trim()) {
    throw new DecklistParseError('Paste a decklist first.')
  }

  const sections = { legend: [], champion: [], main: [], battlefields: [], runes: [], sideboard: [] }
  let currentSection = null

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    const headerMatch = line.match(/^([A-Za-z]+):$/)
    if (headerMatch) {
      const sectionKey = SECTION_KEYS[headerMatch[1].toLowerCase()]
      if (!sectionKey) {
        throw new DecklistParseError(`Unrecognized section header: "${line}"`)
      }
      currentSection = sectionKey
      continue
    }

    if (!currentSection) {
      throw new DecklistParseError(`Expected a section header before "${line}"`)
    }

    const spaceIndex = line.indexOf(' ')
    if (spaceIndex === -1) {
      throw new DecklistParseError(`Could not parse card line: "${line}"`)
    }

    const count = Number(line.slice(0, spaceIndex))
    const name = line.slice(spaceIndex + 1).trim()

    if (!Number.isInteger(count) || count <= 0 || !name) {
      throw new DecklistParseError(`Could not parse card line: "${line}"`)
    }

    sections[currentSection].push({ count, name })
  }

  // Riftbound decks have a fixed shape: exactly one Legend, exactly one
  // Chosen (Champion), a 39-card main deck, 3 battlefields, 12 runes, and
  // an optional sideboard that's either empty or exactly 10 cards.
  const legendCount = sumCounts(sections.legend)
  const championCount = sumCounts(sections.champion)
  const mainCount = sumCounts(sections.main)
  const battlefieldsCount = sumCounts(sections.battlefields)
  const runesCount = sumCounts(sections.runes)
  const sideboardCount = sumCounts(sections.sideboard)

  if (legendCount !== 1) {
    throw new DecklistParseError(`"Legend:" must have exactly 1 card (found ${legendCount}).`)
  }
  if (championCount !== 1) {
    throw new DecklistParseError(`"Champion:" must have exactly 1 card (found ${championCount}).`)
  }
  if (mainCount !== 39) {
    throw new DecklistParseError(`"MainDeck:" must have exactly 39 cards (found ${mainCount}).`)
  }
  if (battlefieldsCount !== 3) {
    throw new DecklistParseError(`"Battlefields:" must have exactly 3 cards (found ${battlefieldsCount}).`)
  }
  if (runesCount !== 12) {
    throw new DecklistParseError(`"Runes:" must have exactly 12 cards (found ${runesCount}).`)
  }
  if (sideboardCount !== 0 && sideboardCount !== 10) {
    throw new DecklistParseError(
      `"Sideboard:" must be empty or have exactly 10 cards (found ${sideboardCount}).`
    )
  }

  // Domains come straight from the Runes section rather than a card/legend
  // database lookup: "Order Rune" + "Mind Rune" -> Order + Mind, ordered by
  // rune count so the primary domain (usually the higher count) comes first.
  const domains = [...sections.runes]
    .sort((a, b) => b.count - a.count)
    .map((rune) => rune.name.replace(/\s+Rune$/i, '').trim())

  const [domain_1 = null, domain_2 = null] = domains

  const legend = sections.legend[0]
  const champion = sections.champion[0] ?? null

  return {
    name: champion?.name ?? legend.name,
    domain_1,
    domain_2,
    legend_name: legend.name,
    decklist: sections,
    summary: {
      legendCount,
      championCount,
      mainCount,
      battlefieldsCount,
      runesCount,
      sideboardCount,
      // Total includes the Legend and Champion as real deck slots, not
      // just the Main/Battlefields/Runes/Sideboard pile counts.
      totalCount: legendCount + championCount + mainCount + battlefieldsCount + runesCount + sideboardCount
    }
  }
}
