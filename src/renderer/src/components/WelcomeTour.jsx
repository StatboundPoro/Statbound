import { useState } from 'react'

// Five fixed steps, no per-step "don't show again" — it's the whole tour
// or Skip, nothing in between. `accent` just cycles through the app's
// existing Domain colors for a bit of visual variety per step; it carries
// no meaning tied to actual Domains here.
const STEPS = [
  {
    accent: 'order',
    title: 'Welcome to Statbound',
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M12 2 L21 7 L21 17 L12 22 L3 17 L3 7 Z" stroke="currentColor" strokeWidth="1.4" />
        <path d="M12 2 V22 M3 7 L21 17 M21 7 L3 17" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      </svg>
    ),
    paragraphs: [
      'Statbound is a local companion app for the Riftbound TCG: deck tracking, match history, and matchup prep, all in one place.',
      "Everything here is local-only, by design. Your decks, matches, notes, and recordings never leave this machine: no accounts, no servers, no telemetry."
    ]
  },
  {
    accent: 'mind',
    title: 'Import a Deck',
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <rect x="13" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <rect x="13" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    ),
    paragraphs: [
      'Paste a decklist (Legend, Champion, Main Deck, Battlefields, and Runes, plus an optional Sideboard) and Statbound parses and validates it automatically.',
      "Your deck's two Domains are derived straight from its Runes, so there's nothing else to fill in by hand."
    ]
  },
  {
    accent: 'calm',
    title: 'Log a Match',
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3 9h18" stroke="currentColor" strokeWidth="1.6" />
        <path d="M7 13h4M7 16h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
    paragraphs: [
      "After a game, log it from that deck's page: opponent, format (Bo1/Bo3), each game's result, seat, and battlefields.",
      'Win rate, streaks, and matchup records are all calculated automatically from the matches you log. Nothing gets entered twice.'
    ]
  },
  {
    accent: 'chaos',
    title: 'Insights',
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M4 12 Q4 4 12 4 Q20 4 20 12 Q20 20 12 20" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 8v4l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
    paragraphs: [
      'The Insights screen turns your match history into win rate trends, seat advantage, battlefield performance, and a best/worst matchup breakdown.',
      "View it across every deck, or scope it to just one from that deck's own page."
    ]
  },
  {
    accent: 'fury',
    title: 'Replay Capture',
    icon: (
      <svg viewBox="0 0 24 24" fill="none">
        <rect x="3" y="6" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M16 10l5-3v10l-5-3" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx="9.5" cy="12" r="1.6" fill="currentColor" />
      </svg>
    ),
    paragraphs: [
      'The Play tab embeds Rift Atlas right inside Statbound, with an optional recording of just that game (video only, no audio).',
      'Turn on Auto-record to start and stop capture on its own as matches begin and end, then link a finished recording to a match from the Pending Recordings queue.'
    ]
  }
]

// A one-time (or on-demand, via Settings) 5-step modal explaining
// RiftTrack's core features. Completing it ("Get Started" on the final
// step) and Skipping it from any step both call the same finish() path —
// skipping is not "ask again later," it's treated as done, exactly like
// finishing. `onClose` is called either way so the caller (App.jsx or
// SettingsScreen.jsx) can unmount it; only App.jsx's first-run trigger
// also needs to persist that it's been seen, via the `persistSeen` prop —
// a manual replay from Settings shows the exact same component without
// re-marking anything (it's already true by then).
export default function WelcomeTour({ onClose, persistSeen = true }) {
  const [stepIndex, setStepIndex] = useState(0)
  const step = STEPS[stepIndex]
  const isFirst = stepIndex === 0
  const isLast = stepIndex === STEPS.length - 1

  async function finish() {
    if (persistSeen) {
      try {
        await window.api.welcomeTour.markSeen()
      } catch (err) {
        console.error('Failed to save welcome tour completion:', err)
      }
    }
    onClose()
  }

  function handleNext() {
    if (isLast) finish()
    else setStepIndex((i) => i + 1)
  }

  return (
    <div className="modal-backdrop">
      <div className="modal welcome-tour-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close welcome-tour-close" onClick={finish} aria-label="Skip tour">
          ×
        </button>

        <div className={`welcome-tour-icon accent-${step.accent}`}>{step.icon}</div>
        <div className="welcome-tour-step-label">
          Step {stepIndex + 1} of {STEPS.length}
        </div>
        <h2 className="welcome-tour-title">{step.title}</h2>
        <div className="welcome-tour-body">
          {step.paragraphs.map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>

        <div className="welcome-tour-progress">
          {STEPS.map((_, i) => (
            <span key={i} className={`welcome-tour-dot ${i === stepIndex ? 'active' : ''}`} />
          ))}
        </div>

        <div className="welcome-tour-footer">
          <button className="btn welcome-tour-skip" onClick={finish}>
            Skip
          </button>
          <div className="welcome-tour-nav">
            {!isFirst && (
              <button className="btn" onClick={() => setStepIndex((i) => i - 1)}>
                Back
              </button>
            )}
            <button className="btn btn-primary" onClick={handleNext}>
              {isLast ? 'Get Started' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
