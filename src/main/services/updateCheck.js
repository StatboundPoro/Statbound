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
 * Throttled, best-effort check against GitHub Releases, called once at
 * startup (see index.js). Skips the network call entirely if the last
 * check was under 24h ago, per preferences.json's lastUpdateCheckAt.
 * Wrapped entirely in try/catch -- a network failure, rate limit, missing
 * release, or malformed response all resolve to "no update found this
 * session" rather than throwing or blocking startup, the same contract
 * services/legendSync.js's fetch already follows. lastUpdateCheckAt is
 * only updated after a fetch actually succeeds, so a transient failure
 * gets retried on the very next launch rather than silently postponing the
 * next real attempt by a full day. If a genuinely newer version is found,
 * pushes updates:status-changed to the renderer so the Sidebar badge can
 * appear immediately rather than waiting for some unrelated refetch.
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

    const release = await fetchLatestRelease()
    const tag = typeof release?.tag_name === 'string' ? release.tag_name : null
    const version = tag ? tag.replace(/^v/, '') : null
    const url = typeof release?.html_url === 'string' ? release.html_url : null
    if (!version || !url) return

    updateUpdateCheckPrefs({ lastUpdateCheckAt: new Date().toISOString() })

    if (isNewerVersion(version, app.getVersion())) {
      updateStatus = { available: true, version, url }
      mainWindow?.webContents.send('updates:status-changed', getUpdateStatus())
    }
  } catch (err) {
    console.error('GitHub release check failed:', err)
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
