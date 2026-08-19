import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { app, protocol } from 'electron'

export const CARD_ART_FULL_PROTOCOL = 'statbound-card-art-full'

// Must run at module load, before app.whenReady() resolves -- same
// constraint cardArtProtocol.js's/legendArtProtocol.js's own
// registerSchemesAsPrivileged() calls document. bypassCSP: true is kept
// for consistency with those, but (per their own comments) isn't what
// actually exempts a load from this document's CSP -- index.html's own
// img-src allowlist entry for this scheme is what does that.
protocol.registerSchemesAsPrivileged([
  {
    scheme: CARD_ART_FULL_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      corsEnabled: true
    }
  }
])

function cardArtFullCacheDir() {
  return path.join(app.getPath('userData'), 'cardArtFull')
}

// Resolves a statbound-card-art-full:// URL down to an absolute path and
// rejects anything that doesn't land inside the full-card cache directory
// -- same path.resolve() containment pattern as cardArtProtocol.js's/
// legendArtProtocol.js's/replayProtocol.js's own resolvers, even though
// every URL this module itself builds (see cardArtFullFileUrl() below) is
// always exactly <sha1-hash>.png, never anything derived directly from
// user input. Scoped to its own cardArtFull/ directory, distinct from both
// legendArt/ and cardArt/, so this protocol can never serve (or be
// confused with) either of those caches' files.
function resolveCardArtFullFilePath(requestUrl) {
  const { pathname } = new URL(requestUrl)
  const relative = decodeURIComponent(pathname.replace(/^\/+/, ''))

  const resolvedDir = path.resolve(cardArtFullCacheDir())
  const resolved = path.resolve(resolvedDir, relative)
  if (resolved !== resolvedDir && !resolved.startsWith(resolvedDir + path.sep)) return null

  return resolved
}

/**
 * Builds the statbound-card-art-full:// URL an <img> element can load for
 * one cached, full-resolution card image -- the only way CardLightbox.jsx
 * ever reaches one, no raw file:// or data: URLs (the latter blocked by
 * CSP).
 */
export function cardArtFullFileUrl(filePath) {
  const relative = path.relative(cardArtFullCacheDir(), filePath)
  return `${CARD_ART_FULL_PROTOCOL}://local/${encodeURIComponent(relative)}`
}

/**
 * Registers the protocol.handle() itself -- must run after app.whenReady().
 * Cached files are small, immutable once written, and never need
 * range-request streaming the way replay video does, so this is a plain
 * whole-file response, same as cardArtProtocol.js's/legendArtProtocol.js's
 * own handlers.
 */
export function registerCardArtFullProtocol() {
  protocol.handle(CARD_ART_FULL_PROTOCOL, (request) => {
    const filePath = resolveCardArtFullFilePath(request.url)
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
