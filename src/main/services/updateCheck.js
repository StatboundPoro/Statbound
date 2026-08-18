import { app, shell } from 'electron'
import { getUpdateCheckPrefs, updateUpdateCheckPrefs } from '../preferences.js'

// Throttled, check-only auto-update: a plain, unauthenticated GET against
// GitHub's public Releases API for this repo, entirely to power a passive
// Sidebar badge telling the user a newer version exists. Outbound-only and
// read-only, fetches nothing but this project's own public release
// metadata, and never transmits anything about the user, their decks, or
// their matches -- the same "outbound-only, disclosed, no user data"
// pattern already established by services/legendSync.js (see CLAUDE.md's
// Legends entry). Full silent auto-install (electron-updater,
// quitAndInstall()) was deliberately ruled out: Windows NSIS's
// auto-installer has long-standing bugs specific to unsigned, per-machine
// installs (silently-failing UAC prompts, updates triggered at quit
// leaving the app in a broken half-updated state) -- this module only ever
// tells the user a newer version exists and lets them download/run the
// installer themselves, exactly like they do today. Nothing here ever
// downloads or installs anything.
const RELEASES_URL = 'https://api.github.com/repos/StatboundPoro/Statbound/releases/latest'
const CHECK_THROTTLE_MS = 24 * 60 * 60 * 1000

let mainWindow = null
let updateStatus = { available: false, version: null, url: null }

export function initUpdateCheck(win) {
  mainWindow = win
}

/**
 * Current update status plus the running app's own version, for the
 * Sidebar badge/popover (updates:get-status). currentVersion is read
 * fresh from app.getVersion() (package.json's version field) on every
 * call rather than cached alongside updateStatus, since it can't change
 * within a running session anyway and this keeps the returned shape
 * self-contained for the renderer.
 */
export function getUpdateStatus() {
  return { ...updateStatus, currentVersion: app.getVersion() }
}

function parseVersionParts(version) {
  return version.split('.').map((part) => parseInt(part, 10) || 0)
}

/**
 * True if `candidate` is a newer version than `current`, compared
 * numerically component-by-component rather than as strings -- a naive
 * string compare breaks on a jump like "0.9.0" vs "0.10.0", where
 * "0.10.0" would incorrectly sort before "0.9.0".
 */
export function isNewerVersion(candidate, current) {
  const a = parseVersionParts(candidate)
  const b = parseVersionParts(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return false
}

async function fetchLatestRelease() {
  const response = await fetch(RELEASES_URL, {
    headers: { Accept: 'application/vnd.github+json' }
  })
  if (!response.ok) {
    throw new Error(`GitHub releases request failed: HTTP ${response.status}`)
  }
  return response.json()
}

/**
 * Does the actual fetch + version compare + state update, shared by both
 * checkForUpdateIfDue() (the throttled startup check) and
 * checkForUpdateNow() (an explicit user-triggered check that bypasses the
 * throttle) below -- the only difference between the two is whether the
 * 24h gate is consulted first. Throws on a network failure or a release
 * response missing tag_name/html_url, deliberately not swallowed here, so
 * checkForUpdateIfDue()'s try/catch can log-and-ignore it while
 * checkForUpdateNow() can report a real failure back to the Settings
 * button that triggered it. lastUpdateCheckAt only advances once a usable
 * version/url is actually parsed out, matching services/legendSync.js's
 * "only update the throttle timestamp on real success" contract -- a
 * malformed response is retried on the very next attempt (automatic or
 * manual) rather than being silently throttled for a full day. Always
 * resolves updateStatus one way or the other (found or not found), so a
 * later check correctly clears a previously-found update if the user
 * updates by some other means before the next automatic check would have
 * noticed. Pushes updates:status-changed to the renderer either way, so
 * the Settings screen and Sidebar badge both immediately reflect whatever
 * this check found.
 */
async function performCheck() {
  const release = await fetchLatestRelease()
  const tag = typeof release?.tag_name === 'string' ? release.tag_name : null
  const version = tag ? tag.replace(/^v/, '') : null
  const url = typeof release?.html_url === 'string' ? release.html_url : null
  if (!version || !url) {
    throw new Error('GitHub release response missing tag_name/html_url')
  }

  updateUpdateCheckPrefs({ lastUpdateCheckAt: new Date().toISOString() })
  updateStatus = isNewerVersion(version, app.getVersion())
    ? { available: true, version, url }
    : { available: false, version: null, url: null }
  mainWindow?.webContents.send('updates:status-changed', getUpdateStatus())
}

/**
 * Throttled, best-effort check against GitHub Releases, called once at
 * startup (see index.js). Skips the network call entirely if the last
 * check was under 24h ago, per preferences.json's lastUpdateCheckAt.
 * Wrapped entirely in try/catch -- a network failure, rate limit, missing
 * release, or malformed response all resolve to "no update found this
 * session" rather than throwing or blocking startup, the same contract
 * services/legendSync.js's fetch already follows.
 */
export async function checkForUpdateIfDue() {
  try {
    const { lastUpdateCheckAt } = getUpdateCheckPrefs()
    if (
      lastUpdateCheckAt &&
      Date.now() - new Date(lastUpdateCheckAt).getTime() < CHECK_THROTTLE_MS
    ) {
      return
    }

    await performCheck()
  } catch (err) {
    console.error('GitHub release check failed:', err)
  }
}

/**
 * Explicit, user-triggered check from Settings' "Check for Updates"
 * button -- always hits the network regardless of the 24h throttle (an
 * explicit click is exactly the case that throttle isn't meant to block),
 * but still advances lastUpdateCheckAt on success so the next automatic
 * startup check doesn't immediately re-fire right after. Unlike
 * checkForUpdateIfDue(), this returns its outcome directly rather than
 * only logging it, since a manual check needs inline feedback ("You're up
 * to date" / "Update found" / a failure message) rather than relying on
 * the passive badge alone.
 */
export async function checkForUpdateNow() {
  try {
    await performCheck()
    return { ok: true, status: getUpdateStatus() }
  } catch (err) {
    console.error('Manual GitHub release check failed:', err)
    return { ok: false, status: getUpdateStatus() }
  }
}

/**
 * Opens the found release's GitHub page in the user's default system
 * browser -- shell.openExternal(), never the Play tab's embedded view,
 * since this is a deliberate, explicit user action to go download
 * something, not app content. Deliberately reads the URL from this
 * module's own in-memory state rather than trusting an argument passed
 * over IPC, so the exposed channel can't be used to open an arbitrary
 * external URL.
 */
export function openReleasePage() {
  if (!updateStatus.url) return
  shell.openExternal(updateStatus.url)
}
