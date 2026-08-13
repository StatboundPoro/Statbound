import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import PendingPanelWindow from './components/PendingPanelWindow.jsx'

// Self-hosted fonts (bundled locally by Vite, not fetched from a CDN at
// runtime) — see styles.css for why these live here instead of an @import.
import '@fontsource/inter/400'
import '@fontsource/inter/500'
import '@fontsource/inter/600'
import '@fontsource/inter/700'
import '@fontsource/big-shoulders-display/600'
import '@fontsource/big-shoulders-display/700'
import '@fontsource/big-shoulders-display/800'
import '@fontsource/ibm-plex-mono/400'
import '@fontsource/ibm-plex-mono/500'
import '@fontsource/ibm-plex-mono/600'

import './styles.css'

// The same index.html/entry bundle also backs the Pending Recordings
// popover's own dedicated WebContentsView (see src/main/pendingPanelView.js)
// — loaded with ?view=pending-panel rather than a second Vite entry point,
// so it shares this bundle's styles/fonts/components with zero duplication.
const isPendingPanel = new URLSearchParams(window.location.search).get('view') === 'pending-panel'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>{isPendingPanel ? <PendingPanelWindow /> : <App />}</React.StrictMode>
)
