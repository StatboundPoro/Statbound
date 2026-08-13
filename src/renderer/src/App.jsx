import { useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import DeckLibrary from './components/DeckLibrary.jsx'
import DeckDetail from './components/DeckDetail.jsx'
import MatchHistory from './components/MatchHistory.jsx'
import PlayScreen from './components/PlayScreen.jsx'
import SettingsScreen from './components/SettingsScreen.jsx'
import InsightsScreen from './components/InsightsScreen.jsx'

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

  function handleNavigate(key) {
    setScreen(key)
    if (key === 'decks') setSelectedDeckId(null)
    if (key === 'insights') setInsightsDeckId(null)
  }

  function handleViewDeckInsights(deckId) {
    setInsightsDeckId(deckId)
    setScreen('insights')
  }

  return (
    <div className="app">
      <Sidebar active={screen} onNavigate={handleNavigate} />
      {screen === 'play' ? (
        <PlayScreen />
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
    </div>
  )
}
