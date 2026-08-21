import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { getMatchById } from './matches.js'
import { getDeckById } from './decks.js'
import { getLegendArtCachePath } from './legendArtCache.js'
import { getVideoCapturePrefs } from './preferences.js'
import { resolveFfmpegPath, qualityToBitrate } from './capture.js'
import { renderMatchOverlayPng } from './services/matchOverlayImage.js'

// A match is only worth burning a badge into if there's actual result
// content to show — a manually logged match with a game result but nothing
// else filled in still has *something* (a win/loss), so this only skips the
// genuinely empty case: no opponent legend AND no derived win/loss (the one
// way that can happen despite matches.js requiring at least one decided
// game — see deriveMatchSummary() — is a tied-so-far Bo3, e.g. 1-1 with its
// third game not yet played).
function hasUsableResultData(match) {
  return Boolean(match.opponent_legend) || Boolean(match.result)
}

function removeIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.rmSync(filePath)
  } catch (err) {
    console.error('[video overlay] failed to remove file', filePath, err)
  }
}

/**
 * Spawns the bundled ffmpeg binary to composite the overlay PNG onto the
 * source recording's bottom-right corner, re-encoding into `outputPath` (a
 * new file — never the source). `main_w-overlay_w-32`/`main_h-overlay_h-32`
 * are ffmpeg's own overlay-filter expressions, resolved against the real
 * source resolution at filter-graph time, so this never needs to know the
 * video's actual dimensions itself. `-an` is explicit, not load-bearing —
 * these recordings never have an audio stream to begin with (see
 * capture.js's own "video only" note) — but makes that assumption visible
 * here rather than silently relying on there being nothing to drop.
 */
function runOverlayBurn(inputPath, overlayPngPath, outputPath, bitrate) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(resolveFfmpegPath(), [
      '-y',
      '-i', inputPath,
      '-i', overlayPngPath,
      '-filter_complex', 'overlay=main_w-overlay_w-32:main_h-overlay_h-32',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-b:v', bitrate,
      '-pix_fmt', 'yuv420p',
      '-an',
      outputPath
    ])

    let stderr = ''
    ffmpeg.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    ffmpeg.on('error', reject)
    ffmpeg.on('close', (code) => {
      if (code !== 0) console.error('[video overlay] ffmpeg exited with code', code, stderr)
      resolve(code)
    })
  })
}

/**
 * Verifies the freshly burned-in file is real and non-empty, then replaces
 * the original recording with it via a rename — the same verify-then-swap
 * idiom already established by capture.js's finalizeVideoIntoPlace() (move
 * a confirmed-good temp file into its resting place) and settings.js's
 * writeCleanBackup()/importBackup() (never trust a write in progress; check
 * before it's allowed to matter). Unlike importBackup(), there's no separate
 * safety-snapshot step needed here — the original file is never opened,
 * moved, or modified until this exact rename, so any failure before this
 * point already leaves it completely untouched with nothing to roll back.
 * Throws (rather than returning false) on an invalid output, so the caller's
 * try/catch is the single place this whole job's failure handling lives.
 */
function finalizeOverlaidRecording(tempOutputPath, originalPath) {
  if (!fs.existsSync(tempOutputPath) || fs.statSync(tempOutputPath).size === 0) {
    throw new Error('Burned-in output is missing or empty.')
  }
  fs.renameSync(tempOutputPath, originalPath)
}

/**
 * The opt-in "burn match info into recordings" background job — see
 * CLAUDE.md's Replay Recording entry for the full feature and the timing
 * decision this implements. Deliberately runs at match-LOG time (called
 * from ipc.js's `replays:create` handler, right after a recording is linked
 * to a newly saved match), never at recording-finish time: a match's final
 * score and winner don't exist as real data until the match is actually
 * saved — auto-filled or hand-corrected, this reads whichever ended up in
 * the database, never the original auto-fill payload — so there's nothing
 * genuine to burn in any earlier than this.
 *
 * Fire-and-forget from the caller's perspective: the match save and the
 * replay link have already both completed and returned before this even
 * starts, and everything below is wrapped in one outer try/catch so a
 * failure here — a network hiccup resolving Legend art, a malformed
 * overlay, an ffmpeg error — can never surface as a user-facing error. The
 * match already saved successfully regardless of whether this purely
 * cosmetic re-encode succeeds; on any failure the ORIGINAL recording is
 * left completely untouched (see finalizeOverlaidRecording above), and only
 * this job's own scratch files are cleaned up.
 */
export async function burnMatchOverlayIfEnabled({ matchId, filePath }) {
  try {
    const { burnMatchOverlay, quality } = getVideoCapturePrefs()
    if (!burnMatchOverlay) return

    const match = getMatchById(matchId)
    if (!match || !hasUsableResultData(match)) return

    const deck = getDeckById(match.deck_id)
    const deckName = deck?.name ?? 'Unknown Deck'
    const legendArtPath = deck?.legend_name ? await getLegendArtCachePath(deck.legend_name) : null

    const overlayPng = await renderMatchOverlayPng({
      deckName,
      legendArtPath,
      opponentLegend: match.opponent_legend,
      result: match.result,
      score: match.score,
      format: match.format
    })

    const tempDir = path.join(path.dirname(filePath), '.statbound-tmp')
    fs.mkdirSync(tempDir, { recursive: true })
    const jobId = randomUUID()
    const overlayPngPath = path.join(tempDir, `overlay-${jobId}.png`)
    const tempOutputPath = path.join(tempDir, `overlay-${jobId}.mp4`)
    fs.writeFileSync(overlayPngPath, overlayPng)

    try {
      const exitCode = await runOverlayBurn(filePath, overlayPngPath, tempOutputPath, qualityToBitrate(quality))
      if (exitCode !== 0) throw new Error(`ffmpeg overlay burn exited with code ${exitCode}`)
      finalizeOverlaidRecording(tempOutputPath, filePath)
    } finally {
      // Runs on both success and failure — on success tempOutputPath is
      // already gone (renamed away by finalizeOverlaidRecording), so this
      // is a harmless no-op for it; on failure it deletes the broken
      // attempt, never the original recording at `filePath`.
      removeIfExists(overlayPngPath)
      removeIfExists(tempOutputPath)
    }
  } catch (err) {
    console.error('[video overlay] burn-in failed, original recording left untouched:', err)
  }
}
