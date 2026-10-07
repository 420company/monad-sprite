// Page transition animations (2026-09-29 goat: "if there are screen transitions, make them silky — they're stiff right now").
//
// Approach: swap routing to unstable_HistoryRouter + a self-wrapped hash history. Every history change (link tap, back button, back gesture, Android back key,
// Browser forward/back both come through here): determine the direction first, then wrap this route-state update in the View Transitions API:
// The browser first snapshots the old page, flushSync renders the new page synchronously, then plays the matching animation from index.css per <html data-nav>.
//   - Enter a deeper page (forward): the new page pushes in from the right, the old page yields left and darkens — matching iOS native navigation
//   - Back: reversed — the old page slides away to the right, the previous page returns from the left to its place
//   - Between the five bottom tabs: no horizontal push, only a very short fade — close to the iOS tab bar's "in-place switch"
//   - Same page with only params changed (in-page tabs, filters), guard rewrites, swipe-back (the page already slid out with the finger): no full-page animation
// No View Transitions (old systems) or the OS has "reduce motion" on: switch instantly as usual.
// Desktop web (WEB_SURFACE, 2026-09-30 goat: "the whole page sliding away looks really uncomfortable") doesn't slide horizontally:
//   Switching content within one section (spot coin switch, another person's profile, etc.): no full-page animation, data just updates in place;
//   Switching sections (top nav, "My assets" / "My profile" / "Settings" in personal center) only does a very short fade; the top bar and bottom status bar stay put (index.css data-nav="fade")
// On back-navigation the scroll position is still restored by ScrollRestorer during layout (run synchronously inside flushSync), so the new page's snapshot is the restored position.
import { flushSync } from 'react-dom'
import { UNSAFE_createBrowserHistory, UNSAFE_createHashHistory } from 'react-router-dom'
import { isNative } from './native'
import { WEB_SURFACE } from './surface'
import { CLEAN_URLS } from './route'

export type NavDir = 'forward' | 'back' | 'tab' | 'fade' | 'none'

/** The home page of the five bottom tabs */
export const TAB_ROOTS = new Set(['/', '/discover', '/community', '/live', '/settings'])

/** The back button / back gesture reports the direction here before navigating; if no navigation happens within 1 second it's discarded, so it doesn't latch onto some unrelated later jump */
let hint: { dir: NavDir; at: number } | null = null
const HINT_MS = 1000
export function markNextNav(dir: NavDir, now = Date.now()) { hint = { dir, at: now } }
export function takeHint(now = Date.now()): NavDir | null {
  const h = hint
  hint = null
  return h && now - h.at < HINT_MS ? h.dir : null
}

export interface NavStep {
  from: string
  to: string
  action: string
  /** How many entries history moved on browser forward/back (negative = back); null when unavailable */
  delta?: number | null
  hint?: NavDir | null
  /** Whether it's the native app */
  native: boolean
  /** Whether it's a touch device (mobile browser) */
  coarse: boolean
}

/** Which animation this navigation should play */
export function navDirection(s: NavStep): NavDir {
  if (s.hint === 'none') return 'none'
  if (s.from === s.to) return 'none'
  const fromTab = TAB_ROOTS.has(s.from), toTab = TAB_ROOTS.has(s.to)
  // When the back button has no previous page, it's "replace with the parent page" — still plays as back
  if (s.hint === 'back' || s.hint === 'forward') return fromTab && toTab ? 'tab' : s.hint
  if (s.action === 'POP') {
    if (fromTab && toTab) return 'tab'
    // In mobile browsers, edge-swipe / back-button navigation uses the browser's own animation — don't play ours on top
    // (The in-app back button calls markNextNav('back') first, taking the path above — unaffected)
    if (!s.native && s.coarse) return 'none'
    return (s.delta ?? -1) < 0 ? 'back' : 'forward'
  }
  if (s.action === 'REPLACE') return 'none'
  return toTab ? 'tab' : 'forward'
}

/** Web groups by section: the spot list and a single coin's trade page count as one section (switching coins doesn't transition the whole page) */
const WEB_GROUPS: Record<string, string> = { token: 'spot', spot: 'spot' }
const webSection = (path: string) => { const seg = path.split('/')[1] || ''; return WEB_GROUPS[seg] ?? seg }
/** Desktop web: swap the phone direction set for "same section stays / cross-section fades" */
export function webNavDirection(from: string, to: string, base: NavDir): NavDir {
  if (base === 'none') return 'none'
  return webSection(from) === webSection(to) ? 'none' : 'fade'
}

type VT = { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void> }
type DocWithVT = Document & { startViewTransition?: (cb: () => void) => VT }

const reducedMotion = () => { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches } catch { return false } }
const coarsePointer = () => { try { return !!window.matchMedia?.('(pointer: coarse)').matches } catch { return false } }

let seq = 0
/** Play the animation in the given direction, running update synchronously midway; update directly when it can't play. Returns whether a transition was used */
export function runWithTransition(dir: NavDir, update: () => void, doc: Document = document, reduced = reducedMotion): boolean {
  const d = doc as DocWithVT
  if (dir === 'none' || typeof d.startViewTransition !== 'function' || reduced()) { update(); return false }
  const root = doc.documentElement
  const token = String(++seq)
  root.dataset.nav = dir
  root.dataset.navSeq = token
  const done = () => { if (root.dataset.navSeq === token) { delete root.dataset.nav; delete root.dataset.navSeq } }
  let vt: VT
  try {
    vt = d.startViewTransition.call(doc, () => { flushSync(update) })
  } catch {
    done(); update(); return false
  }
  // When tapped twice in a row, the new transition supersedes the previous one (ready / finished reject) — swallow it, don't treat as an error
  vt.ready.catch(() => {})
  vt.updateCallbackDone.catch(() => {})
  vt.finished.then(done, done)
  return true
}

type HashHistory = ReturnType<typeof UNSAFE_createHashHistory>
type Update = { action: string; location: { pathname: string }; delta?: number | null }

/** Wrap the history object: on every route change, determine the direction first, then run the router's own update inside the transition animation */
export function withPageTransitions<H extends Pick<HashHistory, 'listen' | 'location'>>(history: H, env: { native: boolean; coarse: () => boolean; web?: boolean } = { native: isNative, coarse: coarsePointer, web: WEB_SURFACE }): H {
  const listen = history.listen.bind(history)
  let current = history.location.pathname
  history.listen = ((fn: (u: Update) => void) => listen((update: Update) => {
    const to = update.location.pathname
    const base = navDirection({ from: current, to, action: update.action, delta: update.delta, hint: takeHint(), native: env.native, coarse: env.coarse() })
    const dir = env.web ? webNavDirection(current, to, base) : base
    current = to
    runWithTransition(dir, () => fn(update))
  })) as H['listen']
  return history
}

/**
 * The history used by the whole app (main.tsx hands it to unstable_HistoryRouter), v5Compat behavior.
 * Desktop web uses clean URLs 420.meme/discover (2026-10-02, lib/route.ts); mobile web and the native app still use #/ addresses
 */
export function createAppHistory(): HashHistory {
  return withPageTransitions(CLEAN_URLS ? UNSAFE_createBrowserHistory({ window, v5Compat: true }) : UNSAFE_createHashHistory({ window, v5Compat: true }))
}
