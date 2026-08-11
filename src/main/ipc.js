import { ipcMain } from 'electron'
import { listDecks } from './decks.js'

/**
 * Registers every ipcMain.handle() endpoint the renderer is allowed to call.
 * This is the entire surface area the UI has into the database — nothing
 * else is reachable from the renderer process. Each channel name is
 * namespaced as "<resource>:<action>" to keep things predictable as more
 * are added.
 */
export function registerIpcHandlers() {
  ipcMain.handle('decks:list', () => listDecks())
}
