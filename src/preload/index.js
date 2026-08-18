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
  legendArt: {
    // Resolves a deck's own Legend name to a cached, cropped portrait
    // avatar as a statbound-legend-art:// URL, or null if unavailable for
    // any reason (no network, no Riftcodex match, download/crop failure)
    // -- the renderer (see DeckAvatar.jsx) treats null as "render the
    // existing crest instead," never as an error. Main does the
    // fetch/crop/disk-cache work entirely itself
    // (src/main/legendArtCache.js), serving the result through its own
    // scoped protocol (src/main/legendArtProtocol.js) rather than a data:
    // URL -- the app's CSP has no data: allowance, so a data: URL <img>
    // renders as a broken image; bypassCSP: true on this privileged scheme
    // is what actually works, the same mechanism replays.getByMatch's
    // statbound-replay:// protocol already relies on for video.
    getUrl: (legendName) => ipcRenderer.invoke('legend-art:get-url', legendName)
  },
  insights: {
    get: (params) => ipcRenderer.invoke('insights:get', params)
  },
  matchupMatrix: {
    get: () => ipcRenderer.invoke('matchup-matrix:get')
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
  welcomeTour: {
    getSeen: () => ipcRenderer.invoke('welcome-tour:get-seen'),
    markSeen: () => ipcRenderer.invoke('welcome-tour:mark-seen')
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
      }),
    // The Play tab's own deck picker (see PlayScreen.jsx) — persisted
    // across restarts via preferences.js, unlike show/hide/setBounds
    // above these go through invoke/handle since the renderer needs the
    // persisted value back, not just to fire a one-way UI sync event.
    getSelectedDeck: () => ipcRenderer.invoke('play:get-selected-deck'),
    setSelectedDeck: (deckId) => ipcRenderer.invoke('play:set-selected-deck', deckId),
    // Back/Forward/Reload/Return-to-Lobby controls for the Play tab's
    // header (see src/main/playView.js). getNavState() is a one-time fetch
    // for initial button state on mount; onNavStateChanged pushes updates
    // whenever the embed actually navigates, same shape as
    // capture.onAutoStart/onAutoStop below. reload() is a plain refresh of
    // whatever's currently showing, distinct from returnToLobby() below
    // (which always navigates back to the base URL) — always enabled, no
    // conditions, same direct trust level as goBack/goForward.
    getNavState: () => ipcRenderer.invoke('play:get-nav-state'),
    goBack: () => ipcRenderer.send('play:go-back'),
    goForward: () => ipcRenderer.send('play:go-forward'),
    reload: () => ipcRenderer.send('play:reload'),
    returnToLobby: () => ipcRenderer.send('play:return-to-lobby'),
    onNavStateChanged: (callback) => {
      const handler = (_event, state) => callback(state)
      ipcRenderer.on('play:nav-state-changed', handler)
      return () => ipcRenderer.removeListener('play:nav-state-changed', handler)
    }
  },
  capture: {
    // Video is captured and encoded entirely in the main process (frame-
    // grab + ffmpeg, see src/main/capture.js) — no audio capture of any
    // kind (removed after it turned out to capture whole-system audio
    // rather than just this app, with no way to scope it narrower).
    start: () => ipcRenderer.invoke('capture:start'),
    stop: () => ipcRenderer.invoke('capture:stop'),
    // One-way — tells autoCapture.js's state machine a manually-started
    // recording is now active, so it can be associated with a match
    // session already seen (see src/main/autoCapture.js's
    // handleManualStart). Never sent for auto-started recordings, which
    // main already knows about by definition.
    notifyManualStart: () => ipcRenderer.send('capture:manual-start'),
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
    // The unified "Log Recent Match" queue — both file-backed recordings
    // and in-memory not-recorded sessions, see src/main/replays.js.
    listPending: () => ipcRenderer.invoke('replays:list-pending'),
    // `item` is a full entry from listPending() above, not a bare path —
    // see src/main/replays.js's discardPendingReplay() for why.
    discardPending: (item) => ipcRenderer.invoke('replays:discard-pending', item),
    create: (replay) => ipcRenderer.invoke('replays:create', replay),
    getByMatch: (matchId) => ipcRenderer.invoke('replays:get-by-match', matchId),
    // Pushed by autoCapture.js when a session with no recording finishes
    // and lands on the queue — there's no capture:auto-stop for this case
    // (nothing was ever recording), so this is what tells the renderer to
    // refetch and pop the Sidebar's notification open. Same shape as
    // capture.onAutoStart/onAutoStop below.
    onPendingQueueChanged: (callback) => {
      const handler = () => callback()
      ipcRenderer.on('replays:pending-queue-changed', handler)
      return () => ipcRenderer.removeListener('replays:pending-queue-changed', handler)
    }
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
  },
  // Check-only auto-update (see src/main/services/updateCheck.js) — a
  // throttled, once-daily check against GitHub Releases with no
  // auto-download or auto-install of any kind. getStatus() is Sidebar's
  // one-time fetch on mount; onStatusChanged pushes an update if the
  // startup check (already in flight before any window exists) completes
  // afterward, same shape as capture.onAutoStart/onAutoStop above.
  // openReleasePage() takes no argument — main always opens whatever URL
  // it already found itself, never one passed in from the renderer.
  // checkNow() is Settings' manual "Check for Updates" button — bypasses
  // the 24h throttle and returns its outcome directly (unlike the passive
  // getStatus()/onStatusChanged() pair) so the button can show immediate
  // inline feedback.
  updates: {
    getStatus: () => ipcRenderer.invoke('updates:get-status'),
    openReleasePage: () => ipcRenderer.send('updates:open-release-page'),
    checkNow: () => ipcRenderer.invoke('updates:check-now'),
    onStatusChanged: (callback) => {
      const handler = (_event, status) => callback(status)
      ipcRenderer.on('updates:status-changed', handler)
      return () => ipcRenderer.removeListener('updates:status-changed', handler)
    }
  }
})
