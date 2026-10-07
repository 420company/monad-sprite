// Handling for the web (app.420.meme) opening the old version on first open after an update (2026-09-26).
//
// Cause: previously vite-plugin-pwa's registerType: 'autoUpdate' + the auto-injected registerSW.js only registered the Service Worker.
// The new SW takes over immediately once installed (skipWaiting + clientsClaim), but the current page already booted from the old SW's cached old bundle,
// and nothing swapped it to the new bundle — so one more refresh was needed to get the new version.
//
// Now: register the SW ourselves (injectRegister: false in vite.config), check for updates once the page loads.
//   · the new SW takes over within 5s of page open, the user hasn't clicked / pressed a key / typed yet, and the page is in the foreground → auto-refresh once (barely noticeable);
//   · otherwise show a bottom "new version available, tap to refresh" banner for the user to tap (goat hates the app refreshing itself — worst when it wipes mid-typing input).
// Loop guard: record the time in sessionStorage before auto-refreshing; if one already happened within 60s, only show the banner.
// First install (the page wasn't controlled by any SW before) doesn't count as an update: the page was already the latest bundle from the network.
// Also check once when returning to the foreground (the page-left-open-for-long case) — well past 5s by then, so only the banner shows.
// Web only: native app builds (CAPACITOR_BUILD) and preview builds have no SW, __PWA__ is false — this does nothing there.
import { create } from 'zustand'

declare const __PWA__: boolean

export const usePwaUpdate = create<{ ready: boolean }>()(() => ({ ready: false }))

const AUTO_WINDOW = 5000
const LOOP_GUARD = 60_000
const KEY = '0x4.swAutoReload'

export function reloadForUpdate() { location.reload() }

/** Whether a new SW taking over may auto-refresh directly (pure function, unit-tested) */
export function canAutoReload(s: { hadController: boolean; sinceLoad: number; interacted: boolean; typing: boolean; visible: boolean; sinceLastAuto: number }): boolean {
  return s.hadController && s.sinceLoad <= AUTO_WINDOW && !s.interacted && !s.typing && s.visible && s.sinceLastAuto > LOOP_GUARD
}

export function initPwaUpdate(): void {
  if (typeof __PWA__ === 'undefined' || !__PWA__) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const sw = navigator.serviceWorker
  const loadedAt = Date.now()
  // Controlled by a SW at page load = this page may be the old bundle from the old cache; not controlled = first install, the page itself is new
  const hadController = !!sw.controller
  let interacted = false
  const mark = () => { interacted = true }
  const events = ['pointerdown', 'keydown', 'input', 'wheel'] as const
  events.forEach((e) => window.addEventListener(e, mark, { capture: true, passive: true }))
  setTimeout(() => events.forEach((e) => window.removeEventListener(e, mark, { capture: true })), AUTO_WINDOW + 1000)

  let handled = false
  sw.addEventListener('controllerchange', () => {
    if (!hadController || handled) return
    handled = true
    const active = document.activeElement
    const typing = active instanceof HTMLElement && (active.matches('input, textarea, select') || active.isContentEditable)
    let recent = 0
    try { recent = Number(sessionStorage.getItem(KEY)) || 0 } catch { /* Storage unavailable */ }
    const canAuto = canAutoReload({ hadController, sinceLoad: Date.now() - loadedAt, interacted, typing,
      visible: document.visibilityState === 'visible', sinceLastAuto: Date.now() - recent })
    if (canAuto) {
      try { sessionStorage.setItem(KEY, String(Date.now())) } catch { /* Storage unavailable: rather skip auto-refresh; the banner below still shows */ return void usePwaUpdate.setState({ ready: true }) }
      reloadForUpdate()
    } else usePwaUpdate.setState({ ready: true })
  })

  const register = () => {
    sw.register('/sw.js', { scope: '/' }).then((reg) => {
      // Registration itself checks once; check once more explicitly so a stale sw.js from HTTP cache isn't used
      reg.update().catch(() => {})
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {})
      })
    }).catch(() => { /* Registration failure doesn't affect usage */ })
  }
  // Don't wait for load: checking earlier gives a better chance of taking over within 5s (the old page already came from the SW cache, so we're not racing it for network)
  register()
}
