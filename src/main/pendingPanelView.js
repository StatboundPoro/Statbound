import path from 'path'
import { fileURLToPath } from 'url'
import { WebContentsView } from 'electron'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RENDERER_DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']

// The Pending Recordings popover's own dedicated WebContentsView, layered
// on top of the Play tab's embedded browser (see playView.js). That embed
// is a native view that always paints above ordinary page content
// regardless of CSS z-index, so a popover living in the main window's own
// DOM (a plain React portal, which is how this used to work) can never
// render above it — the only way to genuinely float above it is a second
// native surface. This view's bounds are kept pixel-accurate to the
// popover's actual rendered size (see reportPendingPanelSize, driven by a
// ResizeObserver in PendingPanelWindow.jsx) rather than a fixed guess, so
// there's no dead space swallowing clicks meant for the embed underneath,
// and the embed's own bounds are never touched — it never resizes or
// reflows just because this popover opened.
let mainWindow = null
let view = null
let attached = false
let ready = false
let pendingState = null
let anchor = null
let lastFootprintBounds = null
let expanded = false

export function initPendingPanelView(win) {
  mainWindow = win
}

function ensureView() {
  if (view) return view

  view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // Transparent so only the popover's own painted content (its panel
  // background, border, shadow) shows — see PendingPanelWindow.jsx, which
  // also forces its document's own html/body background transparent,
  // since this view-level setting alone isn't enough: the page's own CSS
  // (html, body { background: var(--bg) }) would otherwise paint an
  // opaque rectangle right back over it. This is a method on the View
  // itself, not view.webContents — WebContentsView.setBackgroundColor()
  // is the API added specifically so a view can be transparent without
  // requiring the whole host window to be transparent.
  view.setBackgroundColor('#00000000')

  view.webContents.on('did-finish-load', () => {
    ready = true
    if (pendingState) view.webContents.send('pending-panel:state', pendingState)
  })

  view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[pending panel] failed to load', validatedURL, errorCode, errorDescription)
  })

  const load = RENDERER_DEV_SERVER_URL
    ? view.webContents.loadURL(`${RENDERER_DEV_SERVER_URL}?view=pending-panel`)
    : view.webContents.loadFile(path.join(__dirname, '../renderer/index.html'), {
        query: { view: 'pending-panel' }
      })
  load.catch((err) => console.error('[pending panel] load() rejected', err))

  return view
}

/**
 * Pushes the popover's open/closed state, anchor point, and content down
 * to the overlay view. `anchor` is `{ left, bottom }` in the main window's
 * own content coordinate space (the same space play:set-bounds already
 * uses) — the popover's top-left corner is derived from it once the
 * overlay reports its real rendered size (see reportPendingPanelSize).
 */
export function syncPendingPanel({ open, anchor: nextAnchor, replays, fading }) {
  if (!mainWindow) return
  pendingState = { replays, fading }

  if (!open) {
    hidePendingPanel()
    return
  }

  anchor = nextAnchor ?? anchor
  ensureView()
  if (!attached) {
    mainWindow.contentView.addChildView(view)
    attached = true
  }
  if (ready) view.webContents.send('pending-panel:state', pendingState)
  if (lastFootprintBounds && !expanded) view.setBounds(lastFootprintBounds)
}

export function hidePendingPanel() {
  if (!mainWindow || !view || !attached) return
  mainWindow.contentView.removeChildView(view)
  attached = false
  expanded = false
}

/**
 * Called by playView.js after it attaches itself, so that opening the Play
 * tab while the popover already happens to be open (from another screen)
 * doesn't bury the popover beneath the freshly (re)attached embed — later
 * additions to a window's contentView stack on top.
 */
export function bringPendingPanelToFront() {
  if (!mainWindow || !view || !attached) return
  mainWindow.contentView.removeChildView(view)
  mainWindow.contentView.addChildView(view)
}

export function reportPendingPanelSize({ width, height }) {
  if (!anchor) return
  const bounds = {
    x: Math.round(anchor.left),
    y: Math.round(anchor.bottom - height),
    width: Math.max(0, Math.round(width)),
    height: Math.max(0, Math.round(height))
  }
  lastFootprintBounds = bounds
  if (attached && !expanded) view.setBounds(bounds)
}

// Temporarily grows the view to the whole window's content area so the
// discard-confirmation dialog (a normal full-screen ConfirmDialog, same as
// everywhere else in the app) isn't clipped to the popover's own small
// footprint. Safe to do without any interference concern of its own: this
// only happens while the user is actively confirming a destructive action,
// the same moment any other modal in the app would also take over the
// screen.
export function expandPendingPanel() {
  if (!mainWindow || !view || !attached) return
  expanded = true
  const { width, height } = mainWindow.getContentBounds()
  view.setBounds({ x: 0, y: 0, width, height })
}

export function collapsePendingPanel() {
  if (!view || !attached) return
  expanded = false
  if (lastFootprintBounds) view.setBounds(lastFootprintBounds)
}

export function relayLogMatch(replay) {
  mainWindow?.webContents.send('pending-panel:log-match', replay)
}

export function relayMouseEnter() {
  mainWindow?.webContents.send('pending-panel:mouse-enter')
}

export function relayChanged() {
  mainWindow?.webContents.send('pending-panel:changed')
}
