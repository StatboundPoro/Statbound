import { LOBBY_LOGO_SELECTOR, isSessionActive } from '../autoCapture.js'
import { isRecordingActive } from '../capture.js'

// Multi-signal Play tab health detection, layered ALONGSIDE the
// pre-existing lobby-logo-only detection in autoCapture.js (which stays
// exactly as-is for its own purpose: driving auto-stop/match-completion).
// This module answers a different question: is the Play tab's embedded
// page actually rendering something recognizable at all, or has it gone
// stuck/blank (a failed navigation, a client-side crash, a network blip)?
//
// Real DOM samples confirmed all three known Rift Atlas states classify
// unambiguously:
//   - In-game: the Legend zone, a battlefield board slot, or a score track
//     is present — any one of the three, confirmed exclusively true
//     in-game and never in lobby or login.
//   - Login: the lobby logo is present AND either a password field exists
//     or the URL is the sign-in page.
//   - Lobby: the lobby logo is present AND no password field exists.
// Anything matching none of these is 'unknown' — confirmed via real data
// that lobby and login share the same logo image, so telling them apart
// MUST check the password field/URL, never the logo alone.
//
// Runs its own continuous poll, independent of autoCapture.js's lobby-poll
// (which only starts/stops around a tracked session) — this one has to keep
// running even while nothing is happening, since a Play tab stuck on a
// blank page with no active session is exactly the primary case it exists
// to recover from automatically. Started once, for the Play tab's whole
// lifetime, from playView.js's ensurePlayView() alongside attachAutoCapture.

const POLL_INTERVAL_MS = 1_000
// A brief loading transition between pages routinely reads as "Unknown" for
// a moment (nothing has rendered yet) — this has to be comfortably longer
// than that so a normal transition never trips it. Confirmed against real
// page-transition timing; revisit if testing shows it's too twitchy (false
// positives during normal loads) or too slow (a genuinely stuck tab left
// unrecovered too long).
const UNKNOWN_THRESHOLD_MS = 15_000

const HEALTH_CHECK_SCRIPT = `
(() => {
  try {
    const legendZonePresent = !!document.querySelector('[data-drop-zone="legend"]');
    const battlefieldZonePresent = !!document.querySelector('[data-battlefield-surface-slot]');
    const scoreTrackPresent = !!document.querySelector('[role="group"][aria-label*="score track"]');
    const lobbyLogoPresent = !!document.querySelector('${LOBBY_LOGO_SELECTOR}');
    const passwordFieldCount = document.querySelectorAll('input[type="password"]').length;
    const isSignInUrl = location.href.indexOf('/sign-in') !== -1;
    return { legendZonePresent, battlefieldZonePresent, scoreTrackPresent, lobbyLogoPresent, passwordFieldCount, isSignInUrl };
  } catch (err) {
    return null;
  }
})()
`

/**
 * Classifies one poll's raw signals into one of the three confirmed known
 * states, or 'unknown' if none match. In-game is checked first since its
 * signals are confirmed exclusive to it; login vs. lobby (which share the
 * same logo) are told apart by password field presence / URL, never by the
 * logo alone — see the classification table above.
 */
function classify(signals) {
  if (!signals) return 'unknown'
  const { legendZonePresent, battlefieldZonePresent, scoreTrackPresent, lobbyLogoPresent, passwordFieldCount, isSignInUrl } =
    signals
  if (legendZonePresent || battlefieldZonePresent || scoreTrackPresent) return 'in-game'
  if (lobbyLogoPresent) return passwordFieldCount > 0 || isSignInUrl ? 'login' : 'lobby'
  return 'unknown'
}

let pollTimer = null
let unknownSince = null
// True once the CURRENT "Unknown" streak has already triggered a recovery
// action (an auto-reload, or the prompt being shown) — prevents
// re-triggering on every subsequent tick while the state stays stuck.
// Cleared the moment the streak ends (state classifies as anything else) or
// a fresh reload is issued, either of which starts counting a new streak.
let actedOnCurrentStreak = false

let mainWindow = null
let reloadFn = null

function sendPromptShow() {
  mainWindow?.webContents.send('play-tab-health:show-prompt')
}

function sendPromptHide() {
  mainWindow?.webContents.send('play-tab-health:hide-prompt')
}

function reload() {
  reloadFn?.()
  // Restart the streak's clock rather than declaring it resolved outright —
  // the reload itself takes a moment, and the page will legitimately read
  // "Unknown" again for a beat while it loads. Only a real transition to a
  // known state (see poll() below) actually clears the streak; if the
  // reload doesn't fix it, another full threshold of continued "Unknown"
  // will trigger a retry rather than looping every tick.
  unknownSince = Date.now()
  actedOnCurrentStreak = false
  sendPromptHide()
}

/** Renderer-triggered: the health prompt's Reload action. */
export function confirmHealthReload() {
  reload()
}

/** Renderer-triggered: the health prompt's dismiss/ignore action — clears
 * the prompt without reloading, in case it's a false positive and the
 * embed recovers on its own. Does not reset unknownSince, so the same
 * streak isn't immediately eligible to prompt again on the very next tick;
 * it only prompts again once this streak actually ends and a new one
 * crosses the threshold. */
export function dismissHealthPrompt() {
  actedOnCurrentStreak = true
  sendPromptHide()
}

async function poll(webContents) {
  if (!webContents || webContents.isDestroyed()) return

  let signals
  try {
    signals = await webContents.executeJavaScript(HEALTH_CHECK_SCRIPT)
  } catch (err) {
    // Mid-navigation JS-context teardown, most likely — treated the same as
    // a genuine 'unknown' read (a page that can't even run this script is
    // itself evidence something's wrong) rather than skipping the tick.
    signals = null
  }

  const state = classify(signals)

  if (state !== 'unknown') {
    if (unknownSince !== null) sendPromptHide()
    unknownSince = null
    actedOnCurrentStreak = false
    return
  }

  if (unknownSince === null) {
    unknownSince = Date.now()
    return
  }

  if (actedOnCurrentStreak) return
  if (Date.now() - unknownSince < UNKNOWN_THRESHOLD_MS) return

  actedOnCurrentStreak = true

  // A recording in progress or a session still being tracked would be cut
  // short by an unattended reload — ask first. Otherwise there's nothing to
  // lose, so recover on the spot with no user interaction needed.
  if (isRecordingActive() || isSessionActive()) {
    sendPromptShow()
  } else {
    reload()
  }
}

/**
 * Starts continuous health polling for the Play tab's WebContents. Called
 * once, at view creation (see playView.js's ensurePlayView), and runs for
 * the rest of the app's lifetime — never stopped, mirroring the Play
 * embed's own "stays permanently attached" design, so a session recording
 * in the background (while the user is on another screen) still gets
 * watched.
 *
 * `reloadPlayView` is the exact same action the Return to Lobby button
 * performs (playView.js's playReturnToLobby) — passed in rather than
 * imported directly, to avoid a circular import between this module and
 * playView.js (which is what calls this function).
 */
export function startPlayTabHealthMonitoring({ webContents, win, reloadPlayView }) {
  mainWindow = win
  reloadFn = reloadPlayView
  unknownSince = null
  actedOnCurrentStreak = false
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = setInterval(() => poll(webContents), POLL_INTERVAL_MS)
}
