import { contextBridge, ipcRenderer } from 'electron'

// The renderer (React/Chromium) runs with contextIsolation on and
// nodeIntegration off, so it has no access to Node.js or Electron APIs at
// all — it can't `require('better-sqlite3')`, read files, or touch the
// database file directly, even though everything runs on one machine.
//
// This script is the one narrow, explicit gap in that wall. It runs in a
// privileged context that *can* reach Electron's ipcRenderer, and it
// exposes a small, whitelisted `window.api` object into the renderer via
// contextBridge. The renderer can only ever call the functions listed
// here — it has no way to send arbitrary IPC messages or reach anything
// else in this file's scope.
contextBridge.exposeInMainWorld('api', {
  decks: {
    list: () => ipcRenderer.invoke('decks:list'),
    get: (id) => ipcRenderer.invoke('decks:get', id),
    create: (deck) => ipcRenderer.invoke('decks:create', deck),
    update: (id, deck) => ipcRenderer.invoke('decks:update', id, deck),
    delete: (id) => ipcRenderer.invoke('decks:delete', id)
  },
  matches: {
    list: () => ipcRenderer.invoke('matches:list'),
    get: (id) => ipcRenderer.invoke('matches:get', id),
    create: (match) => ipcRenderer.invoke('matches:create', match),
    update: (id, match) => ipcRenderer.invoke('matches:update', id, match),
    delete: (id) => ipcRenderer.invoke('matches:delete', id)
  },
  deckNotes: {
    list: (deckId) => ipcRenderer.invoke('deck-notes:list', deckId),
    create: (note) => ipcRenderer.invoke('deck-notes:create', note),
    update: (id, patch) => ipcRenderer.invoke('deck-notes:update', id, patch),
    delete: (id) => ipcRenderer.invoke('deck-notes:delete', id)
  },
  settings: {
    export: () => ipcRenderer.invoke('settings:export'),
    pickImportFile: () => ipcRenderer.invoke('settings:pick-import-file'),
    import: (filePath) => ipcRenderer.invoke('settings:import', filePath),
    reset: () => ipcRenderer.invoke('settings:reset'),
    getAutoBackup: () => ipcRenderer.invoke('settings:get-auto-backup'),
    updateAutoBackup: (patch) => ipcRenderer.invoke('settings:update-auto-backup', patch),
    chooseAutoBackupDirectory: () => ipcRenderer.invoke('settings:choose-auto-backup-directory'),
    getAppDataPath: () => ipcRenderer.invoke('settings:get-app-data-path'),
    getVideoCapture: () => ipcRenderer.invoke('settings:get-video-capture'),
    updateVideoCapture: (patch) => ipcRenderer.invoke('settings:update-video-capture', patch),
    chooseVideoCaptureDirectory: () => ipcRenderer.invoke('settings:choose-video-capture-directory'),
    getFolderSize: (directory) => ipcRenderer.invoke('settings:get-folder-size', directory)
  },
  play: {
    show: () => ipcRenderer.send('play:show'),
    hide: () => ipcRenderer.send('play:hide'),
    // Only plain numbers cross this bridge, not a live DOMRect instance —
    // DOMRect doesn't structured-clone cleanly over Electron IPC.
    setBounds: (rect) =>
      ipcRenderer.send('play:set-bounds', {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      })
  }
})
