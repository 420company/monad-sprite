// Global key-press "halo" animation (2026-09-26 goat picked #3 of six candidates: the element stays put; press breathes out a same-color soft ring from the edge, slowly retracting on release).
//
// No button components touched: catch pointerdown on document, find the pressed button / link-button, add .tap-halo;
// on pointerup / pointercancel swap to .tap-halo-out for a 0.5s halo fade, then remove the class.
// The halo is drawn outside the button's own rendering via filter: drop-shadow: no layout cost, not clipped by the button's overflow:hidden,
// doesn't override the button's own box-shadow, and needs no inner elements. Color follows the theme accent (--color-accent).
// Skipped with the OS "reduce motion"; skipped on disabled buttons.

const SELECTOR = 'button, [role="button"], a.ui-button, .ui-button, .icon-button, .welcome-cta, .pearl-button, .tab, .chip, .seg > *'

let installed = false

export function installTapRipple() {
  if (installed || typeof document === 'undefined') return
  installed = true
  let active: HTMLElement | null = null
  let timer = 0
  const release = () => {
    const el = active
    if (!el) return
    active = null
    el.classList.remove('tap-halo'); el.classList.add('tap-halo-out')
    window.clearTimeout(timer)
    timer = window.setTimeout(() => el.classList.remove('tap-halo-out'), 600)
  }
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const target = e.target as Element | null
    const el = target?.closest?.(SELECTOR) as HTMLElement | null
    if (!el || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return
    const cs = getComputedStyle(el)
    if (cs.display === 'inline' || cs.visibility === 'hidden') return
    release()
    active = el
    el.classList.remove('tap-halo-out'); el.classList.add('tap-halo')
  }, { passive: true, capture: true })
  document.addEventListener('pointerup', release, { passive: true, capture: true })
  document.addEventListener('pointercancel', release, { passive: true, capture: true })
}
