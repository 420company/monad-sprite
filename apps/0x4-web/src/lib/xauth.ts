// Web X binding: authorization runs in a new window; the original page stays put.
//
// It used to be a full-page hop to X and back; a page reload wiped the in-memory unlock state,
// so users returning from binding had to re-enter their password (private keys live only in memory — that can't change).
// Now authorization completes in a new window, which notifies the original page with the result and closes itself.
//
// The native app doesn't go through here: there a system browser overlays the app, and after authorization it deep-links back via meme.wallet.app:// — the app stays alive throughout.
import { routeQuery } from './route'
const CHANNEL = '0x4.x-auth'
const KEY = '0x4.x-auth-result'

export interface XAuthResult {
  x: string
  reason?: string | null
}

function readResultFromUrl(): XAuthResult | null {
  const q = routeQuery()
  const x = q.get('x')
  return x ? { x, reason: q.get('reason') } : null
}

/**
 * Called when returning in the authorization window (before App renders).
 * If this is the auth window, hand the result to the original page and close itself, returning true so the caller skips rendering the UI.
 */
export function handleXAuthPopup(): boolean {
  const result = readResultFromUrl()
  if (!result || !window.opener || window.opener === window) return false
  try { new BroadcastChannel(CHANNEL).postMessage(result) } catch { /* Old browsers lack BroadcastChannel */ }
  // Fallback: cross-tab storage events
  try { localStorage.setItem(KEY, JSON.stringify({ ...result, at: Date.now() })) } catch { /* Private mode */ }
  window.close()
  return true
}

/** The original page listens for the authorization result. Returns the unsubscribe function */
export function onXAuthResult(cb: (r: XAuthResult) => void): () => void {
  let channel: BroadcastChannel | null = null
  try {
    channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (e) => cb(e.data as XAuthResult)
  } catch { /* Ignore */ }
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY || !e.newValue) return
    try { cb(JSON.parse(e.newValue) as XAuthResult) } catch { /* Ignore bad data */ }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    channel?.close()
    window.removeEventListener('storage', onStorage)
  }
}

/**
 * Open the authorization window. When popups are blocked, fall back to a full-page redirect (unlocking is still required on return, but binding works at least).
 * Returns true when the new-window path was used.
 */
export function openXAuthWindow(url: string): boolean {
  const w = window.open(url, '0x4-x-auth', 'width=600,height=760')
  if (!w) { location.href = url; return false }
  try { w.focus() } catch { /* Ignore */ }
  return true
}
