import { useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import DeckLibrary from './components/DeckLibrary.jsx'
import DeckDetail from './components/DeckDetail.jsx'
import MatchHistory from './components/MatchHistory.jsx'

// No router yet — still just view state, now toggling between the two
// rail sections that actually have screens (Decks, with its own nested
// library/detail toggle, and Matches) rather than one flat library/detail
// pair. Insights/Settings stay inert in Sidebar until they have screens
// of their own.
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
      {screen === 'matches' ? (
        <MatchHistory />
      ) : selectedDeckId ? (
        <DeckDetail deckId={selectedDeckId} onBack={() => setSelectedDeckId(null)} />
      ) : (
        <DeckLibrary onOpenDeck={setSelectedDeckId} />
      )}
    </div>
  )
}
