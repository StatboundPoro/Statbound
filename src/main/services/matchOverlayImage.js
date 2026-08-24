import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { app, BrowserWindow } from 'electron'

// The badge's fixed pixel footprint. Grown from an initial 480x172 (wide,
// short) to a 260x350 narrow/tall panel once "<mine> vs <theirs>" on one
// line proved too narrow to fit a real long battlefield name, then widened
// to 380x400 once Bo3 started pairing each played game's two battlefields
// back onto one such line — but going wider a second time to fix the same
// class of problem traded away this panel's whole reason for being narrow
// in the first place, for clarity/consistency with the rest of the app's
// compact corner-annotation treatments. **380 was a dead end, not a
// destination**: width is capped back at 260 (this panel's own prior
// narrow value, and the ceiling it must never exceed again) permanently
// now, with the actual fix moved to content instead — see
// videoOverlayBurn.js's formatBattlefieldPair(), which breaks the line
// right after "vs" rather than needing the panel itself to widen every
// time a pair is long. `.stat-value`'s `white-space: pre-line` (below)
// renders that literal line break. Height grew instead, to 440, to fit a
// full 3-game Bo3 (each game now two content lines — "<mine> vs" then
// "<theirs>" — under its own "Game N:" label, up to 3 of those plus the
// header, result, and Score rows) with real slack even if a line still
// wraps a second time via overflow-wrap. Still reads as a bounded corner
// annotation rather than covering meaningful game content on a typical
// ~1920x1080 recording (see capture.js's MAX_RECORDING_HEIGHT).
// videoOverlayBurn.js positions this exact image at the bottom-right
// corner of the source video via ffmpeg's own overlay expressions
// (main_w-overlay_w-32:main_h-overlay_h-32), so this module never needs to
// know the source video's actual resolution. The box stays this same
// fixed size regardless of how much content actually renders (a
// header-only badge, or fewer stat blocks) — see buildOverlayHtml's own
// note on why content is top-anchored rather than vertically centered.
const OVERLAY_WIDTH = 260
const OVERLAY_HEIGHT = 440

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
 * Builds the badge's self-contained HTML document — a header (the deck's
 * own cached Legend art thumbnail, omitted entirely if unavailable rather
 * than a placeholder; deck name; "vs <opponent legend>", omitted if there's
 * no opponent legend), a WIN/LOSS result line of its own below that, then
 * `battlefieldBlocks` (already fully resolved by videoOverlayBurn.js's
 * resolveBattlefieldBlocks() — this function has no Bo1/Bo3 awareness of
 * its own, it just renders whatever ordered `{ label, value }` list it's
 * given) plus a trailing **Score** block, all below a divider. Any block
 * is simply omitted when its data isn't available — graceful degradation,
 * not a blank gap — and the divider/stats block disappears entirely if
 * there's nothing to show at all, leaving just the header.
 *
 * `.stat-value` sets `white-space: pre-line` so a literal `\n` inside a
 * value (videoOverlayBurn.js's formatBattlefieldPair() puts one right
 * after "vs", splitting "<mine> vs" and "<theirs>" onto their own lines
 * without needing this panel to widen for it) renders as a real line
 * break rather than collapsing into a space the way plain text normally
 * would. `overflow-wrap: break-word` (no `nowrap`/ellipsis) stays on top
 * of that as a defensive backstop for either resulting line individually —
 * even a single battlefield name longer than this panel's width wraps to
 * a second line instead of ever being cut off. See OVERLAY_WIDTH's own
 * comment for the real truncation bug this panel has been resized around
 * more than once now.
 *
 * The WIN/LOSS color is the app's own established win/loss pair —
 * `--calm`/`--fury` in styles.css, the exact same values `.result-badge`,
 * `.recent-row .result`, `.match-history-result`, and every other real
 * result indicator in this app already use — not the deliberately
 * DIFFERENT pair `--changelog-added`/`--changelog-removed` uses (see
 * CLAUDE.md's Deck Changelog entry: that pair exists specifically so a
 * changelog entry can't be visually mistaken for a match result: this
 * panel has no such adjacent concept to avoid confusion with, and
 * genuinely IS a win/loss indicator, so it reuses the real pair directly).
 * All colors here are literal hex copies of styles.css's `:root` values —
 * this renders completely outside the renderer's own CSS cascade, so
 * there's no `var(--x)` to inherit from.
 */
function buildOverlayHtml({ deckName, legendArtDataUri, opponentLegend, result, battlefieldBlocks, scoreLine }) {
  const resultLabel = result === 'win' ? 'WIN' : result === 'loss' ? 'LOSS' : null
  const resultColor = result === 'win' ? '#4c9e68' : result === 'loss' ? '#d6483f' : '#ece9e2'

  const statBlocks = [...battlefieldBlocks]
  if (scoreLine) statBlocks.push({ label: 'Score', value: scoreLine })

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
  display: flex; flex-direction: column; justify-content: flex-start;
  gap: 10px;
  padding: 20px;
  background: rgba(27, 30, 35, 0.94);
  border: 2px solid ${resultColor};
  border-radius: 14px;
  font-family: 'Overlay Body', sans-serif;
  color: #ece9e2;
}
.header { display: flex; align-items: center; gap: 12px; }
.avatar {
  width: 48px; height: 48px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid rgba(236, 233, 226, 0.2);
  background: #101216;
}
.identity { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 4px; }
.deck-name {
  font-family: 'Overlay Display', sans-serif;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-size: 17px;
  line-height: 1.15;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.opponent-line {
  font-size: 12px;
  color: rgba(236, 233, 226, 0.65);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.result-row { text-align: right; }
.result-label {
  font-family: 'Overlay Display', sans-serif;
  font-weight: 700;
  font-size: 24px;
  letter-spacing: 1px;
  line-height: 1;
  color: ${resultColor};
}
.divider { height: 1px; background: rgba(236, 233, 226, 0.14); }
.stats { display: flex; flex-direction: column; gap: 12px; }
.stat-block { display: flex; flex-direction: column; gap: 3px; }
.stat-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: rgba(236, 233, 226, 0.5);
}
.stat-value {
  font-family: 'Overlay Mono', monospace;
  font-size: 14px;
  line-height: 1.25;
  color: #ece9e2;
  white-space: pre-line;
  overflow-wrap: break-word;
  word-break: break-word;
}
</style>
</head>
<body>
  <div class="badge">
    <div class="header">
      ${legendArtDataUri ? `<img class="avatar" src="${legendArtDataUri}" />` : ''}
      <div class="identity">
        <div class="deck-name">${escapeHtml(deckName)}</div>
        ${opponentLegend ? `<div class="opponent-line">vs ${escapeHtml(opponentLegend)}</div>` : ''}
      </div>
    </div>
    ${resultLabel ? `<div class="result-row"><span class="result-label">${resultLabel}</span></div>` : ''}
    ${
      statBlocks.length > 0
        ? `<div class="divider"></div>
    <div class="stats">
      ${statBlocks
        .map(
          (block) =>
            `<div class="stat-block"><div class="stat-label">${escapeHtml(block.label)}</div><div class="stat-value">${escapeHtml(block.value)}</div></div>`
        )
        .join('\n      ')}
    </div>`
        : ''
    }
  </div>
</body>
</html>`
}

/**
 * Renders one match's overlay badge to a PNG buffer (transparent outside
 * the rounded panel) via a hidden, offscreen BrowserWindow — the same
 * render-HTML/SVG-then-capturePage() approach this project's app icon work
 * already established for turning markup into a raster image, just done at
 * burn-in time instead of build time. `legendArtPath`, `opponentLegend`,
 * and `result` may all individually be null, and `battlefieldBlocks` may be
 * an empty array (see videoOverlayBurn.js's own "usable data" gate for when
 * this whole function is skipped entirely, and its
 * resolveBattlefieldBlocks()/resolveScoreLine() for how battlefield/score
 * content is derived) — each is simply omitted from the rendered badge
 * rather than shown as a placeholder or leaving a blank gap.
 *
 * The window is created purely to rasterize static, self-contained markup —
 * it never touches app data or the network directly (everything it needs is
 * already resolved and inlined as base64 by the caller/this function before
 * the window ever loads), so it runs with the same hardened webPreferences
 * as every other window/view in this app.
 */
export async function renderMatchOverlayPng({
  deckName,
  legendArtPath,
  opponentLegend,
  result,
  battlefieldBlocks,
  scoreLine
}) {
  const legendArtDataUri = legendArtPath ? imageDataUri(legendArtPath) : null
  const html = buildOverlayHtml({
    deckName,
    legendArtDataUri,
    opponentLegend,
    result,
    battlefieldBlocks,
    scoreLine
  })

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
