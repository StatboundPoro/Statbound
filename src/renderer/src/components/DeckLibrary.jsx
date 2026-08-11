import { useEffect, useState } from 'react'

// This is the proof that the whole pipeline works end to end:
// React component -> window.api (preload) -> ipcRenderer.invoke -> main
// process -> better-sqlite3 -> back again. Nothing here talks to SQLite
// directly; it only ever calls window.api.decks.list().
export default function DeckLibrary() {
  const [decks, setDecks] = useState([])
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    window.api.decks
      .list()
      .then((result) => {
        setDecks(result)
        setStatus('ready')
      })
      .catch((err) => {
        console.error('Failed to load decks:', err)
        setStatus('error')
      })
  }, [])

  return (
    <main className="deck-library">
      <h1>Deck Library</h1>

      {status === 'loading' && <p>Loading decks…</p>}
      {status === 'error' && <p>Could not load decks. Check the main process console.</p>}

      {status === 'ready' && decks.length === 0 && <p>No decks yet.</p>}

      {status === 'ready' && decks.length > 0 && (
        <ul className="deck-list">
          {decks.map((deck) => (
            <li key={deck.id} className="deck-card">
              <strong>{deck.name}</strong>
              <span>{deck.legend_name}</span>
              <span>
                {deck.domain_1}
                {deck.domain_2 ? ` / ${deck.domain_2}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
