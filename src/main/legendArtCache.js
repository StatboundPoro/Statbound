import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import sharp from 'sharp'
import { app } from 'electron'
import { resolveLegendArtUrl } from './services/legendArt.js'
import { LEGEND_ART_CROP_OVERRIDES } from './data/legendArtCropOverrides.js'

// Two-stage crop applied ONCE, at cache time, on a real downloaded image via
// sharp -- never per-render. The renderer only ever displays an
// already-cropped square PNG, handed to it as a data: URL by
// getLegendArtDataUrl() below; there's no compound CSS cropping anywhere.
//
// Stage 1 (fixed template, same for every card): crop to the top ~58% of
// the source image's height, inset ~4% from the left/right edges. This
// reliably strips the rules-text box and the ornate card frame on every
// real Legend card checked, leaving just the art.
//
// Stage 2 (loose, top-anchored, horizontally-centered default): within that
// art region, take the largest square that fits, anchored to the top and
// horizontally centered (the object-position equivalent of "50% 0%"). This
// was revised from an earlier, tighter, asymmetrically-offset idea after
// reviewing 9 real Legend cards showed face position varies far more than
// one fixed offset could handle -- vertically from near the very top edge
// to ~35% down, horizontally from ~25% to ~60% from the left. A
// top-anchored, centered square is deliberately more forgiving/zoomed-out
// than a tight face crop, trading precision for reliability: every one of
// the 9 reviewed cards has its actual face inside a crop like this, even
// where not perfectly centered within it. LEGEND_ART_CROP_OVERRIDES (see
// that file) can replace this default for one specific Legend if its
// avatar is ever noticed looking bad.
const STAGE1_HEIGHT_FRACTION = 0.58
const STAGE1_INSET_FRACTION = 0.04
// Output is capped here, downscale only (sharp's withoutEnlargement below)
// -- never upscaled past whatever Stage 2's square crop actually measures,
// the same "never upscale" principle capture.js's video encode follows.
const OUTPUT_SIZE = 400

function normalizeLegendName(legendName) {
  return legendName.trim().toLowerCase()
}

function cacheDir() {
  return path.join(app.getPath('userData'), 'legendArt')
}

// Cache key is the normalized Legend name, not a deck id or card id -- every
// deck sharing a Legend reuses the exact same cached, cropped file on disk.
function cacheFilePath(legendName) {
  const hash = crypto.createHash('sha1').update(normalizeLegendName(legendName)).digest('hex')
  return path.join(cacheDir(), `${hash}.png`)
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value))
}

async function cropLegendArt(sourceBuffer, legendName) {
  const { width, height } = await sharp(sourceBuffer).metadata()
  if (!width || !height) throw new Error('Legend art source has no readable dimensions')

  const insetX = Math.round(width * STAGE1_INSET_FRACTION)
  const stage1Width = width - insetX * 2
  const stage1Height = Math.round(height * STAGE1_HEIGHT_FRACTION)
  const squareSize = Math.min(stage1Width, stage1Height)
  const maxOffsetX = stage1Width - squareSize
  const maxOffsetY = stage1Height - squareSize

  const override = LEGEND_ART_CROP_OVERRIDES[normalizeLegendName(legendName)]
  const xFraction = clamp01(override?.x ?? 0.5)
  const yFraction = clamp01(override?.y ?? 0)

  const left = insetX + Math.round(maxOffsetX * xFraction)
  const top = Math.round(maxOffsetY * yFraction)

  return sharp(sourceBuffer)
    .extract({ left, top, width: squareSize, height: squareSize })
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'cover', withoutEnlargement: true })
    .png()
    .toBuffer()
}

async function downloadCropAndCache(legendName, imageUrl) {
  const response = await fetch(imageUrl)
  if (!response.ok) throw new Error(`Legend art download failed: HTTP ${response.status}`)
  const sourceBuffer = Buffer.from(await response.arrayBuffer())

  const cropped = await cropLegendArt(sourceBuffer, legendName)

  const destPath = cacheFilePath(legendName)
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  fs.writeFileSync(destPath, cropped)
}

// Dedupes concurrent lookups for the same Legend -- e.g. a Deck Library grid
// where several decks sharing one Legend all mount at once -- so only one
// fetch/crop/cache pipeline ever runs for it no matter how many callers ask
// at the same moment; later callers just await the same in-flight promise
// rather than each kicking off their own download.
const inFlight = new Map()

async function resolveAndCache(legendName) {
  try {
    const filePath = cacheFilePath(legendName)
    if (!fs.existsSync(filePath)) {
      const imageUrl = await resolveLegendArtUrl(legendName)
      if (!imageUrl) return null
      await downloadCropAndCache(legendName, imageUrl)
    }

    const buffer = fs.readFileSync(filePath)
    return `data:image/png;base64,${buffer.toString('base64')}`
  } catch (err) {
    // Network failure, a Legend that can't be matched against Riftcodex, a
    // malformed image, a crop failure -- all fall back to null here, which
    // every caller treats as "render the existing crest instead," never a
    // visible error. Same progressive-enhancement pattern as match result
    // auto-fill and the Legend name registry's own offline fallback.
    console.error(`Legend art lookup failed for "${legendName}":`, err)
    return null
  }
}

/**
 * Returns a data: URL for a deck's Legend's cached, cropped portrait avatar,
 * or null if none is available for any reason. Reads straight off disk on a
 * cache hit -- including across app restarts, since the cache lives under
 * userData -- and only reaches the network on a genuine miss. Served as a
 * data: URL over plain IPC rather than a second scoped custom protocol (the
 * pattern replays:get-by-match uses for video, see replayProtocol.js):
 * these are small, already-cropped, cached PNGs, not something that needs
 * HTTP range-request streaming, so a data: URL is the simpler safe option
 * here -- it never exposes a raw file:// path to the renderer either way.
 */
export function getLegendArtDataUrl(legendName) {
  if (!legendName) return Promise.resolve(null)

  const key = normalizeLegendName(legendName)
  if (!inFlight.has(key)) {
    inFlight.set(
      key,
      resolveAndCache(legendName).finally(() => inFlight.delete(key))
    )
  }
  return inFlight.get(key)
}
