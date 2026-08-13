import { WebContentsView } from 'electron'
import { attachAutoCapture } from './autoCapture.js'
import { bringPendingPanelToFront } from './pendingPanelView.js'

const PLAY_URL = 'https://play.riftatlas.com'

let mainWindow = null
let playView = null
let attached = false

/**
 * Remembers the main window so the Play embed can be attached to it later.
 * Deliberately does NOT create the WebContentsView or load play.riftatlas.com
 * here — that only happens the first time the user actually opens the Play
 * tab (see ensurePlayView), so the app makes zero requests to any third
 * party until the user has explicitly asked for this embed.
 */
export function initPlayView(win) {
  mainWindow = win
}

function ensurePlayView() {
  if (playView) return playView

  // A plain, isolated browsing context — no preload script, so it has no
  // access to window.api or anything else in this app. This is a straight
  // embed: no network/WebSocket interception, no debugger attachment, no
  // reading of the page's data. It should behave exactly like play.riftatlas.com
  // opened in a normal browser tab.
  playView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // Chromium treats an attached-but-secondary WebContentsView as
  // "backgrounded" (throttled timers/animations, document.visibilityState
  // stuck on 'hidden') purely because it isn't the window's primary
  // content view — even though it's fully visible on screen. Rift Atlas's
  // own loading sequence stalls forever under that throttling, so it must
  // be disabled for this embed specifically.
  playView.webContents.setBackgroundThrottling(false)

  playView.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[play embed] failed to load', validatedURL, errorCode, errorDescription)
  })

  // Attached once, right here at creation, so it covers the view's whole
  // lifetime — the view is only ever detached/reattached after this (see
  // hidePlayView/showPlayView below), never destroyed and recreated. See
  // autoCapture.js for exactly what this does and does not read.
  attachAutoCapture(playView.webContents)

  playView.webContents.loadURL(PLAY_URL)
  return playView
}

export function showPlayView() {
  if (!mainWindow) return
  const view = ensurePlayView()
  if (!attached) {
    mainWindow.contentView.addChildView(view)
    attached = true
  }
  // If the Pending Recordings popover was already open on another screen,
  // re-attaching this embed on top of it would otherwise bury it — see
  // pendingPanelView.js's bringPendingPanelToFront for why.
  bringPendingPanelToFront()
}

// Detaches (but does not destroy) the view, so its WebContents — and
// whatever login/session state the user has on play.riftatlas.com — stays
// alive in memory across navigating away from and back to the Play tab.
export function hidePlayView() {
  if (!mainWindow || !playView || !attached) return
  mainWindow.contentView.removeChildView(playView)
  attached = false
}

export function setPlayBounds(rect) {
  if (!playView || !rect) return
  playView.setBounds({
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height))
  })
}
