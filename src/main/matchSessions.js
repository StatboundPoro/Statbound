import { randomUUID } from 'crypto'

// In-memory tracking of Rift Atlas match sessions detected via
// autoCapture.js's WebSocket listener — kept independent of whether any
// recording ever ends up associated with a given session, so a session
// with Auto-record off (or one a manual Start never claimed) is just as
// trackable as one that gets a real video. Nothing here is persisted:
// both maps below are rebuilt from nothing on every app launch, the same
// "lost on restart if unlogged" behavior the rest of this feature's
// ephemeral notifications already have.
//
// Two things live here:
//  - `sessions`: which deck was selected in the Play tab when a session
//    began (a one-time snapshot at session start, not a live reference —
//    see startSession() below) plus whether a recording ever got tied to
//    it, keyed by the session's own gameInstanceId.
//  - `unrecordedSessions`: the queue of sessions that finished with no
//    recording ever associated — the non-recorded half of the unified
//    "Log Recent Match" queue built in replays.js's listPendingReplays().
//    Recorded sessions never appear here; their pending-queue entry comes
//    from the recording's own sidecar JSON file instead (see capture.js).

const sessions = new Map() // gameInstanceId -> { deckId, startedAt, hasRecording }
const unrecordedSessions = [] // { gameInstanceId, deckId, startedAt, endedAt }

/**
 * Called by autoCapture.js the moment a genuinely NEW match session is
 * detected (a join_game for a gameInstanceId that isn't a reconnect of one
 * already being tracked) — never for a reconnect/resume of an existing
 * session. `deckId` should be whatever's currently selected in the Play
 * tab's picker at this exact moment (read via preferences.js's
 * getPlayPrefs(), the same file the picker's own selection is persisted
 * to) — a snapshot taken once, here, at session start. Changing the
 * picker later must not retroactively change which deck an in-progress
 * session is tagged with, so nothing here ever re-reads the preference
 * after this call.
 */
export function startSession(gameInstanceId, deckId) {
  sessions.set(gameInstanceId, {
    deckId: deckId ?? null,
    startedAt: new Date().toISOString(),
    hasRecording: false
  })
}

/**
 * Called by capture.js once a recording actually starts and is determined
 * to belong to this session (see autoCapture.js's
 * getGameInstanceIdForNewRecording()) — marks it so completeSession()
 * below knows not to treat it as an unrecorded session once it ends.
 */
export function markSessionRecording(gameInstanceId) {
  const info = sessions.get(gameInstanceId)
  if (info) info.hasRecording = true
}

/** The deck snapshotted at this session's start, or null if none was selected. */
export function getSessionDeckId(gameInstanceId) {
  return sessions.get(gameInstanceId)?.deckId ?? null
}

/** This session's own start time (session detection, not recording start). */
export function getSessionStartedAt(gameInstanceId) {
  return sessions.get(gameInstanceId)?.startedAt ?? null
}

/**
 * Called by autoCapture.js once a session is confirmed over (its grace
 * period — the same reconnect-buffering window recorded sessions already
 * get — has elapsed with no rejoin). Stops tracking it; if it never got a
 * recording, pushes it onto the unrecorded-sessions queue and returns the
 * pushed entry (so the caller knows to notify the renderer a new "Log
 * Recent Match" item exists). Returns null for an unknown id or a session
 * that did get a recording (its pending-queue entry comes from the
 * recording's sidecar instead, so it must not also appear here).
 *
 * `matchResult` is the match-result auto-fill object matchResultCapture.js
 * finalized for this session (see its own module comment), or null — kept
 * on the pushed entry so replays.js's listPendingReplays() can surface it
 * straight through to LogMatchModal's pre-fill. Harmless to pass for a
 * session that did get a recording too (info.hasRecording true): that
 * branch returns before this parameter is ever read, since a recorded
 * session's result instead goes through
 * matchResultCapture.stashResultForRecording() to reach capture.js's
 * stopRecording().
 */
export function completeSession(gameInstanceId, matchResult = null) {
  const info = sessions.get(gameInstanceId)
  if (!info) return null
  sessions.delete(gameInstanceId)
  if (info.hasRecording) return null

  const entry = {
    gameInstanceId,
    deckId: info.deckId,
    startedAt: info.startedAt,
    endedAt: new Date().toISOString(),
    matchResult: matchResult ?? null
  }
  unrecordedSessions.push(entry)
  return entry
}

/**
 * Adds a "Log Recent Match" queue entry recovered from a crashed
 * recording's sidecar JSON (see capture.js's recoverOrphanedRecordings()),
 * reusing this same unrecorded-sessions queue rather than a separate
 * mechanism — the end result is identical to any other no-recording
 * session: a match known to have happened with no video to show for it.
 * Marked `recovered: true` so listPendingReplays() can carry that through
 * to the UI (a "Recovered after a crash" badge, and `endedAt` treated as
 * an estimate rather than a real completion signal, since there was none
 * — the app never reached its normal lobby-detection trigger). The
 * sidecar's own `gameInstanceId` may be null (see capture.js's
 * writeSidecar() for why), but this queue's id/discard mechanism needs a
 * real unique key regardless of whether a live session ever existed for
 * it, so a synthetic one is generated whenever the sidecar didn't have
 * one.
 */
export function addRecoveredSession({ gameInstanceId, deckId, startedAt, endedAt }) {
  const entry = {
    gameInstanceId: gameInstanceId ?? `recovered-${randomUUID()}`,
    deckId: deckId ?? null,
    startedAt,
    endedAt,
    matchResult: null,
    recovered: true
  }
  unrecordedSessions.push(entry)
  return entry
}

/** A snapshot array (not the live one) — backs replays.js's listPendingReplays(). */
export function listUnrecordedSessions() {
  return [...unrecordedSessions]
}

/**
 * Removes one entry from the unrecorded-sessions queue — used both for a
 * real Discard (the queue item just disappears, no file to delete) and
 * for the same item once it's been logged into a real match (App.jsx
 * calls this right after a successful save, so a logged session doesn't
 * linger in the queue looking unlogged).
 */
export function removeUnrecordedSession(gameInstanceId) {
  const index = unrecordedSessions.findIndex((s) => s.gameInstanceId === gameInstanceId)
  if (index !== -1) unrecordedSessions.splice(index, 1)
}
