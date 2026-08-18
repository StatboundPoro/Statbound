import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { protocol } from 'electron'
import { getVideoCapturePrefs } from './preferences.js'

export const REPLAY_PROTOCOL = 'statbound-replay'

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

// Resolves a statbound-replay:// URL down to an absolute path and rejects
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
 * Builds the statbound-replay:// URL a <video> element can load for a given
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
 * unlike registerSchemesAsPrivileged() above. Range requests are handled by
 * hand (parsing the `Range` header and streaming just that byte slice back
 * with a 206 + Content-Range) rather than delegating to net.fetch() on a
 * file:// URL — that used to be tried and forwarded the incoming request's
 * headers straight through, but Chromium's built-in file:// loader doesn't
 * reliably surface a 206/Content-Range back up through net.fetch() for a
 * custom protocol response, which left the <video> element unable to
 * determine seekable ranges: clicking the scrubber or pressing the arrow
 * keys silently did nothing. Explicit Accept-Ranges/Content-Range headers
 * here are what let Chromium's media pipeline know the resource is
 * seekable at all.
 */
export function registerReplayProtocol() {
  protocol.handle(REPLAY_PROTOCOL, (request) => {
    const filePath = resolveReplayFilePath(request.url)
    // A missing/moved file resolves to a clean 404 Response rather than an
    // unhandled fetch error reaching the renderer, so a linked replay whose
    // file disappeared outside the app fails gracefully instead of erroring.
    if (!filePath || !fs.existsSync(filePath)) return new Response('Not found', { status: 404 })

    const { size } = fs.statSync(filePath)
    const rangeHeader = request.headers.get('range')

    if (!rangeHeader) {
      return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(size),
          'Accept-Ranges': 'bytes'
        }
      })
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader)
    const start = match && match[1] ? Number(match[1]) : 0
    const end = match && match[2] ? Number(match[2]) : size - 1
    const isValidRange = match && Number.isFinite(start) && Number.isFinite(end) && start <= end && end < size

    if (!isValidRange) {
      return new Response('Range Not Satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` }
      })
    }

    return new Response(Readable.toWeb(fs.createReadStream(filePath, { start, end })), {
      status: 206,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes'
      }
    })
  })
}
