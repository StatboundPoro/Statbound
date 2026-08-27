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
// specific fields named in the Decision Log are ever read. Battlefield was
// originally read from here too (`selfPlayer`/`publicPlayers[]`'s assumed
// `.selectedBattlefield`) — confirmed via real testing to be wrong, moved
// to Source B below instead (see the Decision Log's "match result
// auto-fill" entry for the full story).
//
// SOURCE B — DOM (ingestDomState below): fed by autoCapture.js's existing
// lobby-poll tick, which reads the opponent's Legend, both players'
// battlefield, and both players' in-game score (0-8), all directly off
// the Play tab's own rendered markup, on the same ~1s interval as the
// lobby-logo check.
//
// Every individual field is read inside its own try/catch — a failure on
// any one field (an unexpected message shape, a missing DOM node) must
// degrade that field to null/absent, never throw out of this module or
// block capture of anything else. There is only ever one active capture
// at a time (this module has no per-session keying beyond that), matching
// autoCapture.js's own single-session state machine.
//
// CARD EVENTS (ingestMatchLogState/ingestMulliganState below) are a later,
// separate addition on top of the same capture object and the same commit
// timing — a stream of "played"/"mulliganed"/"scored_on_battlefield" card
// (or battlefield) names accumulated across the whole session, rather than
// a handful of static values known once.
// PLAYED reads the match log's own `[data-log-action-kind]` entries (any
// value — see autoCapture.js for why this isn't scoped to a specific
// value like "board"), confirming a real play via that row's own "Played "
// text (or, for a Chosen Champion's first entrance, a "Moved ... to base"
// row with only one card reference — see autoCapture.js), with the card
// name read from that row's own `[data-log-card-name]` element's TEXT
// CONTENT (that attribute is a boolean marker, not the name). Deduped by a
// per-card-name COUNT diff (a multiset), not a position-based high-water
// mark — real testing found the log's entries don't stay at stable
// positions across polls (grouped by turn, with an out-of-chronological-
// order "Earlier activity" bucket observed in real markup), which broke an
// earlier position-based approach badly enough that a single real play got
// recorded over a dozen times — see ingestMatchLogState's own comment for
// the full story.
// SCORED_ON_BATTLEFIELD (added in a later pass, for Insights' Most-Scored-On
// Battlefield stat) reads the same match log's "Conquered [Battlefield] and
// scored 1" entries, same `[data-log-action-kind]`/`[data-log-card-name]`
// read pattern as PLAYED, deduped the exact same per-name count-diff way —
// just a second, independent name-count map so a card play and a
// battlefield score can never cross-contaminate each other's dedup state.
// Not yet confirmed against real match markup the way PLAYED's several
// rounds of correction were (see CLAUDE.md's Decision Log) — built
// defensively against the described log phrasing and flagged for real-match
// verification.
// Both PLAYED and SCORED_ON_BATTLEFIELD rows, as of that same later pass,
// also carry a turn_number read off an ancestor `data-turn-number`
// attribute (see autoCapture.js's SESSION_STATE_CHECK_SCRIPT) — also
// unconfirmed against real markup and flagged the same way.
// MULLIGANED reads the mulligan screen's live selection state on the same
// ~1s poll tick and commits whichever cards are selected the instant that
// screen disappears. Unlike every other DOM read in this module, the
// mulligan screen has no confirmed data-*/aria-label selector to key off
// of (see CLAUDE.md's Decision Log for why) — it's detected structurally
// instead (an inline `--mul-card-w` custom property plus a "Keep Hand"/
// "Mulligan N" button landmark), and "selected" is a majority vote across
// three independent signals rather than a single hardcoded match, the same
// "compare against the group's own baseline, never a hardcoded value"
// posture this module's own opponent-score reading already established.
// Mulligan events never carry a turn_number — the mulligan screen isn't
// part of the turn-numbered match log at all, so there's no ancestor
// `data-turn-number` to read for it.
// Both PLAYED/MULLIGANED are flagged in CLAUDE.md as needing real-match
// confirmation before being treated as fully reliable, the same standing as
// this project's other DOM-dependent features that shipped without a live
// window to verify against in this environment.

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
    firstPlayerId: null,
    bo1Outcome: { winnerPlayerIds: null, reason: null },
    opponentName: null,
    currentGameNumber: null,
    seenGameNumbers: new Set(),
    // gameNumber -> { wins, firstPlayerId, domScore, domBattlefield }
    // snapshotted the instant that gameNumber was first observed — see
    // buildBo3Result()'s comment for why this is what lets a Bo3's
    // per-game breakdown be recovered from otherwise-cumulative/live-only
    // fields.
    boundarySnapshots: {},
    domOpponentLegend: null,
    // Both players' current battlefield, Source B (DOM) only — see
    // ingestDomState below and the Decision Log's "match result auto-fill"
    // entry for why this moved off the WebSocket fields it originally read.
    domBattlefield: { self: null, opponent: null },
    domScore: { self: null, opponent: null },
    // The current game's highest observed turn number, Source B (DOM) —
    // same live-overwrite treatment as domScore/domBattlefield above (the
    // DOM only ever reflects the *current* game's state, reset for each new
    // game of a Bo3 — see buildBo3Result's own comment), not an
    // accumulated-forever running max. Feeds each game's turnCount field —
    // see ingestDomState and buildBo1Result/buildBo3Result below.
    domHighestTurn: null,
    // Card events — see the module comment above. Accumulated across the
    // whole session (every game of a Bo3 alike), each `{ gameNumber,
    // cardName, eventType, turnNumber }`, committed straight into
    // finalizeResult()'s returned `cardEvents` array with no further
    // processing needed.
    cardEvents: [],
    // Per-card-name play counts already turned into cardEvents rows, keyed
    // by card name — see ingestMatchLogState below for why this is a
    // multiset diff rather than a position-based high-water mark.
    playedNameCounts: new Map(),
    // Same idea as playedNameCounts, kept as a separate map so a card play
    // and a battlefield score can never share (and corrupt) each other's
    // dedup state — see ingestMatchLogState below.
    scoredBattlefieldNameCounts: new Map(),
    // Whether the mulligan screen was present on the previous poll tick —
    // used only to detect the screen-just-disappeared transition that
    // commits mulliganLiveSelected. See ingestMulliganState below.
    mulliganScreenActive: false,
    mulliganLiveSelected: []
  }
}

// For card events, a Bo3's per-game bucketing reuses the same
// currentGameNumber the WebSocket's own doc.gameNumber already tracks
// (Bo3-only — see ingestWebSocketMessage's gameNumber branch above); Bo1
// has no such field and is always game 1.
function activeGameNumber(c) {
  if (c.matchFormat === 'bo3') return c.currentGameNumber ?? 1
  return 1
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
    domScore: { ...capture.domScore },
    domBattlefield: { ...capture.domBattlefield },
    domHighestTurn: capture.domHighestTurn
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
        }
      }
    } catch {
      // ignore — opponentName/opponentPlayerId stay at last known value
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
export function ingestDomState({
  opponentLegend,
  selfBattlefield,
  opponentBattlefield,
  selfScore,
  opponentScore,
  highestTurnNumber
} = {}) {
  if (!capture) return
  try {
    if (opponentLegend) capture.domOpponentLegend = opponentLegend
  } catch {
    // ignore
  }
  try {
    if (selfBattlefield) capture.domBattlefield.self = selfBattlefield
  } catch {
    // ignore
  }
  try {
    if (opponentBattlefield) capture.domBattlefield.opponent = opponentBattlefield
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
  try {
    if (highestTurnNumber !== null && highestTurnNumber !== undefined) capture.domHighestTurn = highestTurnNumber
  } catch {
    // ignore
  }
}

// Shared by the 'played' and 'scored_on_battlefield' streams below — both
// are the exact same per-card(/battlefield)-name COUNT diff (a multiset),
// not a position-based high-water mark (see ingestMatchLogState's own
// comment for the full story of why). `entries` is the FULL list of every
// currently-qualifying row of this event type, each `{ cardName,
// turnNumber }`, not just new ones since the last poll (autoCapture.js's DOM
// script has no memory of its own between ticks) — `nameCounts` is that
// event type's own dedup map (capture.playedNameCounts or
// capture.scoredBattlefieldNameCounts, kept separate per event type so
// neither can corrupt the other's count state).
function ingestCountedNameEvents(entries, eventType, nameCounts) {
  const byName = new Map()
  for (const entry of entries) {
    if (!entry?.cardName) continue
    if (!byName.has(entry.cardName)) byName.set(entry.cardName, [])
    byName.get(entry.cardName).push(Number.isInteger(entry.turnNumber) ? entry.turnNumber : null)
  }

  const gameNumber = activeGameNumber(capture)
  for (const [cardName, turnNumbers] of byName) {
    const alreadyRecorded = nameCounts.get(cardName) ?? 0
    for (let i = alreadyRecorded; i < turnNumbers.length; i++) {
      capture.cardEvents.push({ gameNumber, cardName, eventType, turnNumber: turnNumbers[i] })
    }
    if (turnNumbers.length > alreadyRecorded) nameCounts.set(cardName, turnNumbers.length)
  }
}

/**
 * Feeds one poll tick's worth of match-log entries — `playedCards` is the
 * FULL list of every currently-qualifying play (a "Played ..." row, or a
 * Chosen Champion's "Moved ... to base" entry — see autoCapture.js), each
 * `{ cardName, turnNumber }`; `scoredBattlefieldCards` (added in a later
 * pass, for Insights' Most-Scored-On Battlefield stat) is the same shape for
 * "Conquered [Battlefield] and scored 1" rows, where `cardName` actually
 * holds a battlefield name (see db.js's SCHEMA comment on this same reuse
 * in match_card_events itself). Neither is just new entries since the last
 * tick — autoCapture.js's DOM script has no memory of its own between polls.
 *
 * Deliberately a per-name COUNT diff (a multiset), not a position-based
 * high-water mark — an earlier version compared the played list's length
 * against how many were consumed on the previous tick and sliced off the
 * assumed-new tail, on the assumption the log only ever appends at a stable
 * position. Real testing found that wrong: a single real play (reported:
 * one "Mirror Image") got recorded well over a dozen times over the course
 * of a match with a lot of other board activity (repeated battlefield
 * moves), which only makes sense if entries already counted were later
 * mistaken for new ones again — i.e. the log's positions aren't as stable
 * as assumed (real markup shows entries grouped by turn, with an "Earlier
 * activity" bucket that isn't in simple chronological DOM order either, so
 * a fixed "tail beyond N" slice can't be trusted). Counting occurrences per
 * name sidesteps the ordering question entirely: as long as a real entry,
 * once it appears in the log, never actually disappears from the
 * currently-qualifying list (true per Part 0's confirmed finding that the
 * log never collapses/hides), comparing each name's current count against
 * its previously recorded count and only emitting the increase is correct
 * regardless of how the DOM reorders entries around it. See
 * ingestCountedNameEvents above for the shared implementation both streams
 * use — turnNumber rides along per occurrence (in DOM/array order, same
 * order the previous name-only version already relied on) so the specific
 * turn a given play/score happened on survives the dedup untouched.
 */
export function ingestMatchLogState({ playedCards, scoredBattlefieldCards } = {}) {
  if (!capture) return
  try {
    if (Array.isArray(playedCards)) {
      ingestCountedNameEvents(playedCards, 'played', capture.playedNameCounts)
    }
  } catch {
    // ignore — this poll's played-card read contributes nothing
  }
  try {
    if (Array.isArray(scoredBattlefieldCards)) {
      ingestCountedNameEvents(scoredBattlefieldCards, 'scored_on_battlefield', capture.scoredBattlefieldNameCounts)
    }
  } catch {
    // ignore — this poll's scored-battlefield read contributes nothing
  }
}

/**
 * Feeds one poll tick's worth of mulligan-screen state. `onScreen` is
 * whether the mulligan screen is currently detected at all;
 * `selectedCardNames` is the live set of currently-selected candidate
 * card names, meaningful only while `onScreen` is true. Continuously
 * overwrites `mulliganLiveSelected` with the latest live reading — no
 * accumulation while the screen is up, since a toggled-off card should
 * stop counting as mulliganed. The moment `onScreen` goes from true to
 * false (the screen has closed, gameplay is starting), whatever was
 * selected on the last true reading commits as this game's mulliganed
 * cards. A screen that never reports any selected cards (a straight Keep
 * Hand) simply commits zero events, not an error.
 */
export function ingestMulliganState({ onScreen, selectedCardNames } = {}) {
  if (!capture) return
  try {
    if (onScreen) {
      capture.mulliganLiveSelected = Array.isArray(selectedCardNames) ? selectedCardNames : []
      capture.mulliganScreenActive = true
      return
    }

    if (capture.mulliganScreenActive) {
      const gameNumber = activeGameNumber(capture)
      for (const cardName of capture.mulliganLiveSelected) {
        if (!cardName) continue
        capture.cardEvents.push({ gameNumber, cardName, eventType: 'mulliganed' })
      }
      capture.mulliganScreenActive = false
      capture.mulliganLiveSelected = []
    }
  } catch {
    // ignore — a failure here just means this game's mulligan picks are lost
  }
}

function resolveWentFirst(c, firstPlayerId) {
  if (!firstPlayerId || !c.selfPlayerId) return null
  return firstPlayerId === c.selfPlayerId
}

/**
 * Builds the Bo3 portion of a finalized result. winsByPlayerId arrives from
 * the server already cumulative across the whole series, so a given game's
 * own winner has to be recovered as a delta between the wins total entering
 * that game and the wins total entering the next one (or the final total,
 * for the series' last game) — that's what boundarySnapshots (captured
 * every time a new gameNumber was first observed) exists for. Battlefield
 * and in-game score are both DOM-only (Source B) and live-only (the DOM
 * only ever shows the *current* game's state, with no history of earlier
 * games the way winsByPlayerId's cumulative shape provides) — so both are
 * recovered the exact same way as each other: read from whichever snapshot
 * captures that game's state right as it ended (see `ending` below).
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

  const emptySnapshot = {
    wins: {},
    firstPlayerId: null,
    domScore: { self: null, opponent: null },
    domBattlefield: { self: null, opponent: null },
    domHighestTurn: null
  }

  for (let gameNumber = 1; gameNumber <= totalGames; gameNumber++) {
    const game = {
      gameNumber,
      myBattlefield: null,
      opponentBattlefield: null,
      won: null,
      wentFirst: null,
      inGameScore: null,
      turnCount: null
    }

    const entering = c.boundarySnapshots[gameNumber] ?? emptySnapshot
    const ending = c.boundarySnapshots[gameNumber + 1] ?? {
      wins: c.winsByPlayerId,
      firstPlayerId: c.firstPlayerId,
      domScore: c.domScore,
      domBattlefield: c.domBattlefield,
      domHighestTurn: c.domHighestTurn
    }

    try {
      const bf = ending.domBattlefield
      if (bf?.self) game.myBattlefield = bf.self
      if (bf?.opponent) game.opponentBattlefield = bf.opponent
    } catch {
      // ignore
    }

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

    try {
      if (Number.isInteger(ending.domHighestTurn)) game.turnCount = ending.domHighestTurn
    } catch {
      // ignore
    }

    result.games.push(game)
  }
}

/**
 * Builds the Bo1 portion of a finalized result — a single game, no
 * boundary/delta bookkeeping needed since there's only ever one. Prefers
 * `snapshot.gameOutcome.winnerPlayerIds` when available, but real testing
 * showed it essentially never arrives for a Bo1 that ends by a player
 * simply returning to the lobby rather than some formal end-of-game
 * message — unlike Bo3, which gets its per-game winner from
 * `winsByPlayerId` (a field that reliably updates as soon as any game
 * concludes, including the deciding one), Bo1 has no equivalent
 * WebSocket-sourced fallback at all. So `won` falls back to comparing
 * both players' final in-game score (Source B/DOM, already captured for
 * the `inGameScore` field below) — whichever side is ahead when the
 * lobby-detection trigger fires is the winner; a tie or missing score
 * leaves `won` at null rather than guessing.
 */
function buildBo1Result(c, result) {
  const game = {
    gameNumber: 1,
    myBattlefield: c.domBattlefield.self ?? null,
    opponentBattlefield: c.domBattlefield.opponent ?? null,
    won: null,
    wentFirst: null,
    inGameScore: null,
    turnCount: null
  }

  try {
    if (Number.isInteger(c.domHighestTurn)) game.turnCount = c.domHighestTurn
  } catch {
    // ignore
  }

  try {
    if (Array.isArray(c.bo1Outcome.winnerPlayerIds) && c.selfPlayerId && c.bo1Outcome.winnerPlayerIds.length > 0) {
      game.won = c.bo1Outcome.winnerPlayerIds.includes(c.selfPlayerId)
    }
  } catch {
    // ignore
  }

  try {
    if (game.won === null) {
      const self = c.domScore.self
      const opponent = c.domScore.opponent
      if (self !== null && self !== undefined && opponent !== null && opponent !== undefined && self !== opponent) {
        game.won = self > opponent
      }
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
    games: [],
    // Whatever "played"/"mulliganed" events were accumulated across the
    // whole session — see the module comment above. Committed as-is; a
    // mulligan screen still open when the lobby trigger fires (shouldn't
    // happen, gameplay must start before the lobby can be reached) simply
    // leaves that game's picks uncommitted rather than guessing.
    cardEvents: Array.isArray(c.cardEvents) ? c.cardEvents : []
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
