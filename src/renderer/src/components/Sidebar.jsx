import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import PendingRecordingsPanel from './PendingRecordingsPanel.jsx'

// How long an auto-shown notification (a recording just finished) stays
// fully visible before it starts fading, and the total time (including
// the fade) before it closes itself — separate from FADE_DURATION_MS
// below so the CSS transition and the JS timer that finalizes the close
// stay in sync.
const AUTO_DISMISS_DELAY_MS = 4000
const FADE_DURATION_MS = 1200

// Play, Decks, Matches, and Insights all have real screens, so they're
// clickable and their `key` doubles as the `screen` value App.jsx switches
// on. Settings stays in its own `rail-bottom` slot (gear icon, pinned below
// the main nav list) rather than joining NAV_ITEMS, since that's a
// deliberate, distinct part of the rail's layout, not an oversight.
const NAV_ITEMS = [
  {
    key: 'play',
    label: 'Play',
    navigable: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M7 4l12 8-12 8V4z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    )
  },
  {
    key: 'decks',
    label: 'Decks',
    navigable: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <rect x="13" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <rect x="13" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    )
  },
  {
    key: 'matches',
    label: 'Matches',
    navigable: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3 9h18" stroke="currentColor" strokeWidth="1.6" />
        <path d="M7 13h4M7 16h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  },
  {
    key: 'insights',
    label: 'Insights',
    navigable: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M4 12 Q4 4 12 4 Q20 4 20 12 Q20 20 12 20" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 8v4l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  }
]

export default function Sidebar({
  active,
  onNavigate,
  pendingReplays,
  onLogMatch,
  onDiscardPending,
  recordingStoppedSignal
}) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [fading, setFading] = useState(false)
  const pendingTriggerRef = useRef(null)
  const fadeTimerRef = useRef(null)
  const dismissTimerRef = useRef(null)
  const pendingCount = pendingReplays.length

  function clearAutoDismissTimers() {
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current)
      fadeTimerRef.current = null
    }
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
  }

  // The Pending Recordings popover is plain DOM content (rendered through
  // a portal — see below), but the Play tab's embedded browser is a
  // native WebContentsView, a separately-composited surface that always
  // paints above ordinary page content regardless of CSS z-index. The
  // only way for anything in this app to visually sit on top of it is to
  // detach it first — the same play:hide()/play:show() PlayScreen.jsx
  // already uses when navigating away from and back to the Play screen,
  // just triggered here instead. Only touches the embed while the user is
  // actually on the Play screen; elsewhere it's already hidden and this
  // is a no-op.
  function openPanel() {
    clearAutoDismissTimers()
    setFading(false)
    setPanelOpen(true)
    if (active === 'play') window.api.play.hide()
  }

  function closePanel() {
    clearAutoDismissTimers()
    setFading(false)
    setPanelOpen(false)
    if (active === 'play') window.api.play.show()
  }

  function togglePanel() {
    if (panelOpen) closePanel()
    else openPanel()
  }

  function cancelAutoDismiss() {
    clearAutoDismissTimers()
    setFading(false)
  }

  // Auto-popup: a recording finishing (manual Stop or auto-detected) pops
  // the queue open by itself as a self-dismissing notification, rather
  // than requiring a click to even notice it happened. Skips the initial
  // mount (the signal starts at 0 and only ever increments from a real
  // stop). Hovering the panel cancels the fade/dismiss — see the
  // onMouseEnter handler passed to PendingRecordingsPanel below — so
  // reading it doesn't race against it disappearing.
  useEffect(() => {
    if (recordingStoppedSignal === 0) return
    openPanel()
    fadeTimerRef.current = setTimeout(() => setFading(true), AUTO_DISMISS_DELAY_MS)
    dismissTimerRef.current = setTimeout(() => closePanel(), AUTO_DISMISS_DELAY_MS + FADE_DURATION_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingStoppedSignal])

  useEffect(() => clearAutoDismissTimers, [])

  return (
    <div className="rail">
      <div className="rail-mark">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M12 2 L21 7 L21 17 L12 22 L3 17 L3 7 Z" stroke="#ECE9E2" strokeWidth="1.4" />
          <path
            d="M12 2 V22 M3 7 L21 17 M21 7 L3 17"
            stroke="#ECE9E2"
            strokeWidth="1"
            opacity="0.35"
          />
        </svg>
      </div>

      <div className="rail-nav">
        {NAV_ITEMS.map((item) => (
          <div
            key={item.key}
            className={`rail-item ${item.navigable ? 'clickable' : ''} ${active === item.key ? 'active' : ''}`}
            role={item.navigable ? 'button' : undefined}
            tabIndex={item.navigable ? 0 : undefined}
            onClick={item.navigable ? () => onNavigate(item.key) : undefined}
            onKeyDown={
              item.navigable
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') onNavigate(item.key)
                  }
                : undefined
            }
          >
            {item.icon}
            <div className="rail-label">{item.label}</div>
          </div>
        ))}
      </div>

      <div className="rail-bottom">
        {/* Always present, even at zero — a click always answers "is there
            anything pending," rather than a permanently-invisible control
            no one would think to look for. The numeric badge itself is
            what's conditional. Visible on every screen, not just Play,
            since a match can finish (auto-detected or manual) while the
            user is elsewhere in the app. */}
        <div className="rail-pending-wrap">
          <div
            ref={pendingTriggerRef}
            className={`rail-item clickable ${panelOpen ? 'active' : ''}`}
            role="button"
            tabIndex={0}
            onClick={togglePanel}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') togglePanel()
            }}
          >
            <div className="rail-badge-wrap">
              <svg viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
                <path d="M12 8v4.5l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {pendingCount > 0 && <span className="rail-badge">{pendingCount}</span>}
            </div>
            <div className="rail-label">Pending</div>
          </div>

          {/* Rendered through a portal into <body>, not as a normal
              descendant here — .rail has overflow-y: auto, and Chromium
              treats that as clipping overflow-x too (the CSS overflow
              spec's "one axis non-visible forces the other to auto"
              rule), which would silently clip this panel to the rail's
              own 88px width otherwise. Positioned via the trigger's own
              getBoundingClientRect() since a portal drops it out of this
              DOM subtree's normal layout flow. */}
          {panelOpen &&
            createPortal(
              <>
                <div className="popover-backdrop" onClick={closePanel} />
                <PendingRecordingsPanel
                  anchorRect={pendingTriggerRef.current?.getBoundingClientRect()}
                  replays={pendingReplays}
                  fading={fading}
                  onMouseEnter={cancelAutoDismiss}
                  onLogMatch={(replay) => {
                    closePanel()
                    onLogMatch(replay)
                  }}
                  onDiscard={onDiscardPending}
                />
              </>,
              document.body
            )}
        </div>

        <div
          className={`rail-item clickable ${active === 'settings' ? 'active' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => onNavigate('settings')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onNavigate('settings')
          }}
        >
          <svg viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          <div className="rail-label">Settings</div>
        </div>
      </div>
    </div>
  )
}
