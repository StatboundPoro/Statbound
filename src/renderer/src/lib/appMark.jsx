// The app's logomark: the same six-wedge hexagon crest as build/statbound-icon.svg
// (real Domain colors sampled from the domain PNGs, matching src/renderer/src/lib
// /domainIcons.js's palette), but cropped to just the crest itself with no
// background square — build/statbound-icon.svg's dark rounded-square backdrop
// exists for OS icon safe-area conventions, which don't apply here since these
// call sites (Sidebar's rail mark, WelcomeTour's step icon) already sit on the
// app's own dark background. Keep this in sync with build/statbound-icon.svg's
// wedge colors if that source ever changes.
export default function AppMark(props) {
  return (
    <svg viewBox="100 100 480 480" fill="none" {...props}>
      <g stroke="#14161a" strokeWidth="6" strokeLinejoin="round">
        <path d="M340,245 L340,120 L530.5,230 L422.3,292.5 A95,95 0 0,0 340,245 Z" fill="#CEA903" />
        <path d="M422.3,292.5 L530.5,230 L530.5,450 L422.3,387.5 A95,95 0 0,0 422.3,292.5 Z" fill="#9679A7" />
        <path d="M422.3,387.5 L530.5,450 L340,560 L340,435 A95,95 0 0,0 422.3,387.5 Z" fill="#E2700D" />
        <path d="M340,435 L340,560 L149.5,450 L257.7,387.5 A95,95 0 0,0 340,435 Z" fill="#23779B" />
        <path d="M257.7,387.5 L149.5,450 L149.5,230 L257.7,292.5 A95,95 0 0,0 257.7,387.5 Z" fill="#63A066" />
        <path d="M257.7,292.5 L149.5,230 L340,120 L340,245 A95,95 0 0,0 257.7,292.5 Z" fill="#B32F29" />
      </g>
    </svg>
  )
}
