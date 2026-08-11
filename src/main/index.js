import path from 'path'
import { fileURLToPath } from 'url'
import { app, BrowserWindow } from 'electron'
import { getDb } from './db.js'
import { registerIpcHandlers } from './ipc.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Vite injects this env var only when `electron-vite dev` is running the
// renderer as a live dev server. In a production build it's undefined, and
// we load the built index.html file from disk instead.
const RENDERER_DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  if (RENDERER_DEV_SERVER_URL) {
    win.loadURL(RENDERER_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Open the database and make sure tables exist before any window can
  // ask for data.
  getDb()
  registerIpcHandlers()

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
