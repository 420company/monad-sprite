import './polyfills' // Must come first: @solana/* depends on Node's Buffer
import './lib/storageMigrate' // Must come second: migrate old-brand storage keys to 0x4.* before any store reads storage
import './lib/chunkReload' // After a release, stale pages can't fetch old chunks: auto-refresh in place once (2026-10-02)
import './lib/reloadWatch' // Records "auto-reloaded after being killed by the OS" — must run early to read the last heartbeat before other code
import './lib/theme' // Write dark/light to <html data-theme> ASAP to avoid flashing dark first
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { unstable_HistoryRouter as HistoryRouter } from 'react-router-dom'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { installKeyboardFollow } from './lib/keyboard'
import { installTapRipple } from './lib/tapRipple'
import { handleXAuthPopup } from './lib/xauth'
import { initPwaUpdate } from './lib/pwaUpdate'
import { createAppHistory } from './lib/pageTransition'
import { migrateLegacyUrl } from './lib/route'
import './index.css'
// Web frame styles (only under html[data-surface="web"] / .desk-*; unused in the phone app)
import './desktop/desktop.css'
import './desktop/motion.css'
import './desktop/light.css'
import './desktop/space.css'
import { WEB_SURFACE } from './lib/surface'
// Home top-bar "0x4" pixel font (2026-09-29 goat: regular fonts look too plain): bundled into the app so native shows it offline; Latin 600 only
import '@fontsource/pixelify-sans/latin-600.css'
// Web body font Geist (docs/WEB_DESIGN.md): bundled, no Google Fonts. WEB_SURFACE is always false in phone-app builds, so this line is compiled out entirely
if (WEB_SURFACE) void import('@fontsource-variable/geist/index.css')
// Light-mode "liquid glass" ambient light and cursor reflections (desktop/liquid.ts, 2026-10-03)
if (WEB_SURFACE) void import('./desktop/liquid').then((m) => m.mountLiquid())
// "Space" appearance's blurred photo background and parallax (desktop/space.ts, 2026-10-03)
if (WEB_SURFACE) void import('./desktop/space').then((m) => m.mountSpace())

// Web: entry light-beam from the website's "Into the 0x4" (html.arrive, added by desktop/warp.js before the first frame); removed with its flag after playing
if (WEB_SURFACE) {
  try {
    if (sessionStorage.getItem('0x4.warp')) {
      sessionStorage.removeItem('0x4.warp')
      setTimeout(() => document.documentElement.classList.remove('arrive'), 1400)
    }
  } catch { /* Privacy mode */ }
}

// Web first rewrites legacy 420.meme/app/#/xxx URLs to /xxx in place (lib/route.ts). Must precede any code reading URL params:
// the X-binding auth window returns with ?x=… in the URL, which the next line reads
migrateLegacyUrl()
// When the X-binding auth window returns: hand the result to the original page and close itself, rendering nothing
if (!handleXAuthPopup()) {
// Diagnostics written locally by old beta builds; cleared after the diagnostics tool was removed
try { localStorage.removeItem('0x4.diag.log') } catch { /* Storage unavailable */ }
// Move inputs above the keyboard when the soft keyboard opens
installKeyboardFollow()
installTapRipple() // Global key-press ripple, see lib/tapRipple.ts
// Web: check for new versions — auto-switch when opened fresh with no interaction yet, otherwise a bottom prompt (no-op in the native app)
initPwaUpdate()
// Routing: #/ URLs on phones, clean URLs on desktop web (lib/route.ts); the history object is wrapped to play directional transition animations on page changes (lib/pageTransition.ts).
// useTransitions={false}: route state updates synchronously so it can render in one go inside the View Transition callback (it used to default to React startTransition)
const appHistory = createAppHistory()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <HistoryRouter history={appHistory} useTransitions={false}>
        <App />
      </HistoryRouter>
    </ErrorBoundary>
  </StrictMode>,
)
}
