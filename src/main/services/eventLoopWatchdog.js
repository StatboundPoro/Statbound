import path from 'path'
import fs from 'fs'
import { app } from 'electron'

// Purely diagnostic, entirely silent: no UI surface, no user-facing setting,
// nothing ever transmitted anywhere. See CLAUDE.md's Current State entry for
// the full rationale (relevant given ffmpeg encoding runs in-process during
// recording).
const CHECK_INTERVAL_MS = 2000
const LAG_THRESHOLD_MS = 250
const LOG_COOLDOWN_MS = 30 * 1000
const MAX_LOG_SIZE_BYTES = 1024 * 1024

let lastLogAt = 0

function logPath() {
  return path.join(app.getPath('userData'), 'diagnostics.log')
}

function truncateIfOversized(filePath) {
  try {
    const { size } = fs.statSync(filePath)
    if (size > MAX_LOG_SIZE_BYTES) {
      fs.writeFileSync(filePath, '')
    }
  } catch {
    // File doesn't exist yet — nothing to truncate.
  }
}

function recordLag(lagMs) {
  const now = Date.now()
  if (now - lastLogAt < LOG_COOLDOWN_MS) return
  lastLogAt = now

  const filePath = logPath()
  truncateIfOversized(filePath)
  const line = `${new Date().toISOString()} lag=${Math.round(lagMs)}ms\n`
  try {
    fs.appendFileSync(filePath, line)
  } catch (err) {
    console.error('[event loop watchdog] failed to write diagnostics.log:', err)
  }
}

function scheduleNextCheck(lastCheckAt) {
  setTimeout(() => {
    const now = Date.now()
    const elapsed = now - lastCheckAt
    const lag = elapsed - CHECK_INTERVAL_MS
    if (lag > LAG_THRESHOLD_MS) {
      recordLag(lag)
    }
    scheduleNextCheck(now)
  }, CHECK_INTERVAL_MS)
}

/**
 * Starts the event loop watchdog. Safe to call once at app startup. Measures
 * drift against actual elapsed time (each check reschedules itself only once
 * it completes) rather than nominal setInterval timing, so the measurement
 * reflects real event loop lag rather than timer imprecision.
 */
export function initEventLoopWatchdog() {
  scheduleNextCheck(Date.now())
}
