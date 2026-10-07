// Unexpected-refresh log (2026-09-25: goat reported the app refreshing itself while open, losing a half-typed private key).
//
// No code in the app ever refreshes on purpose; the only source is Capacitor auto-reloading the page after iOS kills the web process
// （node_modules/@capacitor/ios/…/WebViewDelegationHandler.swift webViewWebContentProcessDidTerminate）。
// A heartbeat is written here every 3 seconds (time + current page + foreground state). If at next launch the last heartbeat is less than 20 seconds old,
// And it was in the foreground at the time — a "killed-in-foreground then instantly reloaded" case, not a normal cold start → log one entry, visible under personal center's "Advanced".
// Only the latest 10 are recorded, with no account info at all.
// 2026-09-29 goat: this is a debugging log for troubleshooting — never shown in any UI of production builds; only visible under "About" in diagnostic builds (VITE_DIAG=1).
// The log itself is still written locally (readable as 0x4.reloads via web inspector), never uploaded.
import { currentRoute } from './route'
const ALIVE = '0x4.alive'
const LOG = '0x4.reloads'

export interface ReloadEvent { at: number; route: string; gapMs: number }

function read<T>(k: string, fallback: T): T {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback } catch { return fallback }
}

try {
  const last = read<{ t: number; route: string; fg: boolean } | null>(ALIVE, null)
  const now = Date.now()
  if (last && last.fg && now - last.t < 20_000) {
    const list = read<ReloadEvent[]>(LOG, [])
    list.unshift({ at: now, route: last.route, gapMs: now - last.t })
    localStorage.setItem(LOG, JSON.stringify(list.slice(0, 10)))
  }
} catch { /* Storage unavailable */ }

function beat() {
  try { localStorage.setItem(ALIVE, JSON.stringify({ t: Date.now(), route: currentRoute(), fg: !document.hidden })) } catch { /* ignore */ }
}
if (typeof window !== 'undefined') {
  beat()
  window.setInterval(beat, 3000)
  document.addEventListener('visibilitychange', beat)
}

export const reloadEvents = (): ReloadEvent[] => read<ReloadEvent[]>(LOG, [])
export const clearReloadEvents = () => { try { localStorage.removeItem(LOG) } catch { /* ignore */ } }
