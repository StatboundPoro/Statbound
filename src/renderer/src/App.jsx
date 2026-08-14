import { useCallback, useEffect, useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import DeckLibrary from './components/DeckLibrary.jsx'
import DeckDetail from './components/DeckDetail.jsx'
import MatchHistory from './components/MatchHistory.jsx'
import PlayScreen from './components/PlayScreen.jsx'
import SettingsScreen from './components/SettingsScreen.jsx'
import InsightsScreen from './components/InsightsScreen.jsx'
import LogMatchModal from './components/LogMatchModal.jsx'
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

  // Pending Recordings (unlinked files, surfaced via the Sidebar badge)
  // and the recording hook itself both live here, above the per-screen
  // render tree — see lib/recording.js's module comment for why the
  // recording hook specifically can't stay scoped to PlayScreen anymore
  // now that auto-detection can fire while the user is on any screen.
  const [pendingReplays, setPendingReplays] = useState([])
  // The one pending recording opened via the Sidebar queue's "Log Match"
  // button — rendered here, not inside any particular screen, since the
  // queue itself is reachable from every screen.
  const [queuedReplay, setQueuedReplay] = useState(null)
  // Bumped (not just a boolean) every time a recording finishes, so
  // Sidebar's effect — which auto-opens the Pending Recordings popover as
  // a self-dismissing notification — has a value that reliably changes on
  // every stop, including back-to-back matches, rather than needing to
  // infer "a new one just finished" from pendingReplays' length alone.
  const [recordingStoppedSignal, setRecordingStoppedSignal] = useState(0)

  const refreshPendingReplays = useCallback(() => {
    window.api.replays
      .listPending()
      .then(setPendingReplays)
      .catch((err) => console.error('Failed to load pending recordings:', err))
  }, [])

  useEffect(() => {
    refreshPendingReplays()
  }, [refreshPendingReplays])

  const handleRecordingStopped = useCallback(() => {
    refreshPendingReplays()
    setRecordingStoppedSignal((n) => n + 1)
  }, [refreshPendingReplays])

  const recording = useScreenRecording({ onStopped: handleRecordingStopped })

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
    setQueuedReplay(null)
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
        recordingStoppedSignal={recordingStoppedSignal}
      />
      {screen === 'play' ? (
        <PlayScreen
          recording={recording.recording}
          starting={recording.starting}
          elapsedSeconds={recording.elapsedSeconds}
          error={recording.error}
          onStart={recording.start}
          onStop={recording.stop}
          // The Play embed is a native WebContentsView that always paints
          // above ordinary DOM content regardless of CSS z-index (the same
          // reason the Pending Recordings popover needed its own dedicated
          // overlay view — see pendingPanelView.js). LogMatchModal below
          // renders as plain DOM in this window's own document, so if it's
          // opened via the Pending Recordings notification while the user
          // is still on this screen, it would otherwise be stuck invisibly
          // underneath the embed with no way to click into it.
          embedHidden={Boolean(queuedReplay)}
        />
      ) : screen === 'matches' ? (
        <MatchHistory />
      ) : screen === 'insights' ? (
        <InsightsScreen initialDeckId={insightsDeckId} />
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
          preselectedReplayPath={queuedReplay.filePath}
          onClose={() => setQueuedReplay(null)}
          onSaved={handleQueuedMatchSaved}
        />
      )}
    </div>
  )
}
