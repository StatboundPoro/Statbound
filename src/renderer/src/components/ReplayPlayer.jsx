import { useEffect, useRef } from 'react'

// A simple playback modal for one linked replay. `src` is a
// statbound-replay:// URL built by main (see replayProtocol.js) — never a
// raw file:// path, since the renderer has no filesystem access of its
// own and shouldn't be trusted to construct a path into the Video Capture
// folder itself.
export default function ReplayPlayer({ src, onClose }) {
  const videoRef = useRef(null)

  // Native <video controls> only reads arrow-key seek presses when the
  // video element itself has keyboard focus — on open, focus is still
  // wherever the triggering "Watch Replay" click left it, so arrow keys
  // silently went nowhere until this moved focus onto the player.
  useEffect(() => {
    videoRef.current?.focus()
  }, [])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Replay</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- recordings are video-only, no audio track exists to caption */}
        <video ref={videoRef} className="replay-video" src={src} controls autoPlay />
      </div>
    </div>
  )
}
