import { getPlayPrefs, getVideoCapturePrefs } from './preferences.js'
import { completeSession, startSession } from './matchSessions.js'

// How long to wait after the active match's WebSocket closes before
// actually stopping the recording — covers a brief reconnect (network
// blip, tab refocus) without splitting one match into two files.
const PENDING_STOP_DELAY_MS = 3_000

let mainWindow = null

// IDLE -> RECORDING -> PENDING_STOP -> IDLE. In-memory only, mirrors one
// Play tab's worth of match-detection state — there is exactly one of
// these for the app's lifetime, not one per WebContentsView.
let state = 'IDLE'
let activeGameInstanceId = null
let pendingStopTimer = null

// The most recently observed join_game's gameInstanceId while `state` is
// still IDLE because the autoStartRecording preference is off — tracked
// purely so a manual Start pressed mid-session (see handleManualStart
// below) can be associated with it and get auto-stop for free. Cleared
// once that same session's socket closes with no manual start having
// claimed it. Irrelevant whenever autoStartRecording is on, since a
// join_game seen while IDLE goes straight to RECORDING in that case and
// never leaves anything here to track.
let pendingSessionGameInstanceId = null

// Mirrors pendingStopTimer's reconnect-buffering purpose, but for a
// session that was never recording in the first place (auto-start off,
// no manual claim) — without this, a brief reconnect on an unrecorded
// session would prematurely push it onto the "Log Recent Match" queue as
// finished, then leave a second, orphaned entry once the real end
// arrives. Only ever runs while `state` is IDLE.
let pendingSessionStopTimer = null

// Maps a WebSocket's CDP requestId to the gameInstanceId whose join_game
// message was sent on it, so a later Network.webSocketClosed for that same
// requestId can be traced back to which match it belonged to. In memory
// only, and deliberately the *only* thing remembered about any socket —
// never the frames themselves.
const requestIdToGameInstanceId = new Map()

/**
 * Remembers the main window so auto-start/auto-stop signals can be pushed
 * to its renderer. capture.js's own start/stop functions live in main and
 * could in principle be called directly from here — this module goes
 * through the renderer's window.api.capture.start()/stop() instead (see
 * sendAutoStart()/sendAutoStop() below) so a WebSocket-driven auto-start
 * goes through the exact same idempotent, error-handled path a manual
 * button press does, in lib/recording.js, rather than a second entry point
 * into capture.js with its own guards to keep in sync.
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
// downstream onStopped callback), but for the case where no recording
// ever ran, so App.jsx has nothing else to key a refetch off of. Handled
// in App.jsx by the same logic that pops open the Sidebar's self-
// dismissing notification for a finished recording.
function sendPendingQueueChanged() {
  mainWindow?.webContents.send('replays:pending-queue-changed')
}

function clearPendingStopTimer() {
  if (pendingStopTimer) {
    clearTimeout(pendingStopTimer)
    pendingStopTimer = null
  }
}

function clearPendingSessionStopTimer() {
  if (pendingSessionStopTimer) {
    clearTimeout(pendingSessionStopTimer)
    pendingSessionStopTimer = null
  }
}

// The deck currently selected in the Play tab's picker, read fresh off
// preferences.js — the same file PlayScreen.jsx's dropdown persists to on
// every change. Only ever called at the exact moment a NEW session starts
// (see startSession() call sites below), so what's captured is a
// snapshot of that moment, not a live reference to whatever's selected
// now.
function currentlySelectedDeckId() {
  return getPlayPrefs().lastSelectedPlayDeckId
}

/**
 * Called whenever a `join_game` WebSocket frame is seen for `gameInstanceId`
 * on connection `requestId`. Exported directly (not just wired through the
 * debugger listener below) so the state machine's transitions can be
 * exercised with synthetic events independently of a live Rift Atlas
 * connection.
 *
 * This module never touches capture.js's recording session directly —
 * `sendAutoStart()`/`sendAutoStop()` just push a signal to the renderer,
 * which reuses its own already-idempotent, already-error-handled
 * start()/stop() (see lib/recording.js) — the same functions the Play
 * tab's manual button calls. That idempotency is also why this state
 * machine doesn't need to know whether a manual recording is already
 * running: asking the renderer to start when it's already recording is a
 * no-op there, and asking it to stop always just stops whatever's active.
 */
export function handleJoinGame({ gameInstanceId, requestId }) {
  if (!gameInstanceId) return
  requestIdToGameInstanceId.set(requestId, gameInstanceId)

  if (state === 'IDLE') {
    if (gameInstanceId === pendingSessionGameInstanceId) {
      // Reconnect resume for a still-unclaimed (auto-start off, no manual
      // Start yet) session — cancel its stop grace timer if one's running
      // and keep tracking it as the same session, not a new one.
      clearPendingSessionStopTimer()
      return
    }
    if (!getVideoCapturePrefs().autoStartRecording) {
      // Auto-start is off — don't record yet, but remember this session so
      // a manual Start pressed before the match ends can still pick up
      // auto-stop (see handleManualStart below). The listener itself never
      // stops running just because this preference is off.
      pendingSessionGameInstanceId = gameInstanceId
      startSession(gameInstanceId, currentlySelectedDeckId())
      return
    }
    state = 'RECORDING'
    activeGameInstanceId = gameInstanceId
    startSession(gameInstanceId, currentlySelectedDeckId())
    sendAutoStart()
    return
  }

  if (state === 'PENDING_STOP') {
    if (gameInstanceId === activeGameInstanceId) {
      // Reconnect resume, not a new match — cancel the pending stop and
      // keep the same recording going rather than splitting it in two.
      clearPendingStopTimer()
      state = 'RECORDING'
      return
    }
    // A different match joined while the previous one was still waiting
    // out its stop grace period. Shouldn't normally happen (one match at
    // a time) — finish the old stop immediately, then start fresh.
    console.warn('[auto capture] new match joined while a previous match was pending stop — finishing old, starting new')
    clearPendingStopTimer()
    finishStop()
    state = 'RECORDING'
    activeGameInstanceId = gameInstanceId
    startSession(gameInstanceId, currentlySelectedDeckId())
    sendAutoStart()
    return
  }

  if (state === 'RECORDING') {
    if (gameInstanceId === activeGameInstanceId) return // duplicate join_game, no-op

    // A second match joined while the first was never seen to close.
    // Shouldn't normally happen — switch over rather than silently
    // dropping the new match's detection.
    console.warn('[auto capture] new match joined while a previous match was still recording — switching')
    finishStop()
    state = 'RECORDING'
    activeGameInstanceId = gameInstanceId
    startSession(gameInstanceId, currentlySelectedDeckId())
    sendAutoStart()
  }
}

/**
 * Ends this module's tracking of whatever session `activeGameInstanceId`
 * refers to — always a session that had (or was meant to have) a
 * recording, since it only ever runs from RECORDING/PENDING_STOP
 * contexts. completeSession() only pushes a "Log Recent Match" entry for
 * a session that never actually got one (e.g. startRecording() itself
 * failed) — the common case, a session that did get recorded, resolves
 * via its own sidecar file instead (see capture.js), so no queue push
 * happens here for it.
 */
function finishStop() {
  const finishedGameInstanceId = activeGameInstanceId
  state = 'IDLE'
  activeGameInstanceId = null
  sendAutoStop()
  if (finishedGameInstanceId && completeSession(finishedGameInstanceId)) {
    sendPendingQueueChanged()
  }
}

/**
 * Called whenever a WebSocket closes. Exported directly for the same
 * testability reason as handleJoinGame above.
 */
export function handleSocketClosed({ requestId }) {
  const gameInstanceId = requestIdToGameInstanceId.get(requestId)
  if (!gameInstanceId) return // not a socket we were tracking
  requestIdToGameInstanceId.delete(requestId)

  if (state === 'IDLE') {
    // No recording is tied to this session (auto-start was off and no
    // manual Start ever claimed it) — nothing to stop, so no
    // sendAutoStop(). Still waits out the same grace period the RECORDING
    // branch below does before treating the session as actually over, so
    // a brief reconnect doesn't prematurely push it onto the "Log Recent
    // Match" queue only for the real end to arrive moments later.
    if (gameInstanceId === pendingSessionGameInstanceId) {
      pendingSessionStopTimer = setTimeout(() => {
        pendingSessionStopTimer = null
        const finishedGameInstanceId = pendingSessionGameInstanceId
        pendingSessionGameInstanceId = null
        if (finishedGameInstanceId && completeSession(finishedGameInstanceId)) {
          sendPendingQueueChanged()
        }
      }, PENDING_STOP_DELAY_MS)
    }
    return
  }

  if (state !== 'RECORDING' || gameInstanceId !== activeGameInstanceId) return

  state = 'PENDING_STOP'
  pendingStopTimer = setTimeout(() => {
    pendingStopTimer = null
    finishStop()
  }, PENDING_STOP_DELAY_MS)
}

/**
 * Called when the user presses the Play tab's manual Start button (see
 * lib/recording.js), after the recording has actually started. If a
 * join_game was seen while auto-start was off and its session is still
 * open (`pendingSessionGameInstanceId`), associate this manual recording
 * with it so the existing webSocketClosed -> PENDING_STOP -> auto-stop
 * path (including reconnect-resume) applies to it exactly as it would to
 * an auto-started recording — no sendAutoStart() here, since the renderer
 * already started the recording itself.
 *
 * If no session is currently pending (e.g. Start was pressed before any
 * join_game fired this session), this is a no-op: that recording has
 * nothing to associate with and simply requires a manual Stop, the same
 * as it would have before auto-detection existed at all.
 */
export function handleManualStart() {
  if (state !== 'IDLE' || !pendingSessionGameInstanceId) return

  clearPendingSessionStopTimer()
  state = 'RECORDING'
  activeGameInstanceId = pendingSessionGameInstanceId
  pendingSessionGameInstanceId = null
}

/**
 * The gameInstanceId a freshly-started recording should be considered
 * tied to, or null if there's no session to associate it with. Called by
 * capture.js's startRecording() to know what to write into the
 * recording's sidecar JSON (see capture.js) and to tell matchSessions.js
 * this session did get a recording, before that fact is checked later at
 * completeSession() time.
 *
 * Covers both ways a new recording can start: `activeGameInstanceId` is
 * already set the moment this runs for an auto-started recording (handleJoinGame
 * sets it before sendAutoStart() posts the IPC message that eventually
 * triggers capture:start), and `pendingSessionGameInstanceId` is already
 * set for a manual Start claiming a session auto-start left unclaimed
 * (handleManualStart's own association happens slightly later, in
 * response to a second IPC message, so this can't wait for that — it has
 * to recognize the same session pendingSessionGameInstanceId already
 * points at). Returns null for a manual Start with no session known at
 * all yet.
 */
export function getGameInstanceIdForNewRecording() {
  return activeGameInstanceId ?? pendingSessionGameInstanceId ?? null
}

/**
 * Attaches Chrome DevTools Protocol debugging to the Play tab's
 * WebContentsView the moment it's created (see playView.js), listening
 * only for WebSocket frame/close events on Rift Atlas's own connections —
 * never intercepting or modifying any request, never reading page content.
 *
 * Scoped as narrowly as the detection logic needs it to be: a sent frame
 * is parsed as JSON purely to check `.type === 'join_game'`, and if it
 * matches, only `gameInstanceId` is ever read out of it — the rest of the
 * payload (which, in adjacent frames, carries an auth token) is never
 * stored, logged, or inspected. Everything here is wrapped in try/catch —
 * if Rift Atlas ever changes their message shape, this must fail silently
 * into "no auto-detection," never crash the app or break the Play tab's
 * normal browsing.
 *
 * This reads Rift Atlas's WebSocket traffic without their confirmed
 * permission — a request is pending a reply as of when this was built. See
 * CLAUDE.md's decision log for the full reasoning; this is deliberately
 * scoped to connection lifecycle + this one message field for exactly that
 * reason, not because more data wouldn't be useful.
 */
export function attachAutoCapture(webContents) {
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
    try {
      if (method === 'Network.webSocketFrameSent') {
        const payload = params?.response?.payloadData
        if (!payload) return
        const message = JSON.parse(payload)
        if (message?.type === 'join_game' && message?.gameInstanceId) {
          handleJoinGame({ gameInstanceId: message.gameInstanceId, requestId: params.requestId })
        }
      } else if (method === 'Network.webSocketClosed') {
        handleSocketClosed({ requestId: params.requestId })
      }
    } catch {
      // A frame that isn't JSON, or doesn't have the shape expected —
      // deliberately not logged with any payload content. Auto-detection
      // just doesn't fire for this event; nothing else is affected.
    }
  })
}
