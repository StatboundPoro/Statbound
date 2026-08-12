import { useEffect, useRef } from 'react'

// Renders no page content of its own for the embed area — the actual
// play.riftatlas.com content is a native WebContentsView the main process
// draws on top of this div's screen position (see src/main/playView.js).
// This component's only job is to tell main process where that rectangle
// is, on mount/resize, and to show/hide the view as this screen mounts and
// unmounts so it doesn't render on top of other screens.
export default function PlayScreen() {
  const containerRef = useRef(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function reportBounds() {
      const rect = el.getBoundingClientRect()
      // DOMRect's x/y/width/height are getters on DOMRect.prototype, not
      // own properties — contextBridge only clones own enumerable
      // properties across the isolated-world boundary, so passing the
      // DOMRect itself arrives in preload as all-undefined. Read the
      // values out into a plain object here, before it crosses the bridge.
      window.api.play.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
    }

    window.api.play.show()
    reportBounds()

    const observer = new ResizeObserver(reportBounds)
    observer.observe(el)
    window.addEventListener('resize', reportBounds)

    return () => {
      window.removeEventListener('resize', reportBounds)
      observer.disconnect()
      window.api.play.hide()
    }
  }, [])

  return (
    <div className="main main-play">
      <div className="topbar">
        <div>
          <h1>Play</h1>
        </div>
      </div>
      <div className="play-embed" ref={containerRef} />
    </div>
  )
}
