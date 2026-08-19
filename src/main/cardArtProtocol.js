import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { app, protocol } from 'electron'

export const CARD_ART_PROTOCOL = 'statbound-card-art'

// Must run at module load, before app.whenReady() resolves -- same
// constraint legendArtProtocol.js's own registerSchemesAsPrivileged() call
// documents. bypassCSP: true is kept for consistency with that module, but
// (as legendArtProtocol.js's own comment explains) isn't actually what
// exempts a load from this document's CSP -- index.html's own img-src
// allowlist entry for this scheme is what does that.
protocol.registerSchemesAsPrivileged([
  {
    scheme: CARD_ART_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      corsEnabled: true
    }
  }
])

function cardArtCacheDir() {
  return path.join(app.getPath('userData'), 'cardArt')
}

// Resolves a statbound-card-art:// URL down to an absolute path and rejects
// anything that doesn't land inside the card art cache directory -- same
// path.resolve() containment pattern as legendArtProtocol.js's/
// replayProtocol.js's own resolvers, even though every URL this module
// itself builds (see cardArtFileUrl() below) is always exactly
// <sha1-hash>.png, never anything derived directly from user input.
function resolveCardArtFilePath(requestUrl) {
  const { pathname } = new URL(requestUrl)
  const relative = decodeURIComponent(pathname.replace(/^\/+/, ''))

  const resolvedDir = path.resolve(cardArtCacheDir())
  const resolved = path.resolve(resolvedDir, relative)
  if (resolved !== resolvedDir && !resolved.startsWith(resolvedDir + path.sep)) return null

  return resolved
}

/**
 * Builds the statbound-card-art:// URL an <img> element can load for one
 * cached, cropped card art file -- the only way DecklistCardArt.jsx ever
 * reaches one, no raw file:// or data: URLs (the latter blocked by CSP).
 */
export function cardArtFileUrl(filePath) {
  const relative = path.relative(cardArtCacheDir(), filePath)
  return `${CARD_ART_PROTOCOL}://local/${encodeURIComponent(relative)}`
}

/**
 * Registers the protocol.handle() itself -- must run after app.whenReady().
 * Cached art files are small, immutable once written, and never need
 * range-request streaming the way replay video does, so this is a plain
 * whole-file response, same as legendArtProtocol.js's own handler.
 */
export function registerCardArtProtocol() {
  protocol.handle(CARD_ART_PROTOCOL, (request) => {
    const filePath = resolveCardArtFilePath(request.url)
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
