import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { protocol, net } from 'electron'
import { getVideoCapturePrefs } from './preferences.js'

export const REPLAY_PROTOCOL = 'rifttrack-replay'

// Must run at module load, before app.whenReady() resolves — Electron only
// honors registerSchemesAsPrivileged() calls made before the app is ready.
// index.js imports this module ahead of app.whenReady(), which is enough
// to guarantee that ordering since ES module bodies run synchronously at
// import time.
protocol.registerSchemesAsPrivileged([
  {
    scheme: REPLAY_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      // Without this, fetch()/XHR against this scheme from the renderer's
      // file:// (or dev-server) origin is blocked by CORS even for a
      // legitimate file — plain resource loads like <video src> aren't
      // subject to that check, but anything using fetch() is.
      corsEnabled: true
    }
  }
])

// Resolves a rifttrack-replay:// URL down to an absolute path and rejects
// anything that doesn't land inside the *currently configured* Video
// Capture folder — including any ../ segments — so this protocol can never
// be used to read an arbitrary file off disk. path.resolve() collapses ..
// segments before the containment check runs, so this holds regardless of
// how the URL was built, not just for the specific URL shape this file
// happens to construct in replayFileUrl() below.
function resolveReplayFilePath(requestUrl) {
  const { directory } = getVideoCapturePrefs()
  if (!directory) return null

  const { pathname } = new URL(requestUrl)
  const relative = decodeURIComponent(pathname.replace(/^\/+/, ''))

  const resolvedDir = path.resolve(directory)
  const resolved = path.resolve(resolvedDir, relative)
  if (resolved !== resolvedDir && !resolved.startsWith(resolvedDir + path.sep)) return null

  return resolved
}

/**
 * Builds the rifttrack-replay:// URL a <video> element can load for a given
 * replay file — the only way ReplayPlayer.jsx ever reaches a recording, no
 * raw file:// URLs from the renderer. `file_path` is stored as an absolute
 * path in the `replays` table; this re-expresses it relative to the
 * current Video Capture folder purely so the URL doesn't leak the full
 * on-disk path into the renderer (resolveReplayFilePath() re-resolves and
 * validates it back to absolute on every request regardless).
 */
export function replayFileUrl(filePath) {
  const { directory } = getVideoCapturePrefs()
  const relative = path.relative(directory, filePath)
  return `${REPLAY_PROTOCOL}://local/${encodeURIComponent(relative)}`
}

/**
 * Registers the protocol.handle() itself — must run after app.whenReady(),
 * unlike registerSchemesAsPrivileged() above. Serves the resolved file via
 * net.fetch() on a file:// URL, forwarding the original request's headers
 * so Range requests (needed for <video> seeking) reach the file fetch.
 */
export function registerReplayProtocol() {
  protocol.handle(REPLAY_PROTOCOL, (request) => {
    const filePath = resolveReplayFilePath(request.url)
    // net.fetch() on a missing file:// URL rejects rather than resolving to
    // a 404 Response, which would otherwise surface to the renderer as an
    // unhandled fetch error instead of a clean "not found" — checked here
    // so a linked replay whose file was moved/deleted outside the app
    // fails gracefully instead of erroring.
    if (!filePath || !fs.existsSync(filePath)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(filePath).toString(), { headers: request.headers })
  })
}
