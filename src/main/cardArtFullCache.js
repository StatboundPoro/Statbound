import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { app } from 'electron'
import { fetchWithTimeout, resolveCardArt } from './services/cardArt.js'

// Deck Detail Grid view's card lightbox pipeline -- a THIRD, separate
// cache from both legendArtCache.js's deck-avatar pipeline and
// cardArtCache.js's Grid-tile pipeline, all three keyed by normalized name
// but living in their own userData subfolder
// (legendArt/, cardArt/, cardArtFull/ respectively) so none of them can
// ever read or overwrite another's files. No sharp involved here at all --
// no Stage 1, no Stage 2, not even a resize: the raw downloaded bytes are
// written to disk exactly as Riftcodex serves them, since the lightbox
// wants the genuine full card (art, frame, name, and rules text) at its
// real resolution, not a thumbnail. This is why it's a separate cache
// rather than "just" a bigger/uncropped cardArtCache.js entry -- Grid's
// own tiles (cardArtCache.js) are deliberately small and, as of the most
// recent pass, already uncropped too, but still downscaled/re-encoded for
// fast eager loading across a whole decklist; the lightbox is the opposite
// case -- one card at a time, fetched lazily only on an explicit click,
// where full fidelity matters more than file size.
function normalizeCardName(cardName) {
  return cardName.trim().toLowerCase()
}

function cacheDir() {
  return path.join(app.getPath('userData'), 'cardArtFull')
}

function cacheFilePath(cardName) {
  const hash = crypto.createHash('sha1').update(normalizeCardName(cardName)).digest('hex')
  return path.join(cacheDir(), `${hash}.png`)
}

async function downloadAndCacheFull(cardName, imageUrl) {
  const response = await fetchWithTimeout(imageUrl)
  if (!response.ok) throw new Error(`Full card art download failed: HTTP ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())

  const destPath = cacheFilePath(cardName)
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  fs.writeFileSync(destPath, buffer)
}

// Dedupes concurrent lookups for the same card name -- e.g. a fast
// double-click, or reopening the lightbox on a card whose first fetch
// hasn't resolved yet -- so only one download ever runs per card name at a
// time. Same pattern legendArtCache.js's and cardArtCache.js's own
// inFlight maps already establish.
const inFlight = new Map()

async function resolveAndCacheFull(cardName) {
  try {
    const filePath = cacheFilePath(cardName)
    if (fs.existsSync(filePath)) return filePath

    const resolved = await resolveCardArt(cardName)
    if (!resolved) return null
    await downloadAndCacheFull(cardName, resolved.imageUrl)

    return filePath
  } catch (err) {
    // Network failure (including a timeout -- see fetchWithTimeout), no
    // Riftcodex match, a malformed response: all fall back to null, and
    // -- same as cardArtCache.js/legendArtCache.js -- nothing is ever
    // written to disk on failure, so a transient failure is retried the
    // next time this card's lightbox is opened rather than being
    // permanently remembered as unavailable. The renderer (CardLightbox.jsx)
    // treats null as "show an Image unavailable state," never a crash.
    console.error(`Full card art lookup failed for "${cardName}":`, err)
    return null
  }
}

/**
 * Returns the absolute on-disk path to one card's cached, full-resolution,
 * completely uncropped source image (ipc.js turns this into a
 * statbound-card-art-full:// URL via cardArtFullProtocol.js's
 * cardArtFullFileUrl()), or null if unavailable for any reason. Resolves
 * instantly on a cache hit -- including across app restarts -- and only
 * reaches the network on a genuine miss: the first time a card is actually
 * clicked open in the lightbox, never eagerly for a whole decklist just
 * because Grid view is showing (that's cardArtCache.js's job, for its own
 * separate, smaller thumbnails).
 */
export function getCardArtFullCachePath(cardName) {
  if (!cardName) return Promise.resolve(null)

  const key = normalizeCardName(cardName)
  if (!inFlight.has(key)) {
    inFlight.set(
      key,
      resolveAndCacheFull(cardName).finally(() => inFlight.delete(key))
    )
  }
  return inFlight.get(key)
}
