import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { app, protocol } from 'electron'

export const LEGEND_ART_PROTOCOL = 'statbound-legend-art'

// Must run at module load, before app.whenReady() resolves -- same
// constraint documented on replayProtocol.js's own
// registerSchemesAsPrivileged() call. bypassCSP: true is required here for
// a reason specific to this feature: the app's CSP
// (src/renderer/index.html, `default-src 'self'`, no `data:` allowance)
// silently blocks a plain `data:` URL <img src> -- confirmed the hard way,
// this module replaces an earlier version of legendArtCache.js that handed
// back a data: URL directly and rendered as a broken-image icon everywhere
// under this CSP. bypassCSP: true is what actually exempts requests to a
// privileged custom scheme from that policy, the same mechanism
// replayProtocol.js already relies on for video.
protocol.registerSchemesAsPrivileged([
  {
    scheme: LEGEND_ART_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      corsEnabled: true
    }
  }
])

function legendArtCacheDir() {
  return path.join(app.getPath('userData'), 'legendArt')
}

// Resolves a statbound-legend-art:// URL down to an absolute path and
// rejects anything that doesn't land inside the legend art cache directory
// -- same path.resolve() containment pattern as replayProtocol.js's
// resolveReplayFilePath(), even though in practice every URL this module
// itself builds (see legendArtFileUrl() below) is always exactly
// <sha1-hash>.png, never anything derived directly from user input.
function resolveLegendArtFilePath(requestUrl) {
  const { pathname } = new URL(requestUrl)
  const relative = decodeURIComponent(pathname.replace(/^\/+/, ''))

  const resolvedDir = path.resolve(legendArtCacheDir())
  const resolved = path.resolve(resolvedDir, relative)
  if (resolved !== resolvedDir && !resolved.startsWith(resolvedDir + path.sep)) return null

  return resolved
}

/**
 * Builds the statbound-legend-art:// URL an <img> element can load for a
 * cached avatar file -- the only way DeckAvatar.jsx ever reaches one, no
 * raw file:// URLs and no data: URLs (blocked by CSP, see above).
 */
export function legendArtFileUrl(filePath) {
  const relative = path.relative(legendArtCacheDir(), filePath)
  return `${LEGEND_ART_PROTOCOL}://local/${encodeURIComponent(relative)}`
}

/**
 * Registers the protocol.handle() itself -- must run after app.whenReady().
 * Cached avatar files are small, immutable once written, and never need
 * range-request streaming the way replay video does, so this is a plain
 * whole-file response rather than replayProtocol.js's Range-aware one.
 */
export function registerLegendArtProtocol() {
  protocol.handle(LEGEND_ART_PROTOCOL, (request) => {
    const filePath = resolveLegendArtFilePath(request.url)
    // A cache entry that's gone missing (e.g. deleted by hand) resolves to
    // a clean 404 rather than an unhandled fetch error reaching the
    // renderer -- DeckAvatar.jsx never sees this case anyway (it only
    // builds a URL once getLegendArtCachePath() confirms the file exists),
    // but a stale <img> reference to one that was deleted afterward should
    // still fail gracefully.
    if (!filePath || !fs.existsSync(filePath)) return new Response('Not found', { status: 404 })

    const { size } = fs.statSync(filePath)
    return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(size)
      }
    })
  })
}
