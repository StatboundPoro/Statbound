// Data behind Settings' Appearance section (see SettingsScreen.jsx) --
// generates all 15 unique two-Domain accent-theme combinations (6 Domains,
// choose 2, unordered) for the picker's swatch grid. This file only powers
// the picker's rendering (labels, swatch colors, ids to persist); the
// actual color swap that applying a theme performs is pure CSS cascade --
// see styles.css's DOMAIN-PAIR ACCENT THEMES block, which must be kept in
// sync by hand with this file's own DOMAIN_HEX values (the same tradeoff
// lib/appMark.jsx and MatchupMatrixScreen.jsx's heatmap already make for
// their own color constants).

// Fixed priority order, not alphabetical -- matches the order this app's
// own CSS/CLAUDE.md already list the six Domains in. Whichever Domain in a
// pair comes first here becomes that combination's "primary" color; the
// other becomes "secondary." This is the single deterministic rule that
// decides primary/secondary for every combination below, so it's never
// arbitrary per-pair.
const DOMAIN_ORDER = ['fury', 'calm', 'mind', 'body', 'chaos', 'order']

const DOMAIN_LABELS = {
  fury: 'Fury',
  calm: 'Calm',
  mind: 'Mind',
  body: 'Body',
  chaos: 'Chaos',
  order: 'Order'
}

// Sampled directly from the real Domain PNGs (matching
// build/statbound-icon.svg / lib/appMark.jsx's crest colors) --
// deliberately NOT the same hex values as lib/domains.jsx's domainColor()
// (those are lighter/more saturated, used for every existing in-app Domain
// identity surface: pills, crest fallback, the Matchup Matrix heatmap,
// WelcomeTour's per-step icons -- all untouched by this feature). Keep
// these in sync by hand with styles.css's own --domain-theme-* copy of the
// same six values if this palette ever changes.
const DOMAIN_HEX = {
  fury: '#B32F29',
  calm: '#63A066',
  mind: '#23779B',
  body: '#E2700D',
  chaos: '#9679A7',
  order: '#CEA903'
}

export const DEFAULT_THEME_ID = 'default'

export const DOMAIN_THEMES = (() => {
  const combos = []
  for (let i = 0; i < DOMAIN_ORDER.length; i++) {
    for (let j = i + 1; j < DOMAIN_ORDER.length; j++) {
      const primary = DOMAIN_ORDER[i]
      const secondary = DOMAIN_ORDER[j]
      combos.push({
        id: `${primary}-${secondary}`,
        label: `${DOMAIN_LABELS[primary]} + ${DOMAIN_LABELS[secondary]}`,
        primaryColor: DOMAIN_HEX[primary],
        secondaryColor: DOMAIN_HEX[secondary]
      })
    }
  }
  return combos
})()

/**
 * Applies a theme id to the document immediately -- 'default' (or any
 * unrecognized id) removes data-theme entirely, so styles.css's :root
 * defaults apply unchanged; any real combination id sets it, and
 * styles.css's DOMAIN-PAIR ACCENT THEMES rules take over from there via
 * plain CSS cascade. Called both for live, no-restart-required application
 * from Settings' picker and (via preload's own copy of this same id list,
 * kept in sync by hand -- see src/preload/index.js) once at startup before
 * first paint.
 */
export function applyDomainTheme(themeId) {
  if (themeId && themeId !== DEFAULT_THEME_ID) {
    document.documentElement.setAttribute('data-theme', themeId)
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
}
