// Optional, additive-only crop offsets for individual Legends whose card art
// doesn't land well under legendArtCache.js's default Stage 2 crop (a loose,
// top-anchored/horizontally-centered square -- see that file's own comment
// for why it's deliberately forgiving rather than a tight face crop). This
// file is NOT something to pre-populate ahead of time -- it starts empty and
// stays that way until one specific Legend's cached avatar is actually
// noticed looking bad. At that point, add one entry for just that Legend;
// nothing else needs touching or re-curating.
//
// Keyed by the Legend name normalized the same way legendArtCache.js
// normalizes for its own cache filename (trimmed, lowercased). Each value is
// { x, y }, both 0-1 fractions of the *slack* available around the default
// square crop within Stage 1's art region -- 0 docks the square to the
// default crop's start edge, 1 docks it to the opposite edge, 0.5 centers it
// (the default for both axes' worth of slack). x shifts the square
// horizontally, y shifts it vertically; the square's size itself is never
// overridden, only its position within Stage 1's region.
export const LEGEND_ART_CROP_OVERRIDES = {}
