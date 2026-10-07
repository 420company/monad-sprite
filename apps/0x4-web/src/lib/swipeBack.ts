// Back gesture (2026-09-29 goat: "pages with a back button can't go back with a rightward touch swipe").
//
// iOS: hand-rolled left-edge swipe-right. WKWebView's built-in allowsBackForwardNavigationGestures wasn't used because it only honors browser history:
//   switching between the five bottom tabs also pushes history, so it would swipe back to the previous tab; pages opened directly from pushes / deep links have no previous history,
//   so it does nothing — mismatching the back button's "no previous page → go to the parent page" (useBack); unlock and onboarding pages could also be swiped away;
//   going back shows a snapshot taken before leaving, which jumps once the page re-renders. A custom implementation only activates on pages with a back button and follows the same logic as the back button.
// Android: the system back gesture / back key both fire Capacitor's backButton, which native.ts converts into a "0x4:back" event for here,
//   sharing the same logic as the iOS gesture and the page back button; open dialogs close first. No extra web swipe-right on Android — it would fight the system gesture.
// Disabled on web: mobile browsers already have edge-swipe back — another layer would go back two pages; desktops with a mouse never produce touch events anyway.
import { canGoBack, pageFallback } from './useBack'
import { markNextNav, type NavDir } from './pageTransition'
import { isNative, platform } from './native'
import type { NavigateFunction } from 'react-router-dom'

/** How many px from the left screen edge count as an "edge swipe-right" (roughly the iOS system edge-gesture range); judged leniently */
export const EDGE_PX = 24
// 2026-09-29 goat on a real device (iOS 26.6): "swiping on the phone screen to go back doesn't work either". iOS 26 itself supports swipe-right-back from anywhere in the content,
// and users habitually swipe from the middle of the screen — recognizing only the leftmost 24px is as good as nothing. Now swipes may start anywhere; non-edge starts just need a more clearly rightward direction (see classify).
/** Release: going back once the drag passes this fraction of the screen width */
export const COMMIT_RATIO = 0.35
/** Or a fast enough rightward fling (px / ms) with at least COMMIT_MIN_PX dragged */
export const COMMIT_VELOCITY = 0.5
export const COMMIT_MIN_PX = 40
/** Direction is only classified after the finger moves beyond this distance */
const SLOP = 10
const ANIM_MS = 200
/** After the page changes, how long the previous page takes to slide back from the left (same curve as the page-transition "back" in index.css) */
export const EMERGE_MS = 280

/** The five bottom tabs' home pages have no back button; unlock and onboarding pages can't be left by gesture */
const ROOTS = new Set(['/', '/discover', '/community', '/live', '/settings'])
export function swipeBackAllowedPath(pathname: string): boolean {
  if (ROOTS.has(pathname)) return false
  if (pathname === '/unlock' || pathname.startsWith('/onboarding')) return false
  return true
}

/**
 * Ignored while a dialog is open or the user is typing (dialogs handle their own dismissal; the page must not slide away while the keyboard is up mid-typing).
 * ★ Only truly-open ones count: bottom sheets are <dialog aria-modal="true"> that stay mounted with aria-modal even when closed —
 *   judging by [aria-modal] used to disable the gesture forever on any page hosting a sheet (instant swap, token detail, almost every feature page): the root cause of goat's 9/29 real-device "no swipe back".
 *   <dialog> is judged by open; non-<dialog> modals (image viewers that only render when open) still go by aria-modal.
 */
export function blockedByUi(doc: Document = document): boolean {
  if (doc.querySelector('dialog[open], [aria-modal="true"]:not(dialog)')) return true
  const a = doc.activeElement as HTMLElement | null
  return !!a?.matches?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
}

/** Ignored when the finger lands in a horizontally scrollable area, a chart canvas, or an element marked data-swipe-back="off" — their own dragging wins */
export function blockedByTarget(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null
  while (el && el !== el.ownerDocument.body && el !== el.ownerDocument.documentElement) {
    if (el instanceof HTMLCanvasElement) return true
    // Drags inside sliders and inputs stay theirs (position-size / leverage sliders are horizontal drags by nature)
    if (el.matches('input, textarea, select, [role="slider"]')) return true
    const h = el as HTMLElement
    if (h.dataset?.swipeBack === 'off') return true
    if (h.scrollWidth > h.clientWidth + 1) {
      const ox = getComputedStyle(h).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
    el = el.parentElement
  }
  return false
}

/**
 * Classified after the finger moves: vertical or leftward → abandon (hand to page scroll); clearly rightward → start dragging; unsure → keep waiting.
 * Edge starts use the original lenient bar; mid-screen starts need a more clearly rightward motion (horizontal at least 2x vertical, and over 16px moved) so it doesn't fight vertical scrolling
 */
export function classify(dx: number, dy: number, fromEdge = true): 'pending' | 'drag' | 'abort' {
  if (Math.abs(dy) > SLOP && Math.abs(dy) >= Math.abs(dx)) return 'abort'
  if (dx < -SLOP) return 'abort'
  if (fromEdge) {
    if (dx > SLOP && dx > Math.abs(dy) * 1.2) return 'drag'
  } else {
    if (Math.abs(dy) > SLOP && Math.abs(dy) * 2 > dx) return 'abort'
    if (dx > 16 && dx > Math.abs(dy) * 2) return 'drag'
  }
  return 'pending'
}

/** On release: go back when dragged past 35% of screen width or flung rightward fast enough; otherwise snap back */
export function shouldCommit(dx: number, width: number, velocity: number): boolean {
  return dx >= width * COMMIT_RATIO || (velocity >= COMMIT_VELOCITY && dx >= COMMIT_MIN_PX)
}

/**
 * Same as the page back button (useBack): go back when there's a previous page, otherwise to this page's registered parent, otherwise home.
 * transition: the page-switch animation (lib/pageTransition.ts). Android back key plays the "back" animation;
 * iOS swipe-back passes 'none': the page already slid out with the finger — don't replay it
 */
export function goBack(navigate: NavigateFunction, transition: NavDir = 'back') {
  markNextNav(transition)
  if (canGoBack()) navigate(-1)
  else navigate(pageFallback() || '/', { replace: true })
}

type Pt = { clientX: number; clientY: number }
export interface SwipeBackOptions {
  /** The element that translates with the finger (the whole app root) */
  root: HTMLElement
  /** Whether the current page allows gesture back */
  allowed: () => boolean
  onBack: () => void
  reducedMotion?: () => boolean
  now?: () => number
  width?: () => number
}

/** Attach the left-edge swipe-right; returns the teardown function */
export function installSwipeBack(o: SwipeBackOptions): () => void {
  const now = o.now ?? (() => performance.now())
  const width = o.width ?? (() => window.innerWidth || o.root.clientWidth || 375)
  const reduced = o.reducedMotion ?? (() => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  let s: { x0: number; y0: number; lastX: number; lastT: number; v: number; drag: boolean; edge: boolean } | null = null
  let busy = false
  const style = o.root.style

  const paint = (x: number, animate: boolean) => {
    style.transition = animate ? `transform ${ANIM_MS}ms cubic-bezier(.2,.8,.2,1)` : 'none'
    style.transform = `translate3d(${x}px,0,0)`
    style.boxShadow = '-16px 0 28px rgba(0,0,0,.28)'
    style.willChange = 'transform'
  }
  const clear = () => { style.transition = ''; style.transform = ''; style.boxShadow = ''; style.willChange = ''; style.opacity = '' }
  const settle = (x: number, then: () => void) => {
    busy = true
    paint(x, true)
    setTimeout(() => { then(); busy = false }, ANIM_MS + 20)
  }

  const emerge = (w: number) => {
    busy = true
    style.transition = 'none'
    style.boxShadow = ''
    style.transform = `translate3d(${-Math.round(w * 0.28)}px,0,0)`
    style.opacity = '.55'
    void o.root.offsetWidth   // Snap to the start point first, then begin the transition
    style.transition = `transform ${EMERGE_MS}ms cubic-bezier(.33,1,.68,1), opacity ${EMERGE_MS}ms ease-out`
    style.transform = 'translate3d(0,0,0)'
    style.opacity = '1'
    setTimeout(() => { clear(); busy = false }, EMERGE_MS + 20)
  }

  const onStart = (e: TouchEvent) => {
    if (busy || s || e.touches.length !== 1) return
    const t = e.touches[0] as Pt
    if (!o.allowed() || blockedByUi(o.root.ownerDocument) || blockedByTarget(e.target)) return
    s = { x0: t.clientX, y0: t.clientY, lastX: t.clientX, lastT: now(), v: 0, drag: false, edge: t.clientX <= EDGE_PX }
  }
  const onMove = (e: TouchEvent) => {
    if (!s) return
    if (e.touches.length !== 1) { if (s.drag) settle(0, clear); s = null; return }
    const t = e.touches[0] as Pt
    const dx = t.clientX - s.x0
    if (!s.drag) {
      const d = classify(dx, t.clientY - s.y0, s.edge)
      if (d === 'abort') { s = null; return }
      if (d === 'pending') return
      s.drag = true
    }
    e.preventDefault()   // Confirmed as a back gesture: don't let the page scroll along
    const at = now(), dt = at - s.lastT
    if (dt > 0) s.v = 0.8 * ((t.clientX - s.lastX) / dt) + 0.2 * s.v
    s.lastX = t.clientX; s.lastT = at
    if (!reduced()) paint(Math.max(0, dx), false)
  }
  const onEnd = () => {
    if (!s) return
    const g = s
    s = null
    if (!g.drag) return
    const w = width()
    if (!shouldCommit(g.lastX - g.x0, w, g.v)) { if (reduced()) clear(); else settle(0, clear); return }
    if (reduced()) { clear(); o.onBack(); return }
    // Change the page only after sliding out. Afterwards the previous page returns from the left slightly dimmed (same as the second half of the "back" transition) — no more popping in in place
    settle(w, () => { o.onBack(); requestAnimationFrame(() => emerge(w)) })
  }
  const onCancel = () => { if (s?.drag) settle(0, clear); s = null }

  const doc = o.root.ownerDocument
  doc.addEventListener('touchstart', onStart, { passive: true })
  doc.addEventListener('touchmove', onMove, { passive: false })
  doc.addEventListener('touchend', onEnd, { passive: true })
  doc.addEventListener('touchcancel', onCancel, { passive: true })
  return () => {
    doc.removeEventListener('touchstart', onStart)
    doc.removeEventListener('touchmove', onMove)
    doc.removeEventListener('touchend', onEnd)
    doc.removeEventListener('touchcancel', onCancel)
    clear()
  }
}

/**
 * Android back key / back gesture (the "0x4:back" event converted by native.ts):
 * with a dialog open, close the topmost one first (matches system behavior); pages with a back button follow the back logic; tab home pages decline — native.ts handles them as before (background the app)
 */
export function handleAndroidBack(e: Event, path: string, navigate: NavigateFunction) {
  const dialogs = document.querySelectorAll('dialog[open]')
  const top = dialogs[dialogs.length - 1]
  if (top) {
    e.preventDefault()
    top.dispatchEvent(new Event('cancel', { cancelable: true }))
    return
  }
  if (!swipeBackAllowedPath(path)) return
  e.preventDefault()
  goBack(navigate)
}

/** Called by the app root: iOS native attaches the left-edge swipe, Android native takes the back-key event; web does nothing (browsers have it built in) */
export function installBackGestures(path: () => string, navigate: NavigateFunction, env: { native: boolean; platform: string } = { native: isNative, platform }): () => void {
  if (!env.native) return () => {}
  if (env.platform === 'android') {
    const onBack = (e: Event) => handleAndroidBack(e, path(), navigate)
    window.addEventListener('0x4:back', onBack)
    return () => window.removeEventListener('0x4:back', onBack)
  }
  const root = document.getElementById('root')
  if (!root) return () => {}
  return installSwipeBack({ root, allowed: () => swipeBackAllowedPath(path()), onBack: () => goBack(navigate, 'none') })
}
