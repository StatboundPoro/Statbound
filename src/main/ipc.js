import { ipcMain } from 'electron'
import { getDbPath } from './db.js'
import { createDeck, deleteDeck, getDeckById, listDecks, updateDeck } from './decks.js'
import { createMatch, deleteMatch, getMatchById, listMatches, updateMatch } from './matches.js'
import { createDeckNote, deleteDeckNote, listDeckNotesByDeck, updateDeckNote } from './deckNotes.js'
import { listDeckChangelogByDeck } from './deckChangelog.js'
import { listLegends } from './legends.js'
import { getLegendArtCachePath } from './legendArtCache.js'
import { legendArtFileUrl } from './legendArtProtocol.js'
import { getInsights } from './insights.js'
import { getMatchupMatrix } from './matchupMatrix.js'
import {
  getPlayNavState,
  hidePlayView,
  playGoBack,
  playGoForward,
  playReload,
  playReturnToLobby,
  setPlayBounds,
  showPlayView
} from './playView.js'
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
  getHasSeenWelcomeTour,
  getPlayPrefs,
  getVideoCapturePrefs,
  markWelcomeTourSeen,
  resetVideoCaptureDirectory,
  updateAutoBackupPrefs,
  updatePlayPrefs,
  updateVideoCapturePrefs
} from './preferences.js'
import { startRecording, stopRecording } from './capture.js'
import { createReplay, discardPendingReplay, getReplayByMatchId, listPendingReplays, listUnlinkedReplays } from './replays.js'
import { replayFileUrl } from './replayProtocol.js'
import { checkForUpdateNow, getUpdateStatus, openReleasePage } from './services/updateCheck.js'

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
  // Per-edit decklist diff history, most recent edit first -- see
  // deckChangelog.js. Rows are written as a side effect of decks:update
  // (never decks:create), so this handler is read-only.
  ipcMain.handle('deck-changelog:list', (_event, deckId) => listDeckChangelogByDeck(deckId))
  ipcMain.handle('legends:list', () => listLegends())
  // Returns a statbound-legend-art:// URL for the deck's Legend's cached,
  // cropped portrait avatar, or null if unavailable for any reason -- see
  // legendArtCache.js and legendArtProtocol.js.
  ipcMain.handle('legend-art:get-url', async (_event, legendName) => {
    const filePath = await getLegendArtCachePath(legendName)
    return filePath ? legendArtFileUrl(filePath) : null
  })
  ipcMain.handle('insights:get', (_event, params) => getInsights(params ?? {}))
  ipcMain.handle('matchup-matrix:get', () => getMatchupMatrix())
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
  ipcMain.handle('welcome-tour:get-seen', () => getHasSeenWelcomeTour())
  ipcMain.handle('welcome-tour:mark-seen', () => markWelcomeTourSeen())
  ipcMain.handle('capture:start', () => startRecording())
  ipcMain.handle('capture:stop', () => stopRecording())
  ipcMain.handle('replays:list-unlinked', () => listUnlinkedReplays())
  ipcMain.handle('replays:list-pending', () => listPendingReplays())
  // `item` is a full entry from listPendingReplays() (not a bare path) —
  // discardPendingReplay() branches on its hasRecording flag to know
  // whether to delete a file or just drop an in-memory session.
  ipcMain.handle('replays:discard-pending', (_event, item) => discardPendingReplay(item))
  ipcMain.handle('replays:create', (_event, replay) => createReplay(replay))
  ipcMain.handle('replays:get-by-match', (_event, matchId) => {
    const replay = getReplayByMatchId(matchId)
    return replay ? { ...replay, url: replayFileUrl(replay.file_path) } : null
  })
  // The Play tab's deck picker (see PlayScreen.jsx) — persisted so the
  // selection survives a restart, and read directly by autoCapture.js
  // (not over IPC) at the moment a new match session starts, to snapshot
  // which deck it should be tagged with.
  ipcMain.handle('play:get-selected-deck', () => getPlayPrefs().lastSelectedPlayDeckId)
  ipcMain.handle('play:set-selected-deck', (_event, deckId) => updatePlayPrefs({ lastSelectedPlayDeckId: deckId ?? null }).lastSelectedPlayDeckId)

  // One-way (send/on, not invoke/handle) since these are fire-and-forget UI
  // sync events, not requests with a return value.
  ipcMain.on('play:show', () => showPlayView())
  ipcMain.on('play:hide', () => hidePlayView())
  ipcMain.on('play:set-bounds', (_event, rect) => setPlayBounds(rect))
  // Back/Forward/Reload/Return-to-Lobby controls for the Play tab's header —
  // see playView.js for the navigationHistory-based implementation and the
  // window-open interception these controls exist alongside.
  ipcMain.handle('play:get-nav-state', () => getPlayNavState())
  ipcMain.on('play:go-back', () => playGoBack())
  ipcMain.on('play:go-forward', () => playGoForward())
  ipcMain.on('play:reload', () => playReload())
  ipcMain.on('play:return-to-lobby', () => playReturnToLobby())
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
  // Check-only auto-update (see services/updateCheck.js) — getStatus() is
  // the Sidebar badge's one-time fetch on mount (it also gets pushed
  // updates:status-changed once the startup check completes, see
  // index.js); open-release-page is fire-and-forget since it just calls
  // shell.openExternal() with no return value; check-now is Settings'
  // manual "Check for Updates" button, which bypasses the 24h throttle
  // and needs the outcome back to show inline feedback.
  ipcMain.handle('updates:get-status', () => getUpdateStatus())
  ipcMain.on('updates:open-release-page', () => openReleasePage())
  ipcMain.handle('updates:check-now', () => checkForUpdateNow())
}
