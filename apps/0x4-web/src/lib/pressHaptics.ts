// Light tap haptics (2026-09-29 goat: "nowadays phone wallets give a quick subtle buzz every time you tap a function key").
// Only effective in the native app; web doesn't vibrate. One capture-phase click listener on document covers everything — no per-button wiring.
//
// Why click instead of pointerdown: at the moment a finger lands, it's unknown whether this is a tap or the start of a scroll. Starting a swipe on a list row or button
// would buzz first on pointerdown — one buzz per page scroll, very noisy; click only fires after a genuine tap (no scroll, no long-press drag-away),
// and scrolling, long-press drags or typing in an input never land a click on a button — so they naturally don't buzz, matching native button feel.
// Hooked on document at capture phase: not even stopPropagation in a component can intercept it, guaranteeing every tap is caught.
//
// Handling duplicate buzzes: when a component calls tap() itself (e.g. recording start) on the same tap as this listener, tap()'s throttling merges them into one;
// success / failure use the system notification haptic (hapticResult), which is more distinct — kept as-is, not overridden here.
import { isNative, tap } from '@/lib/native'
import { useSettings } from '@/store/settings'

/** Elements counted as "function keys" */
const PRESSABLE = [
  'button', 'a[href]', 'summary', 'select', 'label',
  '[role="button"]', '[role="tab"]', '[role="switch"]', '[role="menuitem"]', '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]', '[role="option"]', '[role="radio"]', '[role="checkbox"]', '[role="link"]',
  'input[type="checkbox"]', 'input[type="radio"]', 'input[type="button"]', 'input[type="submit"]',
  // Whole tappable cards (e.g. tapping feed body text into the detail) are marked with cursor-pointer; individual elements can opt in with data-haptic
  '.cursor-pointer', '[data-haptic]',
].join(',')

/** Input-class elements: tapped for typing, don't buzz */
const TYPING = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="range"]), textarea, [contenteditable=""], [contenteditable="true"]'

/** Whether this tap should buzz: returns the hit function key, or null when it shouldn't */
export function hapticTarget(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null
  if (target.closest('[data-haptic="off"]')) return null
  if (target.closest(TYPING)) return null
  const el = target.closest(PRESSABLE)
  if (!el) return null
  // Disabled buttons don't buzz (clicks on icons/text inside a disabled button still reach children per the browser)
  if (el.closest(':disabled, [aria-disabled="true"]')) return null
  // A label counts as a key only when wrapping a switch (checkbox, radio); a label wrapping an input is tapped for typing
  if (el instanceof HTMLLabelElement) {
    const c = el.control
    if (!(c instanceof HTMLInputElement) || (c.type !== 'checkbox' && c.type !== 'radio') || c.disabled) return null
  }
  return el
}

/** Call once at the app root; returns the cleanup function. Web doesn't hook it at all */
export function installPressHaptics(doc: Document = document): () => void {
  if (!isNative) return () => {}
  const onClick = (e: MouseEvent) => {
    if (!useSettings.getState().pressHaptics) return
    if (hapticTarget(e.target)) tap()
  }
  doc.addEventListener('click', onClick, true)
  return () => doc.removeEventListener('click', onClick, true)
}
