import { useCallback, useEffect, useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import DeckLibrary from './components/DeckLibrary.jsx'
import DeckDetail from './components/DeckDetail.jsx'
import MatchHistory from './components/MatchHistory.jsx'
import PlayScreen from './components/PlayScreen.jsx'
import SettingsScreen from './components/SettingsScreen.jsx'
import InsightsScreen from './components/InsightsScreen.jsx'
import MatchupMatrixScreen from './components/MatchupMatrixScreen.jsx'
import LogMatchModal from './components/LogMatchModal.jsx'
import WelcomeTour from './components/WelcomeTour.jsx'
import { useScreenRecording } from './lib/recording.js'

// No router yet — still just view state, now toggling between the five
// rail sections that have screens (Play; Decks, with its own nested
// library/detail toggle; Matches; Insights; and Settings).
export default function App() {
  const [screen, setScreen] = useState('decks')
  const [selectedDeckId, setSelectedDeckId] = useState(null)
  // Only ever set by Deck Detail's "View Insights" button — a one-time
  // deep link into Insights pre-scoped to the deck being viewed. Plain
  // Sidebar navigation to Insights always resets this to null (below), so
  // the nav item itself still lands on "All Decks" as before.
  const [insightsDeckId, setInsightsDeckId] = useState(null)

  // The unified "Log Recent Match" queue (recorded files + in-memory
  // not-recorded sessions, see src/main/replays.js) and the recording hook
  // itself both live here, above the per-screen render tree — see
  // lib/recording.js's module comment for why the recording hook
  // specifically can't stay scoped to PlayScreen anymore now that
  // auto-detection can fire while the user is on any screen.
  const [pendingReplays, setPendingReplays] = useState([])
  // The one queue item opened via the Sidebar queue's "Log Match" button —
  // rendered here, not inside any particular screen, since the queue
  // itself is reachable from every screen. May be either item shape (see
  // replays.js): a recorded file (hasRecording: true) or a bare session
  // with no recording (hasRecording: false, no filePath).
  const [queuedReplay, setQueuedReplay] = useState(null)
  // The Play tab's own manual "Log Match" button (see PlayScreen.jsx) —
  // a plain shortcut with no queue/recording involved. `undefined` means
  // closed; a string or null (no deck chosen) means open, pre-selecting
  // that deck. Kept separate from queuedReplay above since the two are
  // unrelated entry points into the same LogMatchModal.
  const [manualLogMatchDeckId, setManualLogMatchDeckId] = useState(undefined)
  // Mirrors Sidebar's own update-panel open state (see its
  // onUpdatePanelOpenChange callback) purely so the Play tab's embed can be
  // hidden while it's open — same embedHidden reasoning as queuedReplay/
  // manualLogMatchDeckId below, since this popover also renders as plain
  // DOM in this window's own document.
  const [updatePanelOpen, setUpdatePanelOpen] = useState(false)
  // Bumped (not just a boolean) every time the queue gains a new entry —
  // a recording finishing, or a non-recorded session ending — so
  // Sidebar's effect, which auto-opens the queue popover as a self-
  // dismissing notification, has a value that reliably changes on every
  // such event, including back-to-back matches, rather than needing to
  // infer "something new just landed" from pendingReplays' length alone.
  const [logQueueSignal, setLogQueueSignal] = useState(0)

  const refreshPendingReplays = useCallback(() => {
    return window.api.replays
      .listPending()
      .then((list) => {
        setPendingReplays(list)
        return list
      })
      .catch((err) => {
        console.error('Failed to load the Log Recent Match queue:', err)
        return []
      })
  }, [])

  useEffect(() => {
    refreshPendingReplays()
  }, [refreshPendingReplays])

  const notifyQueueChanged = useCallback(() => {
    refreshPendingReplays()
    setLogQueueSignal((n) => n + 1)
  }, [refreshPendingReplays])

  // The lobby-detection stop trigger (src/main/autoCapture.js) — the sole
  // automatic-stop mechanism now, for both Bo1 and Bo3 alike — auto-opens
  // LogMatchModal on top of the existing queue refetch/notification, pinned
  // to whatever just landed at the front of the queue (listPending()'s own
  // most-recent-first order). A manual Stop press never reaches this path:
  // it only runs from an `auto: true` recording stop or the
  // replays:pending-queue-changed push, both of which are now exclusively
  // produced by the lobby trigger (see autoCapture.js's module comment) —
  // see lib/recording.js's onStopped doc for why manual/auto are threaded
  // through as a flag rather than inferred here.
  const autoOpenLogMatch = useCallback(() => {
    refreshPendingReplays().then((list) => {
      setLogQueueSignal((n) => n + 1)
      if (list.length > 0) setQueuedReplay(list[0])
    })
  }, [refreshPendingReplays])

  const recording = useScreenRecording({
    onStopped: (info) => (info?.auto ? autoOpenLogMatch() : notifyQueueChanged())
  })

  // A session that finished with no recording ever tied to it has no
  // capture:auto-stop to hook a refetch off of (nothing was recording) —
  // this is what autoCapture.js pushes instead once such a session lands
  // on the queue (see matchSessions.js). Always the lobby-detection
  // trigger too (a TRACKING session with no recording only ever ends that
  // way), so this always auto-opens as well.
  useEffect(() => window.api.replays.onPendingQueueChanged(autoOpenLogMatch), [autoOpenLogMatch])

  // First-run welcome tour: shown automatically exactly once, the first
  // time hasSeenWelcomeTour reads false. Checked in an effect (fires after
  // the initial render, not before it) rather than as render-blocking
  // state, so the rest of the app paints immediately and the tour just
  // pops in on top a moment later. Completing OR skipping it both persist
  // hasSeenWelcomeTour = true (see WelcomeTour.jsx's finish()), so this
  // never shows again on a later launch either way. A manual replay from
  // Settings is a fully separate instance of the same component owned by
  // SettingsScreen.jsx itself, with persistSeen={false} — it doesn't touch
  // this state or the preference at all.
  const [showWelcomeTour, setShowWelcomeTour] = useState(false)

  useEffect(() => {
    window.api.welcomeTour
      .getSeen()
      .then((seen) => {
        if (!seen) setShowWelcomeTour(true)
      })
      .catch((err) => console.error('Failed to load welcome tour state:', err))
  }, [])

  function handleNavigate(key) {
    setScreen(key)
    if (key === 'decks') setSelectedDeckId(null)
    if (key === 'insights') setInsightsDeckId(null)
  }

  function handleViewDeckInsights(deckId) {
    setInsightsDeckId(deckId)
    setScreen('insights')
  }

  function handleQueuedMatchSaved() {
    // A hasRecording: false item has no file to unlink it via — it only
    // ever leaves the queue when explicitly discarded or, here, once it's
    // actually been logged, so it doesn't linger looking unlogged. A
    // hasRecording: true item needs no such call: replays:create already
    // linked its file during save, which is what drops it out of the next
    // listUnlinked()/listPending() scan on its own.
    if (queuedReplay && !queuedReplay.hasRecording) {
      window.api.replays
        .discardPending(queuedReplay)
        .catch((err) => console.error('Failed to clear a logged session from the queue:', err))
    }
    setQueuedReplay(null)
    refreshPendingReplays()
  }

  function handleOpenManualLogMatch(deckId) {
    setManualLogMatchDeckId(deckId ?? null)
  }

  function handleManualLogMatchSaved() {
    setManualLogMatchDeckId(undefined)
    refreshPendingReplays()
  }

  return (
    <div className="app">
      <Sidebar
        active={screen}
        onNavigate={handleNavigate}
        pendingReplays={pendingReplays}
        onLogMatch={setQueuedReplay}
        onPendingChanged={refreshPendingReplays}
        logQueueSignal={logQueueSignal}
        onUpdatePanelOpenChange={setUpdatePanelOpen}
      />
      {screen === 'play' ? (
        <PlayScreen
          recording={recording.recording}
          starting={recording.starting}
          elapsedSeconds={recording.elapsedSeconds}
          error={recording.error}
          onStart={recording.start}
          onStop={recording.stop}
          onLogMatch={handleOpenManualLogMatch}
          // The Play embed is a native WebContentsView that always paints
          // above ordinary DOM content regardless of CSS z-index (the same
          // reason the Pending Recordings popover needed its own dedicated
          // overlay view — see pendingPanelView.js). LogMatchModal below
          // renders as plain DOM in this window's own document, so if it's
          // opened via the Log Recent Match queue notification, or this
          // screen's own manual Log Match button, while the user is still
          // on this screen, it would otherwise be stuck invisibly
          // underneath the embed with no way to click into it.
          embedHidden={Boolean(queuedReplay) || manualLogMatchDeckId !== undefined || updatePanelOpen}
        />
      ) : screen === 'matches' ? (
        <MatchHistory />
      ) : screen === 'insights' ? (
        <InsightsScreen initialDeckId={insightsDeckId} />
      ) : screen === 'matchup-matrix' ? (
        <MatchupMatrixScreen />
      ) : screen === 'settings' ? (
        <SettingsScreen />
      ) : selectedDeckId ? (
        <DeckDetail
          deckId={selectedDeckId}
          onBack={() => setSelectedDeckId(null)}
          onViewInsights={handleViewDeckInsights}
        />
      ) : (
        <DeckLibrary onOpenDeck={setSelectedDeckId} onPlay={() => handleNavigate('play')} />
      )}

      {queuedReplay && (
        <LogMatchModal
          initialDeckId={queuedReplay.deckId ?? null}
          preselectedReplayPath={queuedReplay.hasRecording ? queuedReplay.filePath : null}
          autoFillResult={queuedReplay.matchResult ?? null}
          onClose={() => setQueuedReplay(null)}
          onSaved={handleQueuedMatchSaved}
        />
      )}

      {manualLogMatchDeckId !== undefined && (
        <LogMatchModal
          initialDeckId={manualLogMatchDeckId}
          onClose={() => setManualLogMatchDeckId(undefined)}
          onSaved={handleManualLogMatchSaved}
        />
      )}

      {showWelcomeTour && <WelcomeTour onClose={() => setShowWelcomeTour(false)} />}
    </div>
  )
}
