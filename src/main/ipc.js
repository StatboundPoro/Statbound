import { ipcMain } from 'electron'
import { getDbPath } from './db.js'
import { createDeck, deleteDeck, getDeckById, listDecks, updateDeck } from './decks.js'
import { createMatch, deleteMatch, getMatchById, listMatches, updateMatch } from './matches.js'
import { createDeckNote, deleteDeckNote, listDeckNotesByDeck, updateDeckNote } from './deckNotes.js'
import { listLegends } from './legends.js'
import { getInsights } from './insights.js'
import { hidePlayView, setPlayBounds, showPlayView } from './playView.js'
import { handleManualStart } from './autoCapture.js'
import {
  collapsePendingPanel,
  expandPendingPanel,
  relayChanged,
  relayLogMatch,
  relayMouseEnter,
  reportPendingPanelSize,
  syncPendingPanel
} from './pendingPanelView.js'
import {
  chooseAutoBackupDirectory,
  chooseVideoCaptureDirectory,
  exportBackup,
  getFolderSizeBytes,
  importBackup,
  openAppDataFolder,
  openFolder,
  pickImportFile,
  resetAllData
} from './settings.js'
import {
  getAutoBackupPrefs,
  getVideoCapturePrefs,
  resetVideoCaptureDirectory,
  updateAutoBackupPrefs,
  updateVideoCapturePrefs
} from './preferences.js'
import { startRecording, stopRecording } from './capture.js'
import { createReplay, discardPendingReplay, getReplayByMatchId, listPendingReplays, listUnlinkedReplays } from './replays.js'
import { replayFileUrl } from './replayProtocol.js'

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
  ipcMain.handle('legends:list', () => listLegends())
  ipcMain.handle('insights:get', (_event, params) => getInsights(params ?? {}))
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
  ipcMain.handle('settings:reset-video-capture-directory', () => resetVideoCaptureDirectory())
  ipcMain.handle('settings:get-folder-size', (_event, directory) => getFolderSizeBytes(directory))
  ipcMain.handle('settings:open-folder', (_event, directory) => openFolder(directory))
  ipcMain.handle('settings:open-app-data-folder', () => openAppDataFolder())
  ipcMain.handle('capture:start', () => startRecording())
  ipcMain.handle('capture:stop', () => stopRecording())
  ipcMain.handle('replays:list-unlinked', () => listUnlinkedReplays())
  ipcMain.handle('replays:list-pending', () => listPendingReplays())
  ipcMain.handle('replays:discard-pending', (_event, filePath) => discardPendingReplay(filePath))
  ipcMain.handle('replays:create', (_event, replay) => createReplay(replay))
  ipcMain.handle('replays:get-by-match', (_event, matchId) => {
    const replay = getReplayByMatchId(matchId)
    return replay ? { ...replay, url: replayFileUrl(replay.file_path) } : null
  })

  // One-way (send/on, not invoke/handle) since these are fire-and-forget UI
  // sync events, not requests with a return value.
  ipcMain.on('play:show', () => showPlayView())
  ipcMain.on('play:hide', () => hidePlayView())
  ipcMain.on('play:set-bounds', (_event, rect) => setPlayBounds(rect))
  // Fired once a manually-started recording has actually begun, so
  // autoCapture.js's state machine can associate it with a match session
  // it already knows about (join_game seen while autoStartRecording was
  // off) — see handleManualStart in autoCapture.js.
  ipcMain.on('capture:manual-start', () => handleManualStart())
  // Pending Recordings popover — see pendingPanelView.js. Sidebar.jsx
  // (main window) pushes open/anchor/content state down; the popover's
  // own overlay view reports its rendered size back and relays a few
  // user actions (Log Match, hover) up through main to the main window,
  // since it's a separate WebContents with no direct access to the main
  // renderer's own state.
  ipcMain.on('pending-panel:sync', (_event, state) => syncPendingPanel(state))
  ipcMain.on('pending-panel:report-size', (_event, size) => reportPendingPanelSize(size))
  ipcMain.on('pending-panel:expand', () => expandPendingPanel())
  ipcMain.on('pending-panel:collapse', () => collapsePendingPanel())
  ipcMain.on('pending-panel:log-match', (_event, replay) => relayLogMatch(replay))
  ipcMain.on('pending-panel:mouse-enter', () => relayMouseEnter())
  ipcMain.on('pending-panel:changed', () => relayChanged())
}
