import { useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import DeckLibrary from './components/DeckLibrary.jsx'
import DeckDetail from './components/DeckDetail.jsx'
import MatchHistory from './components/MatchHistory.jsx'
import PlayScreen from './components/PlayScreen.jsx'
import SettingsScreen from './components/SettingsScreen.jsx'

// No router yet — still just view state, now toggling between the four
// rail sections that actually have screens (Play; Decks, with its own
// nested library/detail toggle; Matches; and Settings). Insights stays
// inert in Sidebar until it has a screen of its own.
export default function App() {
  const [screen, setScreen] = useState('decks')
  const [selectedDeckId, setSelectedDeckId] = useState(null)

  function handleNavigate(key) {
    setScreen(key)
    if (key === 'decks') setSelectedDeckId(null)
  }

  return (
    <div className="app">
      <Sidebar active={screen} onNavigate={handleNavigate} />
      {screen === 'play' ? (
        <PlayScreen />
      ) : screen === 'matches' ? (
        <MatchHistory />
      ) : screen === 'settings' ? (
        <SettingsScreen />
      ) : selectedDeckId ? (
        <DeckDetail deckId={selectedDeckId} onBack={() => setSelectedDeckId(null)} />
      ) : (
        <DeckLibrary onOpenDeck={setSelectedDeckId} onPlay={() => handleNavigate('play')} />
      )}
    </div>
  )
}
