import { getVideoCapturePrefs } from './preferences.js'

// How long to wait after the active match's WebSocket closes before
// actually stopping the recording — covers a brief reconnect (network
// blip, tab refocus) without splitting one match into two files.
const PENDING_STOP_DELAY_MS = 10_000

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

// Maps a WebSocket's CDP requestId to the gameInstanceId whose join_game
// message was sent on it, so a later Network.webSocketClosed for that same
// requestId can be traced back to which match it belonged to. In memory
// only, and deliberately the *only* thing remembered about any socket —
// never the frames themselves.
const requestIdToGameInstanceId = new Map()

/**
 * Remembers the main window so auto-start/auto-stop signals can be pushed
 * to its renderer — mirrors capture.js's initCapture() pattern. The actual
 * MediaRecorder/getUserMedia pipeline only exists in the renderer (they're
 * Web APIs, unavailable in the main process), so this module can only ever
 * *ask* the renderer to start/stop — never call the capture pipeline
 * directly itself.
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

function clearPendingStopTimer() {
  if (pendingStopTimer) {
    clearTimeout(pendingStopTimer)
    pendingStopTimer = null
  }
}

/**
 * Called whenever a `join_game` WebSocket frame is seen for `gameInstanceId`
 * on connection `requestId`. Exported directly (not just wired through the
 * debugger listener below) so the state machine's transitions can be
 * exercised with synthetic events independently of a live Rift Atlas
 * connection.
 *
 * This module never touches the write stream or MediaRecorder itself —
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
    if (!getVideoCapturePrefs().autoStartRecording) {
      // Auto-start is off — don't record yet, but remember this session so
      // a manual Start pressed before the match ends can still pick up
      // auto-stop (see handleManualStart below). The listener itself never
      // stops running just because this preference is off.
      pendingSessionGameInstanceId = gameInstanceId
      return
    }
    state = 'RECORDING'
    activeGameInstanceId = gameInstanceId
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
    sendAutoStart()
  }
}

function finishStop() {
  state = 'IDLE'
  activeGameInstanceId = null
  sendAutoStop()
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
    // manual Start ever claimed it) — just stop tracking it. Nothing to
    // stop, so no sendAutoStop().
    if (gameInstanceId === pendingSessionGameInstanceId) {
      pendingSessionGameInstanceId = null
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

  state = 'RECORDING'
  activeGameInstanceId = pendingSessionGameInstanceId
  pendingSessionGameInstanceId = null
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
