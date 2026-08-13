// A simple playback modal for one linked replay. `src` is a
// rifttrack-replay:// URL built by main (see replayProtocol.js) — never a
// raw file:// path, since the renderer has no filesystem access of its
// own and shouldn't be trusted to construct a path into the Video Capture
// folder itself.
export default function ReplayPlayer({ src, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Replay</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- no audio track exists to caption */}
        <video className="replay-video" src={src} controls autoPlay />
      </div>
    </div>
  )
}
