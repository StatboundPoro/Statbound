import path from 'path'
import { fileURLToPath } from 'url'
import { app, BrowserWindow, Menu } from 'electron'
import { getDb, migrateLegacyDbFilename } from './db.js'
import { migrateLegacyUserData } from './userDataMigration.js'
import { registerIpcHandlers } from './ipc.js'
import { initPlayView } from './playView.js'
import { initPendingPanelView } from './pendingPanelView.js'
import { initAutoBackup } from './autoBackup.js'
import { initAutoCapture } from './autoCapture.js'
import { initReplayCleanup } from './replayCleanup.js'
import { cleanupLegacyTempDir } from './capture.js'
// Imported (not just called) before app.whenReady() below — its module
// body registers the statbound-replay:// scheme as privileged, which
// Electron only honors when done before the app is ready.
import { registerReplayProtocol } from './replayProtocol.js'

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

  if (RENDERER_DEV_SERVER_URL) {
    win.loadURL(RENDERER_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  // No File/Edit/View/Window/Help bar — this app has no menu-driven
  // actions (no keyboard-shortcut-only features, nothing that needs a
  // native menu), so Electron's default application menu would only add
  // unused chrome above the app's own UI.
  Menu.setApplicationMenu(null)

  // Must run before getDb() below — see userDataMigration.js for why and
  // what it does.
  migrateLegacyUserData()
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
  registerReplayProtocol()

  const win = createMainWindow()
  initPlayView(win)
  initPendingPanelView(win)
  initAutoCapture(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const nextWin = createMainWindow()
      initPlayView(nextWin)
      initPendingPanelView(nextWin)
      initAutoCapture(nextWin)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
