import { getPlayPrefs, getVideoCapturePrefs } from './preferences.js'
import { completeSession, startSession } from './matchSessions.js'

// How often the Play tab's own DOM is polled for the lobby logo, and how
// many consecutive positive polls are required before treating "back in
// the lobby" as confirmed rather than a brief transitional flicker (e.g. a
// loading screen that happens to render something matching for one frame).
// See LOBBY_LOGO_SELECTOR/LOBBY_CHECK_SCRIPT below for the check itself.
const LOBBY_POLL_INTERVAL_MS = 1_000
const LOBBY_CONFIRM_THRESHOLD = 2

// A partial match on Rift Atlas's lobby logo image's distinctive filename —
// confirmed via real inspection of the lobby page, not a generic utility
// class (those are shared across many elements and unique to nothing).
// Deliberately excludes the `?v=` cache-busting query string, which can
// change on a routine deploy independent of any real UI change and would
// silently break an exact-match selector.
const LOBBY_LOGO_SELECTOR = 'img[src*="rift-atlas-mark-hollow-gold"]'

// Checks both presence AND actual rendered visibility (not just DOM
// membership) — during an active match this element may either be removed
// from the DOM entirely or merely hidden via CSS depending on how Rift
// Atlas's lobby component is implemented, and this passes either way.
// getClientRects().length is used rather than offsetParent (which is
// spec'd to be null for position:fixed elements regardless of whether
// they're visible — a false negative this logo's own layout could easily
// hit) to determine "actually rendered on screen."
const LOBBY_CHECK_SCRIPT = `
(() => {
  const el = document.querySelector('${LOBBY_LOGO_SELECTOR}');
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return el.getClientRects().length > 0;
})()
`

let mainWindow = null

// IDLE -> TRACKING -> RECORDING -> IDLE, or IDLE -> RECORDING -> IDLE
// directly when auto-start is on or the user presses manual Start with no
// join_game ever seen for the session (see handleManualStart). In-memory
// only, mirrors one Play tab's worth of match-detection state — there is
// exactly one of these for the app's lifetime, not one per WebContentsView.
//
//  - IDLE: no session tracked, nothing polling.
//  - TRACKING: a join_game was seen but autoStartRecording is off, so
//    nothing is recording yet — still polling for the lobby logo so an
//    unclaimed session can be marked finished (and land on the "Log Recent
//    Match" queue) even if the user never presses manual Start.
//  - RECORDING: actively recording, polling for the lobby logo to know
//    when to stop — every recording ends up here regardless of how it
//    started (auto-detected, claimed from TRACKING, or started fully
//    manually with nothing tracked at all), so every recording gets the
//    same lobby-detection auto-stop with no separate "manual" stop path.
//
// A further join_game seen while already TRACKING or RECORDING is always a
// no-op (see handleJoinGame) — this is what lets one Bo3's several games
// share one continuous recording with no need to know or care that that's
// what's happening: this module no longer tracks seriesId, gameNumber, or
// correlates multiple gameInstanceIds at all. The lobby logo reappearing is
// the *only* signal that ends a session, for both Bo1 and Bo3 alike.
let state = 'IDLE'
let activeGameInstanceId = null

// The most recently observed join_game's gameInstanceId while `state` is
// still TRACKING (autoStartRecording is off) — tracked purely so a manual
// Start pressed mid-session (see handleManualStart below) can be associated
// with it and get auto-stop for free. Cleared once that same session ends
// (lobby confirmed) with no manual start having claimed it.
let pendingSessionGameInstanceId = null

let lobbyPollTimer = null
let lobbyConfirmCount = 0
// The Play tab's own WebContents, remembered here (not re-fetched from
// playView.js on every poll) so this module has a stable reference to run
// executeJavaScript() against for as long as the view lives — see
// attachAutoCapture below, which is only ever called once for the view's
// whole lifetime.
let attachedWebContents = null

/**
 * Remembers the main window so auto-start/auto-stop signals can be pushed
 * to its renderer. capture.js's own start/stop functions live in main and
 * could in principle be called directly from here — this module goes
 * through the renderer's window.api.capture.start()/stop() instead (see
 * sendAutoStart()/sendAutoStop() below) so a DOM-driven auto-stop goes
 * through the exact same idempotent, error-handled path a manual button
 * press does, in lib/recording.js, rather than a second entry point into
 * capture.js with its own guards to keep in sync.
 */
export function initAutoCapture(win) {
  mainWindow = win
}

function sendAutoStart() {
  mainWindow?.webContents.send('capture:auto-start')
}

function sendAutoStop() {
  mainWindow?.webContents.send('capture:auto-stop')
}

// Pushed whenever a session with no recording finishes and lands on the
// "Log Recent Match" queue — the equivalent of the recording-stopped
// signal capture already gives the renderer (via capture:auto-stop's
// downstream onStopped callback), but for the case where no recording ever
// ran, so App.jsx has nothing else to key a refetch (and its own auto-open
// of LogMatchModal — see App.jsx) off of. Because the DOM-based lobby
// trigger is now the *only* way a TRACKING session ever ends, this event is
// — like capture:auto-stop — exclusively an automatic-completion signal,
// never something a manual action produces.
function sendPendingQueueChanged() {
  mainWindow?.webContents.send('replays:pending-queue-changed')
}

// The deck currently selected in the Play tab's picker, read fresh off
// preferences.js — the same file PlayScreen.jsx's dropdown persists to on
// every change. Only ever called at the exact moment a NEW session starts
// (see startSession() call sites below), so what's captured is a snapshot
// of that moment, not a live reference to whatever's selected now.
function currentlySelectedDeckId() {
  return getPlayPrefs().lastSelectedPlayDeckId
}

function startLobbyPolling() {
  if (lobbyPollTimer) return
  lobbyConfirmCount = 0
  lobbyPollTimer = setInterval(pollLobbyState, LOBBY_POLL_INTERVAL_MS)
}

function stopLobbyPolling() {
  if (lobbyPollTimer) {
    clearInterval(lobbyPollTimer)
    lobbyPollTimer = null
  }
  lobbyConfirmCount = 0
}

/**
 * One poll tick: asks the Play tab's own DOM whether the lobby logo is
 * genuinely visible right now. A single positive read isn't enough to act
 * on — only two consecutive positive polls (~1s apart, see
 * LOBBY_CONFIRM_THRESHOLD) confirm the player is really back in the lobby
 * rather than passing through some transitional screen that happened to
 * match for a moment. Any negative read resets the streak immediately.
 */
async function pollLobbyState() {
  if (!attachedWebContents || attachedWebContents.isDestroyed()) return

  let inLobby = false
  try {
    inLobby = await attachedWebContents.executeJavaScript(LOBBY_CHECK_SCRIPT)
  } catch (err) {
    // A mid-navigation JS-context teardown, or Rift Atlas changing its
    // markup in a way that makes the selector throw — never fatal, just
    // skip this tick and try again on the next one.
    console.error('[auto capture] lobby DOM check failed:', err.message)
    return
  }

  if (!inLobby) {
    lobbyConfirmCount = 0
    return
  }

  lobbyConfirmCount += 1
  if (lobbyConfirmCount >= LOBBY_CONFIRM_THRESHOLD) {
    handleLobbyConfirmed()
  }
}

/**
 * The lobby logo has been confirmed present for two consecutive polls —
 * this is the sole stop trigger, for both TRACKING (never recording) and
 * RECORDING sessions alike, and for both Bo1 and Bo3 with no
 * format-specific branching: a Bo3 simply never reaches this until the
 * whole series is over, since every game in between only re-triggers
 * handleJoinGame's no-op branch.
 */
function handleLobbyConfirmed() {
  stopLobbyPolling()

  const wasRecording = state === 'RECORDING'
  const finishedGameInstanceId = wasRecording ? activeGameInstanceId : pendingSessionGameInstanceId

  state = 'IDLE'
  activeGameInstanceId = null
  pendingSessionGameInstanceId = null

  if (wasRecording) sendAutoStop()

  // completeSession() only pushes a "Log Recent Match" entry for a session
  // that never actually got a recording (the common TRACKING case, or the
  // rare case startRecording() itself failed) — a session that did get
  // recorded resolves via its own sidecar file instead (see capture.js),
  // so no queue push happens here for it.
  if (finishedGameInstanceId && completeSession(finishedGameInstanceId)) {
    sendPendingQueueChanged()
  }
}

/**
 * Called whenever a `join_game` WebSocket frame is seen for
 * `gameInstanceId`. Exported directly (not just wired through the debugger
 * listener below) so the state machine's transitions can be exercised with
 * synthetic events independently of a live Rift Atlas connection.
 *
 * This module never touches capture.js's recording session directly —
 * `sendAutoStart()` just pushes a signal to the renderer, which reuses its
 * own already-idempotent, already-error-handled start() (see
 * lib/recording.js) — the same function the Play tab's manual button
 * calls.
 */
export function handleJoinGame({ gameInstanceId }) {
  if (!gameInstanceId) return

  if (state !== 'IDLE') {
    // Already tracking or recording a session. A further join_game here is
    // never treated as a new session to correlate — it's either a
    // reconnect of the same game, or (for a Bo3) the start of the next game
    // in the same series, and either way this module doesn't need to tell
    // those apart: the lobby-detection stop trigger, not gameInstanceId
    // bookkeeping, is what decides when the whole session is actually over.
    // Still reset the lobby confirmation streak, since seeing a fresh
    // join_game is itself proof the player isn't sitting in the lobby.
    lobbyConfirmCount = 0
    return
  }

  if (gameInstanceId === pendingSessionGameInstanceId) {
    // Rejoin of a still-unclaimed (autoStartRecording off, no manual Start
    // yet) session that TRACKING already covers — nothing new to do.
    lobbyConfirmCount = 0
    return
  }

  if (!getVideoCapturePrefs().autoStartRecording) {
    // Auto-start is off — don't record yet, but track this session (and
    // start polling for its end) so a manual Start pressed before the
    // match ends can still pick up auto-stop (see handleManualStart below).
    pendingSessionGameInstanceId = gameInstanceId
    startSession(gameInstanceId, currentlySelectedDeckId())
    state = 'TRACKING'
    startLobbyPolling()
    return
  }

  state = 'RECORDING'
  activeGameInstanceId = gameInstanceId
  startSession(gameInstanceId, currentlySelectedDeckId())
  sendAutoStart()
  startLobbyPolling()
}

/**
 * Called when the user presses the Play tab's manual Start button (see
 * lib/recording.js), after the recording has actually started. Two cases:
 *
 *  - A join_game was seen while auto-start was off and its session is
 *    still open (TRACKING) — associate this manual recording with it so
 *    the existing lobby-detection stop path applies to it exactly as it
 *    would to an auto-started recording. Lobby polling is already running
 *    from when TRACKING began, so there's nothing to (re)start.
 *  - No session is currently pending at all (e.g. Start was pressed before
 *    any join_game fired, or entirely outside of anything auto-detection
 *    ever saw) — this is still a real recording that should stop itself
 *    the same way any other one does, so this starts lobby polling for it
 *    directly, with no gameInstanceId to associate it with in
 *    matchSessions.js (capture.js's sidecar just ends up with a null
 *    gameInstanceId/deckId fallback the same as it always has for an
 *    untracked manual recording — see getGameInstanceIdForNewRecording()).
 *
 * Neither branch calls sendAutoStart() — the renderer already started the
 * recording itself by the time this runs.
 */
export function handleManualStart() {
  if (state === 'TRACKING' && pendingSessionGameInstanceId) {
    state = 'RECORDING'
    activeGameInstanceId = pendingSessionGameInstanceId
    pendingSessionGameInstanceId = null
    return
  }

  if (state === 'IDLE') {
    state = 'RECORDING'
    activeGameInstanceId = null
    startLobbyPolling()
  }
}

/**
 * The gameInstanceId a freshly-started recording should be considered tied
 * to, or null if there's no session to associate it with. Called by
 * capture.js's startRecording() to know what to write into the recording's
 * sidecar JSON (see capture.js) and to tell matchSessions.js this session
 * did get a recording, before that fact is checked later at
 * completeSession() time.
 *
 * Covers both ways a new recording can start: `activeGameInstanceId` is
 * already set the moment this runs for an auto-started recording
 * (handleJoinGame sets it before sendAutoStart() posts the IPC message that
 * eventually triggers capture:start), and `pendingSessionGameInstanceId` is
 * already set for a manual Start claiming a session auto-start left
 * unclaimed (handleManualStart's own association happens slightly later, in
 * response to a second IPC message, so this can't wait for that — it has to
 * recognize the same session pendingSessionGameInstanceId already points
 * at). Returns null for a manual Start with no session known at all yet.
 */
export function getGameInstanceIdForNewRecording() {
  return activeGameInstanceId ?? pendingSessionGameInstanceId ?? null
}

/**
 * Attaches Chrome DevTools Protocol debugging to the Play tab's
 * WebContentsView the moment it's created (see playView.js), listening
 * only for WebSocket frame events on Rift Atlas's own connections — never
 * intercepting or modifying any request, never reading page content beyond
 * the narrow lobby-logo DOM check the polling above runs.
 *
 * Scoped as narrowly as the START detection logic needs it to be: a sent
 * frame is parsed as JSON purely to check `.type === 'join_game'`, and if
 * it matches, only `gameInstanceId` is ever read out of it — the rest of
 * the payload (which, in adjacent frames, carries an auth token) is never
 * stored, logged, or inspected. Everything here is wrapped in try/catch —
 * if Rift Atlas ever changes their message shape, this must fail silently
 * into "no auto-start detection," never crash the app or break the Play
 * tab's normal browsing.
 *
 * STOP detection no longer reads WebSocket traffic at all — see
 * pollLobbyState()/LOBBY_CHECK_SCRIPT above, which reads only the Play
 * tab's own rendered DOM (never opponent data, never network traffic) to
 * decide when a match has truly ended.
 *
 * The join_game START signal this still reads is done without Rift
 * Atlas's confirmed permission — a request is pending a reply as of when
 * this was built. See CLAUDE.md's decision log for the full reasoning.
 */
export function attachAutoCapture(webContents) {
  attachedWebContents = webContents

  try {
    webContents.debugger.attach('1.3')
  } catch (err) {
    console.error('[auto capture] failed to attach debugger (auto-detection disabled):', err.message)
    return
  }

  webContents.debugger.sendCommand('Network.enable').catch((err) => {
    console.error('[auto capture] failed to enable Network domain (auto-detection disabled):', err.message)
  })

  webContents.debugger.on('message', (_event, method, params) => {
    if (method !== 'Network.webSocketFrameSent') return
    try {
      const payload = params?.response?.payloadData
      if (!payload) return
      const message = JSON.parse(payload)
      if (message?.type === 'join_game' && message?.gameInstanceId) {
        handleJoinGame({ gameInstanceId: message.gameInstanceId })
      }
    } catch {
      // A frame that isn't JSON, or doesn't have the shape expected —
      // deliberately not logged with any payload content. Auto-start
      // detection just doesn't fire for this event; nothing else is
      // affected.
    }
  })
}
