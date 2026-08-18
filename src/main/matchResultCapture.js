// In-memory capture of one match session's full result — Legend, in-game
// score, battlefield, winner, Bo3 series score, seat, and opponent name —
// built continuously from two independent sources while a session is live,
// and finalized into a plain result object the instant autoCapture.js's
// existing lobby-detection trigger fires. Read CLAUDE.md's Decision Log
// (the "match result auto-fill" entry) before touching this file — it
// documents both data sources, the confirmed permission, and the exact
// field names this was built and verified against.
//
// SOURCE A — WebSocket (ingestWebSocketMessage below): room_shell_sync and
// authoritative_snapshot frames carry a `.sessionDoc` (both message types)
// and authoritative_snapshot alone also carries a `.snapshot`. Only the
// specific fields named in the Decision Log are ever read.
//
// SOURCE B — DOM (ingestDomState below): fed by autoCapture.js's existing
// lobby-poll tick, which now also reads the opponent's Legend and both
// players' in-game score (0-8) directly off the Play tab's own rendered
// markup, on the same ~1s interval as the lobby-logo check.
//
// Every individual field is read inside its own try/catch — a failure on
// any one field (an unexpected message shape, a missing DOM node) must
// degrade that field to null/absent, never throw out of this module or
// block capture of anything else. There is only ever one active capture
// at a time (this module has no per-session keying beyond that), matching
// autoCapture.js's own single-session state machine.

// The live, in-progress capture for whatever session is currently
// TRACKING/RECORDING — null whenever no session is active. Reset to a
// fresh object at the start of every genuinely new session (see
// resetCapture), and consumed (read once, then cleared) by finalizeResult
// at session end.
let capture = null

function emptyCapture(selfPlayerId) {
  return {
    selfPlayerId: selfPlayerId ?? null,
    opponentPlayerId: null,
    matchFormat: null,
    winsByPlayerId: {},
    usedBattlefieldsByPlayerId: {},
    bo1Battlefields: { self: null, opponent: null },
    firstPlayerId: null,
    bo1Outcome: { winnerPlayerIds: null, reason: null },
    opponentName: null,
    currentGameNumber: null,
    seenGameNumbers: new Set(),
    // gameNumber -> { wins, firstPlayerId, domScore } snapshotted the
    // instant that gameNumber was first observed — see
    // buildBo3Result()'s comment for why this is what lets a Bo3's
    // per-game breakdown be recovered from otherwise-cumulative fields.
    boundarySnapshots: {},
    domOpponentLegend: null,
    domScore: { self: null, opponent: null }
  }
}

/**
 * Starts a fresh capture for a genuinely new session — called by
 * autoCapture.js's handleJoinGame only on the two branches that begin
 * tracking a brand new session, never on a reconnect/rejoin no-op (a Bo3's
 * later games must keep accumulating into the same capture, not restart
 * one per game — see usedBattlefieldsByPlayerId/winsByPlayerId's own
 * cumulative-across-the-series shape, which this module relies on).
 * `selfPlayerId` comes from that same join_game frame's own `.playerId`.
 */
export function resetCapture(selfPlayerId) {
  capture = emptyCapture(selfPlayerId)
}

function inferOpponentPlayerId(keys) {
  if (!capture.selfPlayerId || !Array.isArray(keys)) return
  const other = keys.find((key) => key && key !== capture.selfPlayerId)
  if (other) capture.opponentPlayerId = other
}

function snapshotCurrentGameState() {
  return {
    wins: { ...capture.winsByPlayerId },
    firstPlayerId: capture.firstPlayerId,
    domScore: { ...capture.domScore }
  }
}

/**
 * Feeds one parsed room_shell_sync or authoritative_snapshot WebSocket
 * message into the live capture. A no-op if no session is currently being
 * tracked (capture === null) — nothing to attach this to.
 */
export function ingestWebSocketMessage(message) {
  if (!capture || !message || typeof message !== 'object') return

  const doc = message.sessionDoc
  if (doc && typeof doc === 'object') {
    try {
      if (doc.matchFormat === 'bo1' || doc.matchFormat === 'bo3') capture.matchFormat = doc.matchFormat
    } catch {
      // fall through — a bad matchFormat value just leaves the prior one
    }

    try {
      if (doc.winsByPlayerId && typeof doc.winsByPlayerId === 'object') {
        capture.winsByPlayerId = doc.winsByPlayerId
        inferOpponentPlayerId(Object.keys(doc.winsByPlayerId))
      }
    } catch {
      // ignore — winsByPlayerId stays at its last known value
    }

    try {
      if (doc.usedBattlefieldsByPlayerId && typeof doc.usedBattlefieldsByPlayerId === 'object') {
        capture.usedBattlefieldsByPlayerId = doc.usedBattlefieldsByPlayerId
        inferOpponentPlayerId(Object.keys(doc.usedBattlefieldsByPlayerId))
      }
    } catch {
      // ignore
    }

    try {
      const selfBattlefield = doc.selfPlayer?.selectedBattlefield
      if (selfBattlefield) capture.bo1Battlefields.self = selfBattlefield
    } catch {
      // ignore
    }

    try {
      if (Array.isArray(doc.publicPlayers)) {
        for (const player of doc.publicPlayers) {
          if (!player || typeof player !== 'object') continue
          const playerId = player.playerId ?? player.id ?? null
          const isOpponent =
            (playerId && capture.selfPlayerId && playerId !== capture.selfPlayerId) ||
            (!playerId && doc.publicPlayers.length === 1)
          if (!isOpponent) continue
          if (playerId) capture.opponentPlayerId = playerId
          if (player.name) capture.opponentName = player.name
          if (player.selectedBattlefield) capture.bo1Battlefields.opponent = player.selectedBattlefield
        }
      }
    } catch {
      // ignore — opponentName/bo1Battlefields.opponent stay at last known value
    }

    try {
      const gameNumber = doc.gameNumber
      if (gameNumber && capture.matchFormat === 'bo3') {
        if (!capture.seenGameNumbers.has(gameNumber)) {
          // The state captured right as a NEW gameNumber first appears is
          // the previous game's own final state — see buildBo3Result.
          if (gameNumber > 1) capture.boundarySnapshots[gameNumber] = snapshotCurrentGameState()
          capture.seenGameNumbers.add(gameNumber)
        }
        capture.currentGameNumber = gameNumber
      }
    } catch {
      // ignore
    }
  }

  const snapshot = message.snapshot
  if (snapshot && typeof snapshot === 'object') {
    try {
      if (snapshot.firstPlayerId) capture.firstPlayerId = snapshot.firstPlayerId
    } catch {
      // ignore
    }

    try {
      if (snapshot.gameOutcome) {
        capture.bo1Outcome = {
          winnerPlayerIds: Array.isArray(snapshot.gameOutcome.winnerPlayerIds)
            ? snapshot.gameOutcome.winnerPlayerIds
            : null,
          // Stored for completeness only — per the Decision Log, `reason`
          // is never branched on (it's seen as "concession" even for a
          // natural point win), just kept around in case it's ever useful.
          reason: snapshot.gameOutcome.reason ?? null
        }
      }
    } catch {
      // ignore
    }
  }
}

/**
 * Feeds one DOM poll tick's worth of Source B data — called by
 * autoCapture.js's pollLobbyState on the same ~1s interval as the existing
 * lobby-logo check. Any field left null/undefined here (a selector that
 * didn't match) simply leaves the previously cached value in place rather
 * than clobbering it with a transient read failure.
 */
export function ingestDomState({ opponentLegend, selfScore, opponentScore } = {}) {
  if (!capture) return
  try {
    if (opponentLegend) capture.domOpponentLegend = opponentLegend
  } catch {
    // ignore
  }
  try {
    if (selfScore !== null && selfScore !== undefined) capture.domScore.self = selfScore
  } catch {
    // ignore
  }
  try {
    if (opponentScore !== null && opponentScore !== undefined) capture.domScore.opponent = opponentScore
  } catch {
    // ignore
  }
}

function resolveWentFirst(c, firstPlayerId) {
  if (!firstPlayerId || !c.selfPlayerId) return null
  return firstPlayerId === c.selfPlayerId
}

/**
 * Builds the Bo3 portion of a finalized result. usedBattlefieldsByPlayerId
 * and winsByPlayerId both arrive from the server already cumulative across
 * the whole series, so no per-game snapshotting is needed for battlefields
 * at all — reading index (gameNumber-1) off the final array is enough. Wins
 * are cumulative too, so a given game's own winner has to be recovered as a
 * delta between the wins total entering that game and the wins total
 * entering the next one (or the final total, for the series' last game) —
 * that's what boundarySnapshots (captured every time a new gameNumber was
 * first observed) exists for.
 */
function buildBo3Result(c, result) {
  try {
    const selfWins = c.winsByPlayerId?.[c.selfPlayerId] ?? 0
    const opponentWins = c.opponentPlayerId ? c.winsByPlayerId?.[c.opponentPlayerId] ?? 0 : null
    if (opponentWins !== null) {
      result.score = { self: selfWins, opponent: opponentWins }
      result.won = selfWins === opponentWins ? null : selfWins > opponentWins
    }
  } catch {
    // score/won stay null
  }

  let totalGames = 0
  try {
    totalGames = c.currentGameNumber ?? (c.seenGameNumbers.size > 0 ? Math.max(...c.seenGameNumbers) : 0)
  } catch {
    totalGames = 0
  }
  if (!totalGames || totalGames < 1) return

  let selfBattlefields = []
  let opponentBattlefields = []
  try {
    selfBattlefields = c.usedBattlefieldsByPlayerId?.[c.selfPlayerId] ?? []
  } catch {
    selfBattlefields = []
  }
  try {
    opponentBattlefields = c.opponentPlayerId ? c.usedBattlefieldsByPlayerId?.[c.opponentPlayerId] ?? [] : []
  } catch {
    opponentBattlefields = []
  }

  for (let gameNumber = 1; gameNumber <= totalGames; gameNumber++) {
    const game = {
      gameNumber,
      myBattlefield: null,
      opponentBattlefield: null,
      won: null,
      wentFirst: null,
      inGameScore: null
    }

    try {
      game.myBattlefield = selfBattlefields[gameNumber - 1] ?? null
    } catch {
      // ignore
    }
    try {
      game.opponentBattlefield = opponentBattlefields[gameNumber - 1] ?? null
    } catch {
      // ignore
    }

    const entering = c.boundarySnapshots[gameNumber] ?? { wins: {}, firstPlayerId: null, domScore: { self: null, opponent: null } }
    const ending = c.boundarySnapshots[gameNumber + 1] ?? { wins: c.winsByPlayerId, firstPlayerId: c.firstPlayerId, domScore: c.domScore }

    try {
      if (c.selfPlayerId && c.opponentPlayerId) {
        const selfDelta = (ending.wins?.[c.selfPlayerId] ?? 0) - (entering.wins?.[c.selfPlayerId] ?? 0)
        const opponentDelta = (ending.wins?.[c.opponentPlayerId] ?? 0) - (entering.wins?.[c.opponentPlayerId] ?? 0)
        if (selfDelta === 1 && opponentDelta !== 1) game.won = true
        else if (opponentDelta === 1 && selfDelta !== 1) game.won = false
      }
    } catch {
      // ignore
    }

    try {
      game.wentFirst = resolveWentFirst(c, ending.firstPlayerId)
    } catch {
      // ignore
    }

    try {
      const domScore = ending.domScore
      if (domScore && domScore.self !== null && domScore.self !== undefined && domScore.opponent !== null && domScore.opponent !== undefined) {
        game.inGameScore = { self: domScore.self, opponent: domScore.opponent }
      }
    } catch {
      // ignore
    }

    result.games.push(game)
  }
}

/**
 * Builds the Bo1 portion of a finalized result — a single game, no
 * boundary/delta bookkeeping needed since there's only ever one. Uses
 * `snapshot.gameOutcome.winnerPlayerIds` directly (never winsByPlayerId,
 * which is a Bo3-only field per the Decision Log).
 */
function buildBo1Result(c, result) {
  const game = {
    gameNumber: 1,
    myBattlefield: c.bo1Battlefields.self ?? null,
    opponentBattlefield: c.bo1Battlefields.opponent ?? null,
    won: null,
    wentFirst: null,
    inGameScore: null
  }

  try {
    if (Array.isArray(c.bo1Outcome.winnerPlayerIds) && c.selfPlayerId && c.bo1Outcome.winnerPlayerIds.length > 0) {
      game.won = c.bo1Outcome.winnerPlayerIds.includes(c.selfPlayerId)
    }
  } catch {
    // ignore
  }

  try {
    game.wentFirst = resolveWentFirst(c, c.firstPlayerId)
  } catch {
    // ignore
  }

  try {
    if (c.domScore.self !== null && c.domScore.self !== undefined && c.domScore.opponent !== null && c.domScore.opponent !== undefined) {
      game.inGameScore = { self: c.domScore.self, opponent: c.domScore.opponent }
    }
  } catch {
    // ignore
  }

  result.games.push(game)
  result.won = game.won
}

/**
 * Called once, by autoCapture.js's handleLobbyConfirmed, the instant the
 * existing lobby-detection trigger fires — commits whatever has been
 * cached so far as the final result and clears the live capture (the
 * session is over; the next one starts fresh via resetCapture). Returns
 * null only if no capture was ever active, which shouldn't happen given
 * this is only ever invoked for a session autoCapture.js already knows it
 * started tracking.
 */
export function finalizeResult() {
  if (!capture) return null
  const c = capture
  capture = null

  const result = {
    matchFormat: c.matchFormat ?? null,
    won: null,
    score: null,
    opponentLegend: c.domOpponentLegend ?? null,
    opponentName: c.opponentName ?? null,
    games: []
  }

  try {
    if (c.matchFormat === 'bo3') buildBo3Result(c, result)
    else if (c.matchFormat === 'bo1') buildBo1Result(c, result)
  } catch (err) {
    console.error('[match result capture] failed to finalize result:', err.message)
  }

  return result
}

// A finalized result for a RECORDING session has nowhere to go the moment
// it's computed — the recording's sidecar file (see capture.js) was
// already written at recording *start*, long before the result is known,
// and stopRecording() only runs slightly later via the auto-stop IPC round
// trip. This is a small handoff slot, keyed by gameInstanceId, that
// finalizeResult's caller stashes into for the RECORDING case;
// capture.js's stopRecording() consumes (reads once, then removes) it when
// it eventually runs, to merge into that sidecar. The non-recording case
// doesn't need this at all — its result is handed directly to
// matchSessions.completeSession() in the same synchronous call.
const stashedResults = new Map()

export function stashResultForRecording(gameInstanceId, result) {
  if (!gameInstanceId) return
  stashedResults.set(gameInstanceId, result)
}

export function consumeStashedResult(gameInstanceId) {
  if (!gameInstanceId) return null
  const result = stashedResults.get(gameInstanceId) ?? null
  stashedResults.delete(gameInstanceId)
  return result
}
