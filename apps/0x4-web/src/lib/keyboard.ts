// Soft-keyboard following (native app).
//
// 2026-09-24 on-device: the unlock page's password field was covered by the keyboard. 2026-09-25 goat: every page with an input gets covered by the keyboard.
// Previously iOS used resize: 'body', which only shortened the body while the WebView itself stayed the same:
// pages with less than a screen of content had no scrollable slack, so bottom inputs stayed under the keyboard; h-dvh chat pages and sheets didn't shorten either.
// Now switched to resize: 'native' (capacitor.config.ts): the whole WebView shortens when the keyboard appears,
// so 100dvh / fixed positioning / sheets all land above the keyboard automatically; this module only handles:
//   1. --kb-h = the part of the keyboard still overlapping the page (excluding what the WebView already yielded, to avoid double-subtracting)
//   2. html.kb-open: hide the floating tab bar while the keyboard is open, so it doesn't sit on top of the keyboard covering the input
//   3. scroll the current input into view after the keyboard appears (internal scroll regions in pages and sheets included)
import { Keyboard } from '@capacitor/keyboard'
import { isNative } from '@/lib/native'

let baseline = 0 // Viewport height with the keyboard closed
let kbHeight = 0

const viewportHeight = () => window.visualViewport?.height ?? window.innerHeight

function update() {
  const root = document.documentElement
  const overlap = kbHeight ? Math.max(0, Math.round(kbHeight - (baseline - viewportHeight()))) : 0
  root.style.setProperty('--kb-h', `${overlap}px`)
  root.classList.toggle('kb-open', kbHeight > 0)
  return overlap
}

function scrollParent(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return (document.scrollingElement as HTMLElement) || document.documentElement
}

function reveal() {
  const el = document.activeElement
  if (!(el instanceof HTMLElement) || !el.matches('input, textarea, select, [contenteditable="true"]')) return
  const overlap = update()
  const scroller = scrollParent(el)
  const isRoot = scroller === document.scrollingElement || scroller === document.documentElement
  const vv = window.visualViewport
  const visTop = (vv?.offsetTop ?? 0) + (isRoot ? 0 : Math.max(0, scroller.getBoundingClientRect().top))
  let visBottom = (vv ? vv.offsetTop + vv.height : window.innerHeight) - overlap
  if (!isRoot) visBottom = Math.min(visBottom, scroller.getBoundingClientRect().bottom)
  const r = el.getBoundingClientRect()
  // For multiline inputs, only guarantee the top half around the cursor stays visible
  const bottom = Math.min(r.bottom, r.top + 120)
  let delta = 0
  if (bottom > visBottom - 16) delta = bottom - visBottom + 16
  else if (r.top < visTop + 12) delta = r.top - visTop - 12
  if (!delta) return
  scroller.scrollBy({ top: delta, behavior: 'smooth' })
}

// Web (app.420.meme in a phone browser): the browser won't shorten 100dvh for the keyboard — only visualViewport shrinks.
// Use it to compute the keyboard's overlapping height into --kb-h; full-screen layouts in chat pages / live rooms subtract it, landing the input bar above the keyboard.
function installWebFollow() {
  const vv = window.visualViewport
  if (!vv) return
  const root = document.documentElement
  const sync = () => {
    const overlap = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
    const open = overlap > 80 // Anything smaller is most likely the address bar collapsing, not the keyboard
    root.style.setProperty('--kb-h', `${open ? overlap : 0}px`)
    root.classList.toggle('kb-open', open)
    // iOS Safari pushes the whole page up on focus; under full-screen layouts the pushed-up part becomes dead space — push it back
    if (open && vv.offsetTop > 0 && document.querySelector('[data-fullscreen-layout]')) window.scrollTo(0, 0)
  }
  vv.addEventListener('resize', sync)
  vv.addEventListener('scroll', sync)
  document.addEventListener('focusin', () => setTimeout(() => { sync(); reveal() }, 300))
}

export function installKeyboardFollow() {
  if (!isNative) { installWebFollow(); return }
  baseline = viewportHeight()
  const onResize = () => { if (!kbHeight) baseline = viewportHeight(); else update() }
  window.addEventListener('resize', onResize)
  window.visualViewport?.addEventListener('resize', onResize)
  Keyboard.addListener('keyboardWillShow', (info) => { kbHeight = info.keyboardHeight; update() }).catch(() => {})
  // The WebView's shortening is animated; scroll after it finishes, plus a follow-up pass in case the first measurement caught a mid-animation value
  Keyboard.addListener('keyboardDidShow', () => { requestAnimationFrame(reveal); setTimeout(reveal, 250) }).catch(() => {})
  Keyboard.addListener('keyboardWillHide', () => { kbHeight = 0; update() }).catch(() => {})
  // Switching to another input while the keyboard is already open
  document.addEventListener('focusin', () => { if (kbHeight) setTimeout(reveal, 50) })
}
