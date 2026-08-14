import { useEffect, useRef, useState } from 'react'
import PendingRecordingsPanel from './PendingRecordingsPanel.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'

// The Pending Recordings popover's entire standalone renderer — mounted
// into its own dedicated WebContentsView (see src/main/pendingPanelView.js)
// rather than into the main window's own document, so it can genuinely
// float above the Play tab's embedded browser (a native view that always
// paints above ordinary page content, popover included, regardless of CSS
// z-index) without ever touching that embed's own bounds. Sidebar.jsx owns
// all the actual state (which recordings are pending, auto-dismiss timing,
// fading) and pushes it down via pending-panel:state; this component is a
// thin display surface plus the handful of interactions that don't need
// Sidebar's state directly (discard's confirm step, reporting its own
// rendered size back so the overlay's bounds stay pixel-accurate).
export default function PendingPanelWindow() {
  const [replays, setReplays] = useState([])
  const [fading, setFading] = useState(false)
  const [discardTarget, setDiscardTarget] = useState(null)
  const [discarding, setDiscarding] = useState(false)
  const rootRef = useRef(null)

  // The shared bundle's html/body background is opaque (var(--bg)) so the
  // main window reads correctly everywhere else — here it must be
  // transparent, or it would paint right back over the WebContentsView's
  // own transparent background, showing as a solid rectangle (with square
  // corners poking out past the panel's own rounded ones) instead of a
  // true floating popover. overflow: hidden for a related reason: this
  // view's bounds are always set to exactly match this content's own
  // measured size (see the ResizeObserver below), but that measurement
  // and the rounded pixel bounds main actually applies can differ by a
  // sub-pixel fraction — enough for the browser to consider the page
  // "overflowing" and show scrollbars. Nothing here is ever meant to
  // scroll, so clipping that stray fraction is correct, not a workaround.
  useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
  }, [])

  useEffect(() => window.api.pendingPanel.onState(({ replays, fading }) => {
    setReplays(replays)
    setFading(fading)
  }), [])

  // Keeps the overlay view's bounds matched to this popover's actual
  // rendered footprint (item count changes, etc.) rather than a fixed
  // worst-case guess — see pendingPanelView.js's reportPendingPanelSize.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    function report() {
      const rect = el.getBoundingClientRect()
      window.api.pendingPanel.reportSize({ width: rect.width, height: rect.height })
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => observer.disconnect()
  }, [replays])

  // Discard's confirmation dialog needs real screen space to render in,
  // not the popover's own small footprint — see expandPendingPanel's
  // comment in pendingPanelView.js for why that's a safe, expected
  // full-screen takeover rather than the resize bug this component exists
  // to avoid.
  useEffect(() => {
    if (discardTarget) window.api.pendingPanel.expand()
    else window.api.pendingPanel.collapse()
  }, [discardTarget])

  async function handleConfirmDiscard() {
    setDiscarding(true)
    try {
      const result = await window.api.replays.discardPending(discardTarget)
      if (result.success) {
        window.api.pendingPanel.notifyChanged()
      } else {
        console.error('Failed to discard pending recording:', result.reason)
      }
    } catch (err) {
      console.error('Failed to discard pending recording:', err)
    } finally {
      setDiscarding(false)
      setDiscardTarget(null)
    }
  }

  return (
    // A plain block div stretches to fill its containing block's width
    // (here, the WebContentsView's own viewport, which starts at 0 and is
    // only ever grown to match this element's reported size — see the
    // ResizeObserver above), rather than shrink-wrapping to its child's
    // actual 320px width. inline-block is what makes this div's own
    // getBoundingClientRect() report the panel's real rendered footprint
    // instead of 0.
    <div ref={rootRef} style={{ display: 'inline-block' }}>
      <PendingRecordingsPanel
        replays={replays}
        fading={fading}
        onMouseEnter={() => window.api.pendingPanel.notifyMouseEnter()}
        onLogMatch={(replay) => window.api.pendingPanel.notifyLogMatch(replay)}
        onRequestDiscard={setDiscardTarget}
      />

      {discardTarget && (
        <ConfirmDialog
          title={discardTarget.hasRecording ? 'Discard Recording?' : 'Discard Match?'}
          message={
            discardTarget.hasRecording
              ? "This permanently deletes the recording file. It hasn't been linked to any match, so no logged match data is affected."
              : "This removes it from the Log Recent Match queue. It hasn't been logged as a match, and there's no recording file to delete."
          }
          confirmLabel="Discard"
          danger
          busy={discarding}
          onConfirm={handleConfirmDiscard}
          onCancel={() => setDiscardTarget(null)}
        />
      )}
    </div>
  )
}
