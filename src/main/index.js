import path from 'path'
import { fileURLToPath } from 'url'
import { app, BrowserWindow, Menu } from 'electron'
import { getDb, migrateLegacyDbFilename } from './db.js'
import { migrateLegacyUserData, migrateLegacyPreferencePaths } from './userDataMigration.js'
import { registerIpcHandlers } from './ipc.js'
import { initPlayView } from './playView.js'
import { initPendingPanelView } from './pendingPanelView.js'
import { initAutoBackup } from './autoBackup.js'
import { initAutoCapture } from './autoCapture.js'
import { initReplayCleanup } from './replayCleanup.js'
import { cleanupLegacyTempDir, recoverOrphanedRecordings } from './capture.js'
import { initEventLoopWatchdog } from './services/eventLoopWatchdog.js'
import { initUpdateCheck, checkForUpdateIfDue } from './services/updateCheck.js'
// Imported (not just called) before app.whenReady() below — its module
// body registers the statbound-replay:// scheme as privileged, which
// Electron only honors when done before the app is ready.
import { registerReplayProtocol } from './replayProtocol.js'
// Same reasoning as registerReplayProtocol above -- its module body
// registers the statbound-legend-art:// scheme as privileged before the
// app is ready.
import { registerLegendArtProtocol } from './legendArtProtocol.js'
// Same reasoning again -- its module body registers the
// statbound-card-art:// scheme (Deck Detail's Grid view card art) as
// privileged before the app is ready.
import { registerCardArtProtocol } from './cardArtProtocol.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Vite injects this env var only when `electron-vite dev` is running the
// renderer as a live dev server. In a production build it's undefined, and
// we load the built index.html file from disk instead.
const RENDERER_DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']

function createMainWindow() {
  const win = new BrowserWindow({
    // The size the window restores to if the user un-maximizes it — not
    // the on-launch size. We always launch maximized (below) so the app
    // fills whatever screen it's on rather than assuming every display is
    // 1080p; 1920x1080 is just a sane default to land on if they later
    // click restore-down.
    width: 1920,
    height: 1080,
    show: false,
    // Only matters in dev / an unpacked run — a packaged build gets its
    // icon baked in by electron-builder (see package.json's "build" field)
    // instead. Without this, dev shows the generic Electron icon in the
    // taskbar rather than Statbound's.
    icon: path.join(__dirname, '../../build/icons/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // Maximize before the first paint so there's no visible flash of a
  // smaller window snapping to full size.
  win.once('ready-to-show', () => {
    win.maximize()
    win.show()
  })

  // Menu.setApplicationMenu(null) below removes the default menu bar, which
  // also silently takes Electron's default DevTools toggle with it (that
  // accelerator is normally supplied by the default menu, not a standalone
  // global shortcut) -- so without this, there's no way to open DevTools at
  // all. F12 and Ctrl/Cmd+Shift+I are wired directly to the window instead.
  win.webContents.on('before-input-event', (_event, input) => {
    const isDevToolsShortcut =
      input.type === 'keyDown' &&
      (input.key === 'F12' ||
        (input.key.toUpperCase() === 'I' && input.shift && (input.control || input.meta)))
    if (isDevToolsShortcut) win.webContents.toggleDevTools()
  })

  if (RENDERER_DEV_SERVER_URL) {
    win.loadURL(RENDERER_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(async () => {
  // No File/Edit/View/Window/Help bar — this app has no menu-driven
  // actions (no keyboard-shortcut-only features, nothing that needs a
  // native menu), so Electron's default application menu would only add
  // unused chrome above the app's own UI.
  Menu.setApplicationMenu(null)

  // Must run before getDb() below — see userDataMigration.js for why and
  // what it does.
  migrateLegacyUserData()
  // Must run after migrateLegacyUserData() above (preferences.json has to
  // already be copied into the new folder) — fixes up stale RiftTrack-era
  // absolute paths left inside it. See userDataMigration.js for the two
  // cases this handles.
  migrateLegacyPreferencePaths()
  // Also must run before getDb() below — see db.js's migrateLegacyDbFilename()
  // for why (renaming after the database is opened risks orphaning WAL/SHM
  // sidecar files under the old name).
  migrateLegacyDbFilename()

  // Open the database and make sure tables exist before any window can
  // ask for data.
  getDb()
  registerIpcHandlers()
  initAutoBackup()
  initReplayCleanup()
  cleanupLegacyTempDir()
  // Must run before createMainWindow()/initAutoCapture() below — see
  // recoverOrphanedRecordings()'s own comment for why that ordering is
  // what makes every file it finds unambiguous.
  await recoverOrphanedRecordings()
  registerReplayProtocol()
  registerLegendArtProtocol()
  registerCardArtProtocol()
  initEventLoopWatchdog()

  const win = createMainWindow()
  initPlayView(win)
  initPendingPanelView(win)
  initAutoCapture(win)
  initUpdateCheck(win)
  // Fire-and-forget, same non-blocking pattern as the Legend registry sync
  // in db.js -- a slow or failed GitHub check can never delay startup.
  // Called once here (not from the activate handler below), since it's an
  // app-launch-scoped check, not something that needs repeating per window.
  checkForUpdateIfDue().catch((err) => console.error('Unexpected error checking for updates:', err))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const nextWin = createMainWindow()
      initPlayView(nextWin)
      initPendingPanelView(nextWin)
      initAutoCapture(nextWin)
      initUpdateCheck(nextWin)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
