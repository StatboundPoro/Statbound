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
    list: () => ipcRenderer.invoke('decks:list')
  },
  matches: {
    list: () => ipcRenderer.invoke('matches:list')
  }
})
