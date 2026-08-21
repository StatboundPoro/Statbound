import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import AppMark from '../lib/appMark.jsx'

// How long an auto-shown notification (a recording just finished) stays
// fully visible before it starts fading, and the total time (including
// the fade) before it closes itself — separate from FADE_DURATION_MS
// below so the CSS transition and the JS timer that finalizes the close
// stay in sync.
const AUTO_DISMISS_DELAY_MS = 4000
const FADE_DURATION_MS = 1200

// Play, Decks, Matches, Insights, and Matrix all have real screens, so
// they're clickable and their `key` doubles as the `screen` value App.jsx
// switches on. Settings stays in its own `rail-bottom` slot (gear icon,
// pinned below the main nav list) rather than joining NAV_ITEMS, since
// that's a deliberate, distinct part of the rail's layout, not an
// oversight.
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
  },
  {
    key: 'matchup-matrix',
    label: 'Matrix',
    navigable: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="18" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3 9h18M3 15h18M9 3v18M15 3v18" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    )
  }
]

export default function Sidebar({
  active,
  onNavigate,
  pendingReplays,
  onLogMatch,
  onPendingChanged,
  logQueueSignal,
  onUpdatePanelOpenChange
}) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [fading, setFading] = useState(false)
  // True only for the self-dismissing notification opened automatically
  // right after a match session ends (recorded or not) — shows just that
  // one new item, not the whole accumulated queue (which is what a manual
  // badge click still shows in full). False for every manually-opened path.
  const [autoMode, setAutoMode] = useState(false)
  const pendingTriggerRef = useRef(null)
  const fadeTimerRef = useRef(null)
  const dismissTimerRef = useRef(null)
  const pendingCount = pendingReplays.length

  // Check-only auto-update (see src/main/services/updateCheck.js) — null
  // until the one-time getStatus() fetch on mount resolves. Unlike the
  // Pending Recordings popover above, this one renders as plain DOM right
  // here rather than through its own dedicated overlay WebContentsView:
  // it never auto-opens, so the one case where it could render invisibly
  // underneath the Play tab's embed (see App.jsx's embedHidden) is handled
  // the same way LogMatchModal already handles that for itself, rather
  // than justifying a second overlay view for something this infrequent.
  const [updateStatus, setUpdateStatus] = useState(null)
  const [updatePanelOpen, setUpdatePanelOpen] = useState(false)
  // Where the portal-rendered popover below should sit, in viewport
  // coordinates — computed from the trigger's own getBoundingClientRect()
  // rather than a CSS offset assuming a particular dock side, since the
  // popover no longer renders nested inside .rail (see the portal below).
  const [updateAnchor, setUpdateAnchor] = useState(null)
  const updateTriggerRef = useRef(null)
  const updatePanelRef = useRef(null)

  useEffect(() => {
    window.api.updates
      .getStatus()
      .then(setUpdateStatus)
      .catch((err) => console.error('Failed to load update status:', err))
    return window.api.updates.onStatusChanged(setUpdateStatus)
  }, [])

  useEffect(() => {
    onUpdatePanelOpenChange?.(updatePanelOpen)
  }, [updatePanelOpen, onUpdatePanelOpenChange])

  // Popover width from styles.css's .update-panel — kept in sync by hand,
  // same tradeoff lib/appMark.jsx already makes for its own hardcoded
  // values, since measuring it would need an extra layout pass before the
  // anchor could be computed on open.
  const UPDATE_PANEL_WIDTH = 240

  useEffect(() => {
    if (!updatePanelOpen) return
    function computeAnchor() {
      const rect = updateTriggerRef.current?.getBoundingClientRect()
      if (!rect) return
      setUpdateAnchor({
        left: Math.min(rect.right + 12, window.innerWidth - UPDATE_PANEL_WIDTH - 16),
        // Anchored by the trigger's own top edge, clamped so a very short
        // window can't push the popover's bottom past the viewport.
        top: Math.min(rect.top, window.innerHeight - 160)
      })
    }
    computeAnchor()
    window.addEventListener('resize', computeAnchor)
    return () => window.removeEventListener('resize', computeAnchor)
  }, [updatePanelOpen])

  useEffect(() => {
    if (!updatePanelOpen) return
    function handlePointerDown(e) {
      // A click inside the popover itself (e.g. "View Release Notes") must
      // NOT count as an outside click — the popover is a portal to
      // document.body now, so it's a sibling of the trigger in the DOM,
      // not a descendant of it, and needs its own containment check here.
      const inTrigger = updateTriggerRef.current?.contains(e.target)
      const inPanel = updatePanelRef.current?.contains(e.target)
      if (!inTrigger && !inPanel) {
        setUpdatePanelOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [updatePanelOpen])

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

  function openPanel(auto = false) {
    clearAutoDismissTimers()
    setFading(false)
    setAutoMode(auto)
    setPanelOpen(true)
  }

  function closePanel() {
    clearAutoDismissTimers()
    setFading(false)
    setAutoMode(false)
    setPanelOpen(false)
  }

  function togglePanel() {
    if (panelOpen) closePanel()
    else openPanel(false)
  }

  function cancelAutoDismiss() {
    clearAutoDismissTimers()
    setFading(false)
  }

  // Auto-popup: a match session ending — whether it produced a recording
  // (manual Stop or auto-detected) or not (see matchSessions.js) — pops
  // the queue open by itself as a self-dismissing notification, rather
  // than requiring a click to even notice it happened. Skips the initial
  // mount (the signal starts at 0 and only ever increments from a real
  // event). Hovering the panel cancels the fade/dismiss — see the
  // onMouseEnter handler passed down through pending-panel:sync below —
  // so reading it doesn't race against it disappearing.
  useEffect(() => {
    if (logQueueSignal === 0) return
    openPanel(true)
    fadeTimerRef.current = setTimeout(() => setFading(true), AUTO_DISMISS_DELAY_MS)
    dismissTimerRef.current = setTimeout(() => closePanel(), AUTO_DISMISS_DELAY_MS + FADE_DURATION_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logQueueSignal])

  useEffect(() => clearAutoDismissTimers, [])

  // Most-recent-first (listPendingReplays()'s natural order) — slicing to
  // one keeps that ordering, so "the latest" really is the newest.
  // Memoized so the sync effect below (keyed on this array) doesn't fire
  // on every render, only when the underlying data or mode actually
  // changes.
  const visibleReplays = useMemo(
    () => (autoMode ? pendingReplays.slice(0, 1) : pendingReplays),
    [autoMode, pendingReplays]
  )

  // Pushes this popover's open/anchor/content state down to its own
  // dedicated overlay view (see pendingPanelView.js) — the actual panel no
  // longer renders in this document at all, since that's what let it get
  // hidden behind the Play tab's embedded browser (a native view that
  // always paints on top of ordinary page content regardless of CSS
  // z-index). Re-sent on window resize too, since the trigger's on-screen
  // position (the popover's anchor) can move with it.
  useEffect(() => {
    function push() {
      const rect = pendingTriggerRef.current?.getBoundingClientRect()
      window.api.pendingPanel.sync({
        open: panelOpen,
        anchor: rect ? { left: rect.right + 12, bottom: rect.bottom } : null,
        replays: visibleReplays,
        fading
      })
    }
    push()
    if (!panelOpen) return
    window.addEventListener('resize', push)
    return () => window.removeEventListener('resize', push)
  }, [panelOpen, visibleReplays, fading])

  // Clicking anywhere outside the trigger closes a manually-opened panel —
  // the old portal-based version caught this via a full-viewport backdrop
  // in the same document as the trigger; the popover now lives in a
  // separate view, so this is the equivalent for clicks that land
  // elsewhere in this window's own DOM (a click on the Play embed itself
  // can't be observed here, since it's a different WebContents entirely).
  useEffect(() => {
    if (!panelOpen) return
    function handlePointerDown(e) {
      if (pendingTriggerRef.current && !pendingTriggerRef.current.contains(e.target)) {
        closePanel()
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen])

  // Relayed back from the overlay view (see PendingPanelWindow.jsx) since
  // it's a separate WebContents with no direct access to this component's
  // state: Log Match attaches the exact recording clicked and closes the
  // panel, hovering cancels the auto-dismiss timer, and a successful
  // discard means the badge count here needs to refetch.
  useEffect(() => {
    const offLogMatch = window.api.pendingPanel.onLogMatch((replay) => {
      closePanel()
      onLogMatch(replay)
    })
    const offMouseEnter = window.api.pendingPanel.onMouseEnter(cancelAutoDismiss)
    const offChanged = window.api.pendingPanel.onChanged(() => onPendingChanged?.())
    return () => {
      offLogMatch()
      offMouseEnter()
      offChanged()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="rail">
      <div className="rail-mark">
        <AppMark />
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
            title="Log Recent Match"
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
            <div className="rail-label">Log Match</div>
          </div>
        </div>

        {/* Hidden entirely unless a newer version was actually found — see
            services/updateCheck.js. There's nothing to click before then,
            unlike the always-present Log Match trigger above (which stays
            visible even at zero, since a click still answers a real
            question). */}
        {updateStatus?.available && (
          <div className="rail-update-wrap">
            <div
              ref={updateTriggerRef}
              className={`rail-item clickable ${updatePanelOpen ? 'active' : ''}`}
              role="button"
              tabIndex={0}
              title={`Update available: v${updateStatus.version}`}
              onClick={() => setUpdatePanelOpen((open) => !open)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setUpdatePanelOpen((open) => !open)
              }}
            >
              <div className="rail-badge-wrap">
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 4v11M7 10l5 5 5-5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M5 19h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <span className="rail-badge rail-badge-dot" />
              </div>
              <div className="rail-label">Update</div>
            </div>

            {/* Rendered via a portal to document.body, not nested inside
                .rail, since .rail is only 88px wide with a computed
                overflow-x that clips anything positioned outside its own
                bounds (a plain absolutely-positioned child here used to be
                invisible as a result). Positioned in viewport coordinates
                from the trigger's own getBoundingClientRect() (updateAnchor,
                recomputed on resize above) instead. */}
            {updatePanelOpen &&
              updateAnchor &&
              createPortal(
                <div
                  ref={updatePanelRef}
                  className="update-panel"
                  style={{ left: updateAnchor.left, top: updateAnchor.top }}
                >
                  <div className="update-panel-title">Update Available</div>
                  <div className="update-panel-body">
                    Statbound {updateStatus.version} is available. You're on {updateStatus.currentVersion}.
                  </div>
                  <button
                    type="button"
                    className="update-panel-button"
                    onClick={() => window.api.updates.openReleasePage()}
                  >
                    View Release Notes
                  </button>
                </div>,
                document.body
              )}
          </div>
        )}

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
