// Liquid-glass motion for the web's light "taro white" theme (2026-10-03 goat picked Gemini direction 1 "clear lens" + direction 2 "liquid mercury"):
// 1. Ambient light: a frontmost .lq-amb layer on <body> (slow-drifting pearl glows) + faint concentric guide rings; styles and animation in light.css, hidden in dark mode.
// 2. Lenses: the top nav capsule, secondary buttons, and selected blocks in segmented controls get lens filters sized to each element (lens.ts, Chromium-only).
// 3. Liquid selection blocks: the "selected" state in segmented controls, chain filters, top nav and tabs is no longer the button's own background — it's a glass droplet drawn by the container's ::before,
//    sliding over with a stretch on switch and bouncing on arrival (position written to the container's --ix/--iy/--iw/--ih). Pseudo-elements keep React-managed nodes untouched.
// 4. Ripples: pressing a button radiates a ring of light from the press point (--rx/--ry + .lq-rip re-triggers the animation).
// 5. Mouse sheen: the glow and edge highlights on glass panels follow the cursor (--lx/--ly).
// 6. Auto-degrade: after the page settles, measure fps twice — only if both are too low (old machines, integrated GPUs) does <html> get .lq-lite, and light.css switches off lenses and the flowing background accordingly.
// Only active in the light theme and the "space" appearance (2026-10-03, data-look="space"); no motion effects when the system enables "reduce motion" (selection blocks snap into place).
import { applyLens, lensFilter, lensSupported } from './lens'

const LIT = '.wc-panel, .tx-panel, .cm-panel, .cm-pc, .cm-meetbar, .desk-need, .desk-gate-card, .sm-opt'
/** Small elements carrying lenses (few and small, easy on the GPU) */
const LENS = '.desk-bar-in, .desk-me, .desk-lang, .cm-btn.is-quiet, .wc-btn:not(.is-primary):not(.is-ghost):not(.is-up):not(.is-down):not(.is-danger):not(.is-sm)'
/** Extra floating capsules in the "space" appearance: left icon rail, brand, top-right tools (glass painted on ::before, --lens inherits onto it) */
const LENS_SPACE = '.desk-nav, .desk-brand-link, .desk-tools'
/** Liquid selection block: container / selected item / shape (pill = glass droplet tucked under, line = a stretching line underneath) */
const GROUPS: { sel: string; active: string; kind: 'pill' | 'line' }[] = [
  { sel: '.desk-nav', active: '.desk-nav-item.on', kind: 'pill' },
  { sel: '.wc-seg, .cm-seg, .tx-seg', active: ':scope > [aria-pressed="true"], :scope > [aria-selected="true"], :scope > .on', kind: 'pill' },
  { sel: '.tx-chains', active: ':scope > .on, :scope > [aria-pressed="true"]', kind: 'pill' },
  { sel: '.wc-tabs, .tx-tabs', active: ':scope > [aria-selected="true"], :scope > .on', kind: 'line' },
]
const RIPPLE = '.wc-btn, .tx-btn, .cm-btn, .wc-seg button, .cm-seg button, .tx-seg button, .tx-chains button'

const space = () => document.documentElement.dataset.look === 'space'
/** Taro white or "space": only these two appearances get glass motion */
const light = () => document.documentElement.dataset.theme === 'light' || space()
const lite = () => document.documentElement.classList.contains('lq-lite')
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export function mountLiquid(): void {
  if (typeof document === 'undefined' || document.querySelector('.lq-amb')) return
  const amb = document.createElement('div')
  amb.className = 'lq-amb'
  amb.setAttribute('aria-hidden', 'true')
  amb.innerHTML = '<i></i><i></i><i></i><i></i><b></b>'
  document.body.prepend(amb)

  // ---------- Selection blocks + lenses: recalculated together after page changes (next frame) ----------
  let placed = new WeakMap<HTMLElement, string>()
  const lensed = new Set<HTMLElement>()
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((es) => { for (const e of es) applyLens(e.target as HTMLElement); schedule() }) : null
  let raf = 0
  const schedule = () => { if (!raf) raf = requestAnimationFrame(update) }
  function update() {
    raf = 0
    if (!light()) return
    // Lenses
    if (lensSupported && !lite()) {
      for (const el of document.querySelectorAll<HTMLElement>(space() ? `${LENS}, ${LENS_SPACE}` : LENS)) {
        if (lensed.has(el)) continue
        lensed.add(el); applyLens(el); ro?.observe(el)
      }
      for (const el of lensed) if (!el.isConnected) { lensed.delete(el); ro?.unobserve(el) }
    }
    // Selection blocks
    for (const g of GROUPS) {
      for (const box of document.querySelectorAll<HTMLElement>(g.sel)) {
        const on = box.querySelector<HTMLElement>(g.active)
        if (!on || !on.offsetWidth) { box.classList.remove('lq-ind'); placed.delete(box); continue }
        const bx = box.getBoundingClientRect(), ox = on.getBoundingClientRect()
        const x = ox.left - bx.left + box.scrollLeft, y = ox.top - bx.top + box.scrollTop
        const key = `${Math.round(x)},${Math.round(y)},${Math.round(ox.width)},${Math.round(ox.height)}`
        const prev = placed.get(box)
        if (prev === key) continue
        placed.set(box, key)
        box.style.setProperty('--ix', `${x}px`); box.style.setProperty('--iy', `${y}px`)
        box.style.setProperty('--iw', `${ox.width}px`); box.style.setProperty('--ih', `${ox.height}px`)
        if (g.kind === 'pill' && lensSupported && !lite()) {
          const r = parseFloat(getComputedStyle(on).borderTopLeftRadius) || ox.height / 2
          const url = lensFilter(ox.width, ox.height, r)
          if (url) box.style.setProperty('--lens-ind', url)
        }
        if (!prev) {
          // First appearance: place directly, no slide
          box.classList.add('lq-ind', 'lq-ind-' + g.kind, 'lq-snap')
          requestAnimationFrame(() => requestAnimationFrame(() => box.classList.remove('lq-snap')))
        } else if (!reduced()) {
          // Selection changed: slide over, stretching en route (mercury's surface tension), bounce on arrival
          box.classList.remove('lq-moving'); void box.offsetWidth; box.classList.add('lq-moving')
          setTimeout(() => box.classList.remove('lq-moving'), 520)
        }
      }
    }
  }
  const mo = new MutationObserver(schedule)
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-pressed', 'aria-selected'] })
  // On appearance switch the block snaps into place (nav moves from top bar to left rail — don't fly it across from above)
  let lookKey = ''
  new MutationObserver(() => {
    const k = `${document.documentElement.dataset.theme}|${document.documentElement.dataset.look ?? ''}`
    if (k !== lookKey) { lookKey = k; placed = new WeakMap() }
    if (light()) schedule()
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-look', 'class'] })
  addEventListener('resize', schedule)
  schedule()

  // ---------- Ripples ----------
  document.addEventListener('pointerdown', (e) => {
    if (!light() || reduced()) return
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>(RIPPLE) : null
    if (!el || (el as HTMLButtonElement).disabled) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--rx', `${e.clientX - r.left}px`); el.style.setProperty('--ry', `${e.clientY - r.top}px`)
    el.classList.remove('lq-rip'); void el.offsetWidth; el.classList.add('lq-rip')
    setTimeout(() => el.classList.remove('lq-rip'), 600)
  }, { passive: true })

  if (reduced()) return

  // ---------- Mouse sheen ----------
  let cur: HTMLElement | null = null
  let ev: PointerEvent | null = null
  let praf = 0
  const clear = () => {
    if (!cur) return
    cur.classList.remove('lq-lit'); cur.style.removeProperty('--lx'); cur.style.removeProperty('--ly')
    cur = null
  }
  const tick = () => {
    praf = 0
    const e = ev
    if (!e) return
    if (!light()) { clear(); return }
    const el = (e.target instanceof Element ? e.target.closest(LIT) : null) as HTMLElement | null
    if (el !== cur) { clear(); if (el) { cur = el; el.classList.add('lq-lit') } }
    if (!cur) return
    const r = cur.getBoundingClientRect()
    cur.style.setProperty('--lx', `${Math.round(e.clientX - r.left)}px`)
    cur.style.setProperty('--ly', `${Math.round(e.clientY - r.top)}px`)
  }
  addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse') return; ev = e; if (!praf) praf = requestAnimationFrame(tick) }, { passive: true })
  document.documentElement.addEventListener('pointerleave', clear)
  addEventListener('blur', clear)

  // ---------- Auto-degrade: after the page settles (4s), measure fps for 1.5s; only two consecutive sub-40fps averages switch off the heavy effects ----------
  // A single measurement misleads: a freshly opened page is loading markets and charts, so even decent machines drop frames (verified in local preview)
  const measure = (then: (slow: boolean) => void) => {
    if (document.hidden) return
    let n = 0
    const t0 = performance.now()
    const count = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(count); else then(n / 1.5 < 40) }
    requestAnimationFrame(count)
  }
  setTimeout(() => measure((slow) => {
    if (!slow) return
    setTimeout(() => measure((again) => {
      if (!again) return
      document.documentElement.classList.add('lq-lite')
      for (const el of lensed) el.style.removeProperty('--lens')
      for (const el of document.querySelectorAll<HTMLElement>('.lq-ind')) el.style.removeProperty('--lens-ind')
    }), 2500)
  }), 4000)
}
