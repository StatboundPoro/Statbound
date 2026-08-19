import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import sharp from 'sharp'
import { app } from 'electron'
import { resolveCardArt } from './services/cardArt.js'
import { STAGE1_HEIGHT_FRACTION, STAGE1_INSET_FRACTION } from './legendArtCache.js'

// Deck Detail Grid view's card-art pipeline -- a second, separate cache/crop
// treatment from legendArtCache.js's deck-avatar pipeline, sharing only
// Stage 1's fixed art-region crop (imported above, not duplicated) and the
// general "download once, crop once, cache to disk keyed by normalized
// name" shape. Legend avatar's Stage 2 (the tight face-zoom square crop) is
// never applied here, and this file never touches legendArtCache.js's own
// crop logic. Even Stage 1 is conditional here, unlike the Legend avatar's
// always-applied Stage 1: Main Deck/Battlefields/Sideboard cards get it
// (cropMode 'auto', skipping the crop only for a landscape source), while
// Legend/Champion/Runes show their full source image uncropped (cropMode
// 'none') -- see cropCardArt() and getCardArtCachePath() below.
//
// Cache key is the normalized CARD name plus crop mode, not a deck id or
// section -- any number of decks sharing a staple card (or the same card
// appearing in one deck's Main Deck and Sideboard) all reuse one cached
// file on disk, the same principle legendArtCache.js already applies per
// Legend name.
//
// Bumped from an initial 220 once the decklist layout moved Battlefields/
// Runes up alongside Legend/Champion (see DeckDetail.jsx's SECTIONS and
// styles.css's .decklist-grid) freed up room for Grid view's tiles to
// render bigger (.card-art-grid's minmax went from 84px to 112px) -- sized
// with headroom over that display width for a crisp render on high-DPI
// screens rather than the browser upscaling a smaller cached file. Only
// affects newly-cached cards; anything already cached at 220px stays that
// size until its cache entry is cleared (this is a disposable local
// performance cache, not user data, so no migration is needed).
const OUTPUT_WIDTH = 300

function normalizeCardName(cardName) {
  return cardName.trim().toLowerCase()
}

function cacheDir() {
  return path.join(app.getPath('userData'), 'cardArt')
}

// cropMode is folded into the cache key alongside the card name -- 'auto'
// (Stage 1 on portrait cards, full image on landscape -- see cropCardArt()
// below) or 'none' (always the full image, Legend/Champion/Runes' explicit
// choice). Card names are never shared across a cropped section and an
// uncropped one in practice (a Legend/Champion/Rune name never collides
// with a Main Deck/Battlefield/Sideboard card name), so this is defensive
// correctness rather than something expected to matter day to day -- but
// it means a name is never served under the wrong crop treatment even if
// that assumption is ever wrong.
function cacheHash(cardName, cropMode) {
  return crypto.createHash('sha1').update(`${normalizeCardName(cardName)}|${cropMode}`).digest('hex')
}

function cacheFilePath(cardName, cropMode) {
  return path.join(cacheDir(), `${cacheHash(cardName, cropMode)}.png`)
}

// A small sidecar holding the card's cost (Riftcodex's attributes.energy),
// written once alongside the cropped image and read back on every later
// cache hit -- so the Grid view's cost sort never needs a second network
// round trip once a card's art is already cached. There's no dedicated
// "card metadata" table for this one small value, so a sidecar file next to
// the cached image (mirroring capture.js's own sidecar-JSON-next-to-a-media-
// file pattern for recordings, at a much smaller scale) is simpler than
// standing up a new SQLite table for it.
function sidecarFilePath(cardName, cropMode) {
  return path.join(cacheDir(), `${cacheHash(cardName, cropMode)}.json`)
}

function readSidecarCost(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    return typeof data.cost === 'number' ? data.cost : null
  } catch {
    return null
  }
}

// Stage 1, reusing legendArtCache.js's exact template (top ~58% of the
// source image's height, inset ~4% from the left/right edges) -- confirmed
// there to reliably strip the rules-text box and card frame on real
// portrait Riftbound cards. Only applied when cropMode is 'auto' AND the
// card is portrait: landscape cards (Battlefields -- confirmed live via the
// Riftcodex API to be the one landscape card type, with Legend/Unit/Spell/
// Gear all portrait) always skip it regardless of cropMode, since Stage 1's
// height/inset fractions were only ever verified against a portrait card's
// frame layout and would crop an arbitrary region on a landscape image
// rather than actually removing anything specific to that layout. cropMode
// 'none' skips it too, on any orientation -- Legend, Champion, and Runes
// show the full card (art, frame, and rules text) uncropped, a deliberate
// product decision that the full card reads better for those three
// sections than an art-only tile.
async function cropCardArt(sourceBuffer, orientation, cropMode) {
  const { width, height } = await sharp(sourceBuffer).metadata()
  if (!width || !height) throw new Error('Card art source has no readable dimensions')

  let pipeline = sharp(sourceBuffer)

  if (cropMode !== 'none' && orientation !== 'landscape') {
    const insetX = Math.round(width * STAGE1_INSET_FRACTION)
    const cropWidth = width - insetX * 2
    const cropHeight = Math.round(height * STAGE1_HEIGHT_FRACTION)
    pipeline = pipeline.extract({ left: insetX, top: 0, width: cropWidth, height: cropHeight })
  }

  // Downscale only (withoutEnlargement), same "never upscale" principle
  // legendArtCache.js's own encode and capture.js's video encode already
  // follow. No forced square here (unlike the Legend avatar) -- a card's
  // natural aspect ratio is kept, cropped or not, since these render as
  // grid tiles, not circular/square portraits.
  return pipeline
    .resize({ width: OUTPUT_WIDTH, withoutEnlargement: true })
    .png()
    .toBuffer()
}

async function downloadCropAndCache(cardName, imageUrl, orientation, cost, cropMode) {
  const response = await fetch(imageUrl)
  if (!response.ok) throw new Error(`Card art download failed: HTTP ${response.status}`)
  const sourceBuffer = Buffer.from(await response.arrayBuffer())

  const cropped = await cropCardArt(sourceBuffer, orientation, cropMode)

  const destPath = cacheFilePath(cardName, cropMode)
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  fs.writeFileSync(destPath, cropped)
  fs.writeFileSync(sidecarFilePath(cardName, cropMode), JSON.stringify({ cost }))
}

// Dedupes concurrent lookups for the same card name + crop mode -- e.g.
// Deck Detail's Grid view opening with several distinct cards all kicking
// off their first lookup at once -- so only one fetch/crop/cache pipeline
// ever runs per (name, cropMode) pair no matter how many callers ask at the
// same moment. Same pattern legendArtCache.js's own inFlight map already
// establishes.
const inFlight = new Map()

async function resolveAndCache(cardName, cropMode) {
  try {
    const filePath = cacheFilePath(cardName, cropMode)
    if (fs.existsSync(filePath)) {
      return { filePath, cost: readSidecarCost(sidecarFilePath(cardName, cropMode)) }
    }

    const resolved = await resolveCardArt(cardName)
    if (!resolved) return null
    await downloadCropAndCache(cardName, resolved.imageUrl, resolved.orientation, resolved.cost, cropMode)

    return { filePath, cost: resolved.cost }
  } catch (err) {
    // Network failure, a card that can't be matched against Riftcodex, a
    // malformed image, a crop failure -- all fall back to null, which every
    // caller treats as "show this card's plain placeholder instead," never
    // a visible error, and never something that blocks the rest of the
    // grid. Same progressive-enhancement pattern as the Legend avatar
    // pipeline and match result auto-fill.
    console.error(`Card art lookup failed for "${cardName}":`, err)
    return null
  }
}

/**
 * Returns { filePath, cost } for one card's cached art, or null if no art
 * is available for any reason. `cropMode` is `'auto'` (Stage 1 on portrait
 * cards, full image on landscape -- the default, used by Main Deck/
 * Battlefields/Sideboard) or `'none'` (always the full, uncropped source
 * image -- used by Legend/Champion/Runes; see cropCardArt() above).
 * ipc.js turns filePath into a statbound-card-art:// URL via
 * cardArtProtocol.js's cardArtFileUrl(). Resolves instantly on a cache
 * hit -- including across app restarts -- and only reaches the network on
 * a genuine miss: the first time Deck Detail's Grid view is opened for a
 * deck containing this card (at this crop mode) and no earlier deck has
 * already triggered its resolution this run. Never called eagerly for a
 * deck's full card list -- only for whichever cards a caller actually asks
 * about, which DecklistCardArt.jsx only does once Grid view is actually
 * showing.
 */
export function getCardArtCachePath(cardName, cropMode = 'auto') {
  if (!cardName) return Promise.resolve(null)
  const normalizedCropMode = cropMode === 'none' ? 'none' : 'auto'

  const key = `${normalizeCardName(cardName)}|${normalizedCropMode}`
  if (!inFlight.has(key)) {
    inFlight.set(
      key,
      resolveAndCache(cardName, normalizedCropMode).finally(() => inFlight.delete(key))
    )
  }
  return inFlight.get(key)
}
