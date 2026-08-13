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
  legends: {
    list: () => ipcRenderer.invoke('legends:list')
  },
  insights: {
    get: (params) => ipcRenderer.invoke('insights:get', params)
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
    resetVideoCaptureDirectory: () => ipcRenderer.invoke('settings:reset-video-capture-directory'),
    getFolderSize: (directory) => ipcRenderer.invoke('settings:get-folder-size', directory),
    openFolder: (directory) => ipcRenderer.invoke('settings:open-folder', directory),
    openAppDataFolder: () => ipcRenderer.invoke('settings:open-app-data-folder')
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
  },
  capture: {
    getSourceId: () => ipcRenderer.invoke('capture:get-source-id'),
    start: () => ipcRenderer.invoke('capture:start'),
    stop: () => ipcRenderer.invoke('capture:stop'),
    // One-way — a steady inbound stream of recorded chunks, not a request/
    // response pair. `chunk` is a Uint8Array, which structured-clones over
    // Electron IPC without any special handling.
    sendChunk: (chunk) => ipcRenderer.send('capture:chunk', chunk),
    // Main pushes these when autoCapture.js's WebSocket-driven state
    // machine decides a match has started/ended (see src/main/
    // autoCapture.js) — the only two channels in this bridge that go
    // main-to-renderer rather than the other way around. Each returns an
    // unsubscribe function, the same shape a DOM addEventListener wrapper
    // would use, so the caller's cleanup effect has something to call.
    onAutoStart: (callback) => {
      const handler = () => callback()
      ipcRenderer.on('capture:auto-start', handler)
      return () => ipcRenderer.removeListener('capture:auto-start', handler)
    },
    onAutoStop: (callback) => {
      const handler = () => callback()
      ipcRenderer.on('capture:auto-stop', handler)
      return () => ipcRenderer.removeListener('capture:auto-stop', handler)
    }
  },
  replays: {
    listUnlinked: () => ipcRenderer.invoke('replays:list-unlinked'),
    listPending: () => ipcRenderer.invoke('replays:list-pending'),
    discardPending: (filePath) => ipcRenderer.invoke('replays:discard-pending', filePath),
    create: (replay) => ipcRenderer.invoke('replays:create', replay),
    getByMatch: (matchId) => ipcRenderer.invoke('replays:get-by-match', matchId)
  },
  // The Pending Recordings popover's overlay surface — see
  // src/main/pendingPanelView.js for why it's a second WebContentsView
  // rather than a plain DOM portal. Used from both sides: Sidebar.jsx
  // (main window) calls sync() to push open/anchor/content state down;
  // the popover's own standalone renderer (PendingPanelWindow.jsx) calls
  // reportSize()/expand()/collapse() and the notify*() relays, and
  // listens via the on*() subscriptions for state pushed back to it.
  pendingPanel: {
    sync: (state) => ipcRenderer.send('pending-panel:sync', state),
    reportSize: (size) => ipcRenderer.send('pending-panel:report-size', size),
    expand: () => ipcRenderer.send('pending-panel:expand'),
    collapse: () => ipcRenderer.send('pending-panel:collapse'),
    notifyLogMatch: (replay) => ipcRenderer.send('pending-panel:log-match', replay),
    notifyMouseEnter: () => ipcRenderer.send('pending-panel:mouse-enter'),
    notifyChanged: () => ipcRenderer.send('pending-panel:changed'),
    onState: (callback) => {
      const handler = (_event, state) => callback(state)
      ipcRenderer.on('pending-panel:state', handler)
      return () => ipcRenderer.removeListener('pending-panel:state', handler)
    },
    onLogMatch: (callback) => {
      const handler = (_event, replay) => callback(replay)
      ipcRenderer.on('pending-panel:log-match', handler)
      return () => ipcRenderer.removeListener('pending-panel:log-match', handler)
    },
    onMouseEnter: (callback) => {
      const handler = () => callback()
      ipcRenderer.on('pending-panel:mouse-enter', handler)
      return () => ipcRenderer.removeListener('pending-panel:mouse-enter', handler)
    },
    onChanged: (callback) => {
      const handler = () => callback()
      ipcRenderer.on('pending-panel:changed', handler)
      return () => ipcRenderer.removeListener('pending-panel:changed', handler)
    }
  }
})
