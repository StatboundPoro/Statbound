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

/**
 * The overlay's two Battlefield stat blocks — "My Battlefield" and
 * "Opponent Battlefield" — returned as `{ mine, theirs }`, each
 * independently possibly null (a match can have one battlefield recorded
 * without the other). Always drawn from the match's LAST recorded game
 * (matches.js's `games` array is ordered by game_number ASC), never a
 * per-game breakdown across a Bo3's games — the same "final, not
 * per-game" simplicity resolveScoreLine() below applies.
 *
 * Deliberately returned as two separate values rather than one joined
 * "<mine> vs <theirs>" string: matchOverlayImage.js renders each as its
 * own full-width, separately-labeled line specifically because a joined
 * line didn't have enough width in this feature's first (wide/short)
 * panel shape and got truncated with an ellipsis on a real long
 * battlefield name — the actual bug the panel's reshape to narrow/tall
 * exists to fix. See that file's buildOverlayHtml() for the full story.
 */
function resolveBattlefields(match) {
  const lastGame = match.games[match.games.length - 1]
  if (!lastGame) return { mine: null, theirs: null }
  return { mine: lastGame.my_battlefield ?? null, theirs: lastGame.opponent_battlefield ?? null }
}

/**
 * The overlay's Score row. A Bo3 shows its final SERIES score only
 * (`match.score`, e.g. "2-1", the same derived win-count summary
 * deriveMatchSummary() computes for every other match view in this app) —
 * never a per-game breakdown, a deliberate simplicity decision. A Bo1 has
 * no series score worth a separate row (it's always "1-0" or "0-1",
 * exactly restating the WIN/LOSS label right next to it), so this instead
 * shows that single game's real in-game point score (0-8), read straight
 * from its own my_score/opponent_score — genuinely new information the
 * WIN/LOSS label alone doesn't carry.
 */
function resolveScoreLine(match) {
  if (match.format === 'Bo3') return match.score || null

  const lastGame = match.games[match.games.length - 1]
  if (!lastGame) return null
  const { my_score, opponent_score } = lastGame
  if (my_score == null && opponent_score == null) return null
  return `${my_score ?? '?'}-${opponent_score ?? '?'}`
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

// A real EPERM was captured on renameSync() here in practice: Windows had
// the destination (the just-recorded original video) transiently locked at
// the exact moment of the swap. Audited every place this app's OWN code
// could plausibly still be holding that file open around this time, and
// found nothing: replayProtocol.js's fs.createReadStream() calls (the only
// other code in this app that ever reads a recording file) are opened
// per-request only when a user actively watches a replay via
// ReplayPlayer.jsx, wrapped in a Response whose Readable.toWeb() stream
// closes/destroys the underlying file descriptor on completion, error, or
// cancellation — not something that would ever be open against a
// just-linked recording nobody has watched yet. This job's own ffmpeg read
// of the same file (see runOverlayBurn() above) is already correctly
// sequenced: finalizeOverlaidRecording() only ever runs after `await
// runOverlayBurn(...)` resolves, which only happens once ffmpeg's child
// process has genuinely exited (its 'close' event, not just 'exit') and
// released its own OS-level handle on the file. So the lock is external —
// most likely Windows Defender or another real-time antivirus scanning the
// video the moment capture.js's own finalizeVideoIntoPlace() finished
// writing it into place, a well-known "freshly-closed file is briefly
// unavailable" class of Windows lock this project has already run into
// once before (during local builds) — not a bug to fix in this app's own
// file handling, but exactly the kind of transient condition a short retry
// resolves.
const RENAME_MAX_ATTEMPTS = 5
const RENAME_RETRY_BASE_DELAY_MS = 250

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Only EPERM ("operation not permitted" — Windows' code for a file that's
// briefly locked by another handle) and EBUSY (the same idea, surfaced
// under a different code depending on exactly what's holding it) are worth
// retrying — both describe a resource that's momentarily unavailable, not
// wrong. Anything else (ENOENT, a permissions/path problem, etc.) is a real
// error retrying can never fix, so it's rethrown immediately on the first
// attempt rather than wasting up to RENAME_MAX_ATTEMPTS * backoff on
// something that will never succeed.
function isTransientLockError(err) {
  return err.code === 'EPERM' || err.code === 'EBUSY'
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
 *
 * The rename itself is retried up to RENAME_MAX_ATTEMPTS times with a short
 * linear backoff (250ms, 500ms, 750ms, 1000ms between attempts — a few
 * seconds' added latency is irrelevant for a background job nothing is
 * waiting on) whenever it fails with a transient lock error (see
 * isTransientLockError() above) — real Windows file locks like this are
 * often gone within a moment. Still throws (rather than returning false) if
 * every attempt is exhausted, or immediately on any non-transient error, so
 * the caller's try/catch remains the single place this whole job's failure
 * handling lives, and the existing "original left untouched, clear error
 * logged" fallback behavior is completely unchanged either way.
 */
async function finalizeOverlaidRecording(tempOutputPath, originalPath) {
  if (!fs.existsSync(tempOutputPath) || fs.statSync(tempOutputPath).size === 0) {
    throw new Error('Burned-in output is missing or empty.')
  }

  for (let attempt = 1; attempt <= RENAME_MAX_ATTEMPTS; attempt++) {
    try {
      fs.renameSync(tempOutputPath, originalPath)
      return
    } catch (err) {
      if (!isTransientLockError(err) || attempt === RENAME_MAX_ATTEMPTS) throw err
      console.warn(
        `[video overlay] rename locked (attempt ${attempt}/${RENAME_MAX_ATTEMPTS}, ${err.code}) — retrying...`
      )
      await sleep(RENAME_RETRY_BASE_DELAY_MS * attempt)
    }
  }
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

    const { mine: myBattlefield, theirs: opponentBattlefield } = resolveBattlefields(match)
    const overlayPng = await renderMatchOverlayPng({
      deckName,
      legendArtPath,
      opponentLegend: match.opponent_legend,
      result: match.result,
      myBattlefield,
      opponentBattlefield,
      scoreLine: resolveScoreLine(match)
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
      await finalizeOverlaidRecording(tempOutputPath, filePath)
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
