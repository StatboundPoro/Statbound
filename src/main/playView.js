import { WebContentsView } from 'electron'
import { attachAutoCapture } from './autoCapture.js'
import { bringPendingPanelToFront } from './pendingPanelView.js'

const PLAY_URL = 'https://play.riftatlas.com'

// Far enough outside any real window that it can never overlap on-screen
// content, however large the user's display is.
const OFFSCREEN_X = -100000
const OFFSCREEN_Y = -100000

let mainWindow = null
let playView = null
let visible = false
let lastRealBounds = null

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
  // embed: no network/WebSocket interception, no debugger attachment beyond
  // attachAutoCapture below, no reading of the page's data. It should
  // behave exactly like play.riftatlas.com opened in a normal browser tab.
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

  // Added to the window once and never removed — see hidePlayView() below
  // for why "hiding" now means moving the view off-screen rather than
  // detaching it from the window's contentView.
  if (mainWindow) {
    mainWindow.contentView.addChildView(playView)
    // Covers the case where the Pending Recordings popover was already
    // open (from before the Play tab was ever opened this session) — its
    // own view was attached first and would otherwise get buried under
    // this freshly-added one.
    bringPendingPanelToFront()
  }

  return playView
}

export function showPlayView() {
  if (!mainWindow) return
  ensurePlayView()
  visible = true
  if (lastRealBounds) playView.setBounds(lastRealBounds)
  // If the popover was opened while this embed was hidden, re-showing the
  // embed doesn't change stacking order any more (it's never re-added to
  // the tree) — but this stays cheap and harmless to call regardless.
  bringPendingPanelToFront()
}

// Moves the view off-screen instead of detaching it from the window, unlike
// the original implementation. It deliberately stays part of the window's
// composited layer tree (and keeps its last real width/height, just at an
// off-screen position) rather than being removed — the frame-grab recording
// engine (see capture.js) calls webContents.capturePage() on this same view,
// and a WebContentsView that's been removed from its window isn't
// guaranteed to still have a live compositor surface to capture a frame
// from. A recording (manual or auto-detected) can keep running for as long
// as the app is open regardless of which screen the user is on — see
// CLAUDE.md's Replay Recording entry — so this view has to keep genuinely
// rendering even while the user has navigated away from the Play tab
// mid-match, not just keep its WebContents alive in the background the way
// login/session state survival alone would require.
export function hidePlayView() {
  if (!mainWindow || !playView || !visible) return
  visible = false
  const { width, height } = lastRealBounds ?? { width: 1, height: 1 }
  playView.setBounds({ x: OFFSCREEN_X, y: OFFSCREEN_Y, width, height })
}

export function setPlayBounds(rect) {
  if (!playView || !rect) return
  const bounds = {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height))
  }
  lastRealBounds = bounds
  if (visible) playView.setBounds(bounds)
}

/**
 * The Play tab's own WebContents, for capture.js's frame-grab loop to call
 * capturePage() on — the same reference this module already uses
 * internally, not a second one. Returns null before the Play tab has ever
 * been opened; in practice a recording can never be triggered before that
 * point anyway, since both the manual Start button (on the Play screen
 * itself) and auto-detection (whose debugger is only attached once this
 * view exists, see attachAutoCapture above) require it to already exist.
 */
export function getPlayWebContents() {
  return playView ? playView.webContents : null
}
