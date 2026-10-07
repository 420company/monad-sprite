// Full-screen page sheets (decided 2026-09-18: no bottom drawers; cover the whole screen with back and close buttons); the native dialog handles focus isolation and stacking, sliding in from the right.
import { useId, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { LiquidLayer } from '@/components/LiquidBackground'
import { createPortal } from 'react-dom'
import { ArrowLeft, X } from 'lucide-react'
import { ToastHost } from './Toast'
import { t } from '@/lib/i18n'
import { WEB_SURFACE } from '@/lib/surface'
import { useWide } from '@/desktop/useWide'

const openSheets = new Set<HTMLDialogElement>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const topSheet = () => [...openSheets].at(-1)
const hiddenElements = new Map<HTMLElement, string | null>()
const notifyStack = () => {
  const top = topSheet()
  hiddenElements.forEach((value, element) => value === null ? element.removeAttribute('aria-hidden') : element.setAttribute('aria-hidden', value))
  hiddenElements.clear()
  if (top && typeof top.showModal !== 'function') {
    for (const element of document.body.children) {
      if (!(element instanceof HTMLElement) || element === top || element.tagName === 'SCRIPT') continue
      hiddenElements.set(element, element.getAttribute('aria-hidden'))
      element.setAttribute('aria-hidden', 'true')
    }
  }
  listeners.forEach(listener => listener())
}
let previousOverflow = ''
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const ease = 'cubic-bezier(.2,.8,.2,1)'
// Half sheets rise from the bottom: ease-out-cubic, with a gentler early segment than the curve above. WebKit hands animations to the system compositor a frame or two late before they appear,
// and with a steep early curve (tried the iOS bottom sheet's .32,.72,0,1) the first frame already shows it halfway up — it still looks "flashed" in
const halfEase = 'cubic-bezier(.33,1,.68,1)'

export default function Sheet({ open, onClose, title, children, dismissible = true, half: halfProp = false, center: centerProp = false }: {
  open: boolean; onClose: () => void; title?: string; children: ReactNode; dismissible?: boolean
  /** Half sheet: rises from the bottom, fixed 60% of screen height, with the page peeking out above (gifting in live rooms needs the stream visible).
   *  ★ Fixed height rather than max-h: with async content (gift lists for gifting, quotes for trading), a content-sized panel suddenly grows taller after opening
   *  (2026-09-26 simulator recording: the gifting panel started 417px tall, jumped to 524px when the gift list arrived). Overflow scrolls inside the panel. */
  half?: boolean
  /** Centered dialog: fades and scales in at screen center, not bottom-anchored, not covering the bottom nav (short list picks like "more chains" on Discover, 2026-09-26 goat) */
  center?: boolean
}) {
  // Web wide screens (VITE_SURFACE=web, ≥ 900px): always a centered modal (docs/WEB_DESIGN.md: desktop must not use mobile bottom sheets / full-screen sheets),
  // 440 wide, radius 14, solid panel, 60% black scrim, no background blur; the title bar has only a title and close — no mobile back arrow. The mobile app is unaffected (WEB_SURFACE is always false).
  const wide = useWide()
  const desk = WEB_SURFACE && wide
  const center = centerProp || desk
  const half = halfProp && !desk
  // The "collapsed / expanded" positions of the three sheet types: full-screen slides in from the right, half rises from the bottom, centered dialogs scale-fade in place
  const OFF = center ? 'scale(.94)' : half ? 'translateY(100%)' : 'translateX(100%)'
  const ON = center ? 'scale(1)' : half ? 'translateY(0)' : 'translateX(0)'
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const scrim = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const fallback = useRef(false)
  const latest = useRef({ onClose, dismissible })
  latest.current = { onClose, dismissible }
  const closing = useRef(false)
  const animations = useRef<Animation[]>([])

  const stopAnimation = () => {
    const transform = panel.current ? getComputedStyle(panel.current).transform : 'none'
    const panelOpacity = panel.current ? getComputedStyle(panel.current).opacity : '1'
    const opacity = scrim.current ? getComputedStyle(scrim.current).opacity : '1'
    animations.current.forEach(animation => animation.cancel())
    animations.current = []
    if (panel.current) { panel.current.style.transform = transform; if (center) panel.current.style.opacity = panelOpacity }
    if (scrim.current) scrim.current.style.opacity = opacity
  }

  const moveTo = (transform: string, opacity: string, duration: number, done?: () => void) => {
    const easing = half || center ? halfEase : ease
    stopAnimation()
    if (!panel.current || !scrim.current) return
    if (reduceMotion() || duration === 0) {
      panel.current.style.transform = transform
      scrim.current.style.opacity = opacity
      done?.()
      return
    }
    // Centered dialogs also fade (0 opacity to opaque) on top of scaling; full-screen / half sheets only move position
    const fade = center ? [{ opacity: panel.current.style.opacity || (transform === ON ? '0' : '1') }, { opacity: transform === ON ? '1' : '0' }] : null
    const a = panel.current.animate(fade ? [{ transform: panel.current.style.transform, ...fade[0] }, { transform, ...fade[1] }] : [{ transform: panel.current.style.transform }, { transform }], { duration, easing, fill: 'forwards' })
    const b = scrim.current.animate([{ opacity: scrim.current.style.opacity }, { opacity }], { duration, easing, fill: 'forwards' })
    animations.current = [a, b]
    // ★ Can't just await a.finished: when an animation is paused (page in background, system throttling) or cancelled, it never resolves on time,
    //   and the close flow gets stuck halfway with the dialog invisibly blocking the whole page. A timer guarantees completion — whichever fires first wins.
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (panel.current) {
        panel.current.style.transform = transform
        // The centered dialog's fade must also settle at its final value: previously only position settled, so after a cancelled animation the panel snapped back to the pre-intro opacity 0,
        // looking like it "opened and vanished in half a second" while the dialog was actually still open blocking the page (2026-09-26 activity page / Discover "more")
        if (center) panel.current.style.opacity = transform === ON ? '' : '0'
      }
      if (scrim.current) scrim.current.style.opacity = opacity
      a.cancel(); b.cancel()
      if (animations.current[0] === a) animations.current = []
      done?.()
    }
    const timer = setTimeout(() => {
      if (animations.current[0] !== a) return   // Already superseded by a newer animation; don't fight for it
      finish()
    }, duration + 150)
    a.finished.then(() => { if (animations.current[0] === a) finish() }).catch(() => {})
  }

  const close = (instant = false) => {
    if (closing.current || !latest.current.dismissible || !dialog.current?.hasAttribute('open')) return
    closing.current = true
    moveTo(OFF, '0', instant ? 0 : 180, () => {
      latest.current.onClose()
      // ★ Fallback: when the outer layer doesn't set open back to false, the dialog stays open modally with its content off-screen,
      //   blocking the entire page — nothing tappable (2026-09-24 on-device). If it's still open after a beat, close it directly.
      setTimeout(() => {
        const modal = dialog.current
        if (modal?.hasAttribute('open') && closing.current) {
          if (typeof modal.close === 'function') modal.close()
          modal.removeAttribute('open')
          openSheets.delete(modal)
          notifyStack()
          if (!openSheets.size) document.body.style.overflow = previousOverflow
        }
      }, 400)
    })
  }

  useLayoutEffect(() => {
    const modal = dialog.current
    if (!open || !modal) return
    closing.current = false
    // ★ Confirmed 2026-09-24 on-device (iOS 26.6): with the panel starting off-screen to the right, focusing the title made WebKit ignore preventScroll,
    //   scrolling the dialog a full screen horizontally to "reveal" the title; once the panel slid into place it ended up entirely off the left edge (left=-390),
    //   with the dialog still open modally → the whole page frozen. overflow-clip makes the dialog unscrollable; one more guard here: if it gets scrolled off, scroll it right back.
    const unscroll = () => {
      if (!modal.scrollLeft && !modal.scrollTop) return
      modal.scrollLeft = 0; modal.scrollTop = 0
    }
    modal.addEventListener('scroll', unscroll)
    if (!openSheets.size) {
      previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    openSheets.add(modal)
    const keyboard = document.activeElement?.matches(':focus-visible')
    fallback.current = typeof modal.showModal !== 'function'
    // iOS 15.0–15.3 has no showModal; this layer takes over focus isolation and top-layer dismissal.
    if (fallback.current) {
      modal.setAttribute('open', '')
      modal.style.display = 'block'
      modal.style.zIndex = String(100 + openSheets.size)
    } else modal.showModal()
    heading.current?.focus({ preventScroll: true })
    notifyStack()
    // First two frames: panel sits at its final position but fully transparent, letting WebKit paint the panel content first (off-screen content isn't painted — see the start comment below)
    if (panel.current) { panel.current.style.transform = 'none'; panel.current.style.opacity = '0' }
    if (scrim.current) scrim.current.style.opacity = '0'
    // ★ Entrance animation waits for the panel to paint one frame first (measured 2026-09-26 on simulator recording): the sheet's first paint has to draw the whole panel
    //   (dozens of shadowed chain-list buttons and icons) — that frame takes 50–130ms. Starting the animation right here meant the animation clock was already running
    //   while the picture was stuck on the first frame; by the time painting finished, most of the 220ms animation had elapsed → the panel looked like it "flashed" into place with no rise / slide-in.
    //   The first attempt ("park off-screen and wait a frame") didn't work: recordings still showed the panel at 85% height the moment it appeared — WebKit doesn't paint off-screen parts,
    //   only painting when the animation starts and the panel enters the screen. So the first two frames keep the panel at its final position but transparent (content paints, invisible),
    //   and after two requestAnimationFrames (= that frame has been committed) it snaps off-screen, restores opacity, and starts the animation.
    //   The panel carries will-change: transform — it's its own compositor layer from the start, so no layer "promotion" repaints it when the animation begins.
    //   rAF doesn't run with the page in the background; a 120ms timer backs it up — whichever fires first wins.
    let started = false, raf1 = 0, raf2 = 0
    const start = () => {
      if (started) return
      started = true
      cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); clearTimeout(startTimer)
      if (closing.current) return   // Closed before it started: the close animation has taken over; the panel just stays transparent
      if (panel.current) { panel.current.style.transform = OFF; panel.current.style.opacity = center ? '0' : '' }
      moveTo(ON, '1', keyboard ? 0 : half ? 320 : center ? 220 : 220)
    }
    const startTimer = setTimeout(start, 120)
    if (keyboard) start()
    else raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(start) })
    // ★ Watchdog: 1.5s after opening the panel is still off-screen and not closing = stuck (dialog open but invisible, whole page blocked).
    //   Full-screen sheets slide in from the right — check horizontally; half sheets rise from the bottom — check vertically (horizontal is always on-screen, so a horizontal-only check would miss it).
    const offscreen = () => {
      const rect = panel.current?.getBoundingClientRect()
      if (!rect) return false
      const w = window.innerWidth, h = modal.getBoundingClientRect().bottom || window.innerHeight
      if (rect.left >= w - 2 || rect.right <= 2) return true
      // Half sheet: the panel's top edge has fallen below the visible area's bottom (or the whole thing flew above) = invisible
      return half && (rect.top >= h - 2 || rect.bottom <= 2)
    }
    const watchdog = setTimeout(() => {
      if (!panel.current || closing.current || !modal.hasAttribute('open')) return
      if (offscreen()) {
        unscroll()
        if (!offscreen()) return
        closing.current = true
        latest.current.onClose()
      }
    }, 1500)

    // visualViewport shrinks with the soft keyboard; scroll only inside the sheet, preserving the background's reading position.
    let frame = 0
    const fitViewport = () => {
      const viewport = window.visualViewport
      modal.style.top = `${viewport?.offsetTop ?? 0}px`
      modal.style.height = `${viewport?.height ?? window.innerHeight}px`
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const active = document.activeElement
        const scroll = content.current
        if (!(active instanceof HTMLElement) || !scroll?.contains(active)) return
        const item = active.getBoundingClientRect(), area = scroll.getBoundingClientRect()
        if (item.bottom > area.bottom - 12) scroll.scrollTop += item.bottom - area.bottom + 12
        else if (item.top < area.top + 12) scroll.scrollTop -= area.top + 12 - item.top
      })
    }
    fitViewport()
    window.visualViewport?.addEventListener('resize', fitViewport)
    window.visualViewport?.addEventListener('scroll', fitViewport)
    window.addEventListener('resize', fitViewport)
    modal.addEventListener('focusin', fitViewport)
    const guardFocus = (event: FocusEvent) => {
      if (fallback.current && topSheet() === modal && event.target instanceof Node && !modal.contains(event.target)) heading.current?.focus({ preventScroll: true })
    }
    const escape = (event: KeyboardEvent) => {
      if (!fallback.current || topSheet() !== modal || event.key !== 'Escape') return
      event.preventDefault(); event.stopImmediatePropagation(); close(true)
    }
    if (fallback.current) {
      document.addEventListener('focusin', guardFocus)
      document.addEventListener('keydown', escape, true)
    }
    return () => {
      clearTimeout(watchdog)
      clearTimeout(startTimer); cancelAnimationFrame(raf1); cancelAnimationFrame(raf2)
      cancelAnimationFrame(frame)
      window.visualViewport?.removeEventListener('resize', fitViewport)
      window.visualViewport?.removeEventListener('scroll', fitViewport)
      window.removeEventListener('resize', fitViewport)
      modal.removeEventListener('focusin', fitViewport)
      document.removeEventListener('focusin', guardFocus)
      document.removeEventListener('keydown', escape, true)
      modal.removeEventListener('scroll', unscroll)
      animations.current.forEach(animation => animation.cancel())
      animations.current = []
      if (fallback.current) {
        modal.removeAttribute('open'); modal.style.display = 'none'
      } else modal.close()
      openSheets.delete(modal)
      notifyStack()
      if (!openSheets.size) document.body.style.overflow = previousOverflow
      if (fallback.current && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
    // Callback updates don't reopen the sheet, so focus and dragging aren't disturbed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])


  return createPortal(
    <dialog ref={dialog} role="dialog" aria-labelledby={id} aria-modal="true"
      className="fixed inset-x-0 bottom-auto m-0 h-dvh max-h-none w-full max-w-none overflow-clip border-0 bg-transparent p-0 text-fg outline-none backdrop:bg-transparent"
      onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); close(true) }}
      onKeyDown={event => {
        if (event.key !== 'Tab' || !dialog.current || event.target instanceof Element && event.target.closest('dialog') !== dialog.current) return
        const nodes = [...dialog.current.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')].filter(el => el.tabIndex >= 0 && !el.matches(':disabled, [inert]') && el.getClientRects().length)
        const first = nodes[0], last = nodes.at(-1)
        if (!first) { event.preventDefault(); heading.current?.focus(); return }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }}>
      {open && <>
        <div ref={scrim} className={`absolute inset-0 ${desk ? 'bg-black/60' : half ? 'bg-black/15' : 'bg-black/45'}`} aria-hidden="true" onClick={() => close(false)} />
        <div className={`pointer-events-none relative flex h-full justify-center ${half ? 'items-end' : center ? 'items-center px-6' : ''}`}>
          <div ref={panel} data-sheet-panel className={desk
            ? 'desk-modal pointer-events-auto flex w-full max-w-[440px] max-h-[min(86dvh,780px)] flex-col overflow-hidden rounded-[14px] will-change-transform'
            : `pointer-events-auto flex will-change-transform w-full flex-col sheet-glass shadow-2xl ${half ? 'max-w-[480px] h-[60%] overflow-hidden rounded-t-3xl' : center ? 'max-w-[420px] max-h-[70%] overflow-hidden rounded-3xl' : 'max-w-[480px] h-full'}`}>
            {!desk && <LiquidLayer />}
            {desk ? (
              <header className="desk-modal-head">
                <h2 id={id} ref={heading} tabIndex={-1} className="min-w-0 flex-1 truncate outline-none">{title || t('详情')}</h2>
                <button type="button" disabled={!dismissible} onClick={event => close(event.detail === 0)} className="desk-modal-x" aria-label={t('关闭')} title={t('关闭')}><X size={18} /></button>
              </header>
            ) : (
            <header className={`flex shrink-0 items-center gap-2 border-b border-line px-3 pb-2 ${half || center ? 'pt-2' : 'pt-[max(8px,env(safe-area-inset-top))]'}`}>
              <button type="button" disabled={!dismissible} onClick={event => close(event.detail === 0)} className="icon-button" aria-label={t('返回')} title={t('返回')}><ArrowLeft size={22} /></button>
              <h2 id={id} ref={heading} tabIndex={-1} className="min-w-0 flex-1 truncate text-lg font-semibold outline-none">{title || t('详情')}</h2>
              <button type="button" disabled={!dismissible} onClick={event => close(event.detail === 0)} className="icon-button" aria-label={t('关闭')} title={t('关闭')}><X size={20} /></button>
            </header>
            )}
            <div ref={content} data-sheet-content className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4 ${desk ? 'pb-5' : center ? 'no-scrollbar pb-5' : half ? 'no-scrollbar pb-[max(24px,env(safe-area-inset-bottom))]' : 'pb-[max(24px,env(safe-area-inset-bottom))]'}`}>{children}</div>
          </div>
        </div>
        <SheetFeedback modal={dialog} />
      </>}
    </dialog>, document.body,
  )
}

// The native top layer would cover the page's ToastHost; reuse the same notification source only at the topmost layer.
function SheetFeedback({ modal }: { modal: RefObject<HTMLDialogElement | null> }) {
  const top = useSyncExternalStore(subscribe, topSheet)
  return top === modal.current ? <div role="status" aria-live="polite" aria-atomic="true" className="pointer-events-none [&>div]:absolute [&>div]:top-[max(16px,env(safe-area-inset-top))]"><ToastHost /></div> : null
}
