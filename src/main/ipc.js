import { ipcMain } from 'electron'
import { getDbPath } from './db.js'
import { createDeck, deleteDeck, getDeckById, listDecks, updateDeck } from './decks.js'
import { createMatch, deleteMatch, getMatchById, listMatches, updateMatch } from './matches.js'
import { createDeckNote, deleteDeckNote, listDeckNotesByDeck, updateDeckNote } from './deckNotes.js'
import { hidePlayView, setPlayBounds, showPlayView } from './playView.js'
import {
  chooseAutoBackupDirectory,
  chooseVideoCaptureDirectory,
  exportBackup,
  getFolderSizeBytes,
  importBackup,
  pickImportFile,
  resetAllData
} from './settings.js'
import {
  getAutoBackupPrefs,
  getVideoCapturePrefs,
  updateAutoBackupPrefs,
  updateVideoCapturePrefs
} from './preferences.js'

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
  ipcMain.handle('settings:export', () => exportBackup())
  ipcMain.handle('settings:pick-import-file', () => pickImportFile())
  ipcMain.handle('settings:import', (_event, filePath) => importBackup(filePath))
  ipcMain.handle('settings:reset', () => resetAllData())
  ipcMain.handle('settings:get-auto-backup', () => getAutoBackupPrefs())
  ipcMain.handle('settings:update-auto-backup', (_event, patch) => updateAutoBackupPrefs(patch))
  ipcMain.handle('settings:choose-auto-backup-directory', () => chooseAutoBackupDirectory())
  ipcMain.handle('settings:get-app-data-path', () => getDbPath())
  ipcMain.handle('settings:get-video-capture', () => getVideoCapturePrefs())
  ipcMain.handle('settings:update-video-capture', (_event, patch) => updateVideoCapturePrefs(patch))
  ipcMain.handle('settings:choose-video-capture-directory', () => chooseVideoCaptureDirectory())
  ipcMain.handle('settings:get-folder-size', (_event, directory) => getFolderSizeBytes(directory))

  // One-way (send/on, not invoke/handle) since these are fire-and-forget UI
  // sync events, not requests with a return value.
  ipcMain.on('play:show', () => showPlayView())
  ipcMain.on('play:hide', () => hidePlayView())
  ipcMain.on('play:set-bounds', (_event, rect) => setPlayBounds(rect))
}
