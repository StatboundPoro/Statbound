import { ipcMain } from 'electron'
import { createDeck, deleteDeck, getDeckById, listDecks, updateDeck } from './decks.js'
import { createMatch, deleteMatch, getMatchById, listMatches, updateMatch } from './matches.js'
import { createDeckNote, deleteDeckNote, listDeckNotesByDeck, updateDeckNote } from './deckNotes.js'

/**
 * Registers every ipcMain.handle() endpoint the renderer is allowed to call.
 * This is the entire surface area the UI has into the database — nothing
 * else is reachable from the renderer process. Each channel name is
 * namespaced as "<resource>:<action>" to keep things predictable as more
 * are added.
 */
export function registerIpcHandlers() {
  ipcMain.handle('decks:list', () => listDecks())
  ipcMain.handle('decks:get', (_event, id) => getDeckById(id))
  ipcMain.handle('decks:create', (_event, deck) => createDeck(deck))
  ipcMain.handle('decks:update', (_event, id, deck) => updateDeck(id, deck))
  ipcMain.handle('decks:delete', (_event, id) => deleteDeck(id))
  ipcMain.handle('matches:list', () => listMatches())
  ipcMain.handle('matches:get', (_event, id) => getMatchById(id))
  ipcMain.handle('matches:create', (_event, match) => createMatch(match))
  ipcMain.handle('matches:update', (_event, id, match) => updateMatch(id, match))
  ipcMain.handle('matches:delete', (_event, id) => deleteMatch(id))
  ipcMain.handle('deck-notes:list', (_event, deckId) => listDeckNotesByDeck(deckId))
  ipcMain.handle('deck-notes:create', (_event, note) => createDeckNote(note))
  ipcMain.handle('deck-notes:update', (_event, id, patch) => updateDeckNote(id, patch))
  ipcMain.handle('deck-notes:delete', (_event, id) => deleteDeckNote(id))
}
