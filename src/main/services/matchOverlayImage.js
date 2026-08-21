import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { app, BrowserWindow } from 'electron'

// The badge's fixed pixel footprint — deliberately small relative to a
// typical ~1920x1080 recording (see capture.js's MAX_RECORDING_HEIGHT), so
// it reads as a corner annotation rather than covering meaningful game
// content. videoOverlayBurn.js positions this exact image at the bottom-right
// corner of the source video via ffmpeg's own overlay expressions
// (main_w-overlay_w-32:main_h-overlay_h-32), so this module never needs to
// know the source video's actual resolution.
const OVERLAY_WIDTH = 440
const OVERLAY_HEIGHT = 92

// Real, self-hosted app fonts rather than a system-font approximation — the
// same three families this app already ships (see main.jsx's @fontsource
// imports and CLAUDE.md's Design Language entry), read straight off disk and
// inlined as base64 so the generated HTML is a single self-contained file
// with no external requests. Only the 700 weight, latin subset of each is
// needed for a small badge with no localized text. app.getAppPath() resolves
// correctly both in dev (the project root) and packaged (the app.asar path,
// which Node's fs transparently reads through) — @fontsource packages are
// listed in package.json's real "dependencies", not devDependencies, so
// they're genuinely present in a packaged build, not just the renderer's own
// built output.
function fontDataUri(pkg, fileName) {
  const filePath = path.join(app.getAppPath(), 'node_modules', '@fontsource', pkg, 'files', fileName)
  const base64 = fs.readFileSync(filePath).toString('base64')
  return `data:font/woff2;base64,${base64}`
}

function imageDataUri(filePath) {
  const base64 = fs.readFileSync(filePath).toString('base64')
  return `data:image/png;base64,${base64}`
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char])
}

/**
 * Builds the badge's self-contained HTML document — one flex row: the
 * deck's own cached Legend art thumbnail (omitted entirely if unavailable,
 * rather than a placeholder), deck name plus "vs <opponent legend>" (omitted
 * if there's no opponent legend), and a right-aligned result column (a
 * WIN/LOSS label in the same red/green this app already uses for match
 * results everywhere else, plus the Bo3 series score when there is one).
 * Colors are the exact hex values from styles.css's `:root` (--panel,
 * --border, --text, --fury, --calm) — this is rendered completely outside
 * the renderer's own CSS cascade, so there's no `var(--x)` to inherit from;
 * matching the app's design language means copying the literal values here.
 */
function buildOverlayHtml({ deckName, legendArtDataUri, opponentLegend, result, score, format }) {
  const resultLabel = result === 'win' ? 'WIN' : result === 'loss' ? 'LOSS' : null
  const resultColor = result === 'win' ? '#4c9e68' : result === 'loss' ? '#d6483f' : '#ece9e2'
  // A Bo1 always has a definitive result by the time it's saved (see
  // matches.js's validateMatchInput — at least one decided game is
  // required), so its score line would just be a redundant "1-0"/"0-1".
  // Bo3 always shows its series score; the one case a Bo1 could ever lack
  // resultLabel is unreachable, but showing the score as a fallback for any
  // future undecided-result shape costs nothing.
  const showScore = format === 'Bo3' || !resultLabel

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
@font-face { font-family: 'Overlay Display'; font-weight: 700; src: url(${fontDataUri('big-shoulders-display', 'big-shoulders-display-latin-700-normal.woff2')}) format('woff2'); }
@font-face { font-family: 'Overlay Body'; font-weight: 700; src: url(${fontDataUri('inter', 'inter-latin-700-normal.woff2')}) format('woff2'); }
@font-face { font-family: 'Overlay Mono'; font-weight: 700; src: url(${fontDataUri('ibm-plex-mono', 'ibm-plex-mono-latin-700-normal.woff2')}) format('woff2'); }
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0;
  width: ${OVERLAY_WIDTH}px; height: ${OVERLAY_HEIGHT}px;
  background: transparent;
  overflow: hidden;
}
.badge {
  width: 100%; height: 100%;
  display: flex; align-items: center; gap: 14px;
  padding: 0 18px;
  background: rgba(27, 30, 35, 0.94);
  border: 2px solid ${resultColor};
  border-radius: 12px;
  font-family: 'Overlay Body', sans-serif;
  color: #ece9e2;
}
.avatar {
  width: 56px; height: 56px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid rgba(236, 233, 226, 0.2);
  background: #101216;
}
.info { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 4px; }
.deck-name {
  font-family: 'Overlay Display', sans-serif;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-size: 19px;
  line-height: 1;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.opponent-line {
  font-size: 12px;
  color: rgba(236, 233, 226, 0.65);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.result { flex-shrink: 0; text-align: right; }
.result-label {
  font-family: 'Overlay Display', sans-serif;
  font-weight: 700;
  font-size: 24px;
  letter-spacing: 1px;
  line-height: 1;
  color: ${resultColor};
}
.result-score {
  font-family: 'Overlay Mono', monospace;
  font-size: 13px;
  color: #ece9e2;
  opacity: 0.85;
  margin-top: 4px;
}
</style>
</head>
<body>
  <div class="badge">
    ${legendArtDataUri ? `<img class="avatar" src="${legendArtDataUri}" />` : ''}
    <div class="info">
      <div class="deck-name">${escapeHtml(deckName)}</div>
      ${opponentLegend ? `<div class="opponent-line">vs ${escapeHtml(opponentLegend)}</div>` : ''}
    </div>
    <div class="result">
      ${resultLabel ? `<div class="result-label">${resultLabel}</div>` : ''}
      ${showScore ? `<div class="result-score">${escapeHtml(score)}</div>` : ''}
    </div>
  </div>
</body>
</html>`
}

/**
 * Renders one match's overlay badge to a PNG buffer (transparent outside
 * the rounded panel) via a hidden, offscreen BrowserWindow — the same
 * render-HTML/SVG-then-capturePage() approach this project's app icon work
 * already established for turning markup into a raster image, just done at
 * burn-in time instead of build time. `legendArtPath`, `opponentLegend`, and
 * `result` may all individually be null (see videoOverlayBurn.js's own
 * "usable data" gate for when this is skipped entirely) — each is simply
 * omitted from the rendered badge rather than shown as a placeholder.
 *
 * The window is created purely to rasterize static, self-contained markup —
 * it never touches app data or the network directly (everything it needs is
 * already resolved and inlined as base64 by the caller/this function before
 * the window ever loads), so it runs with the same hardened webPreferences
 * as every other window/view in this app.
 */
export async function renderMatchOverlayPng({ deckName, legendArtPath, opponentLegend, result, score, format }) {
  const legendArtDataUri = legendArtPath ? imageDataUri(legendArtPath) : null
  const html = buildOverlayHtml({ deckName, legendArtDataUri, opponentLegend, result, score, format })

  const tempHtmlPath = path.join(app.getPath('temp'), `statbound-overlay-${randomUUID()}.html`)
  fs.writeFileSync(tempHtmlPath, html, 'utf-8')

  let win = null
  try {
    win = new BrowserWindow({
      width: OVERLAY_WIDTH,
      height: OVERLAY_HEIGHT,
      useContentSize: true,
      show: false,
      frame: false,
      resizable: false,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Same gotcha capture.js's own Play tab embed already documents:
        // Chromium throttles a window it considers backgrounded (which a
        // permanently show:false window always is) unless this is turned
        // off, which can stall a page's render/font-load indefinitely.
        backgroundThrottling: false
      }
    })

    await win.loadFile(tempHtmlPath)
    // Waits for the three inlined @font-face declarations above to actually
    // finish rasterizing before the capture below — without this,
    // capturePage() can fire while the page is still showing its fallback
    // system font, silently shipping a badge in the wrong typeface.
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')

    const image = await win.webContents.capturePage()
    return image.toPNG()
  } finally {
    if (win && !win.isDestroyed()) win.destroy()
    try {
      fs.rmSync(tempHtmlPath)
    } catch (err) {
      console.error('[match overlay] failed to remove temp overlay HTML', tempHtmlPath, err)
    }
  }
}
