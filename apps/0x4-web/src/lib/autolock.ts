// Auto-lock.
//
// Before this, `lock()` had exactly one manual call site project-wide (the settings page): leave the phone on a table
// and whoever picks it up can spend directly. A wallet can't work like that.
//
// Two triggers, one shared timeout threshold:
//   ① backgrounded / tab switched away — lock on return after the threshold
//   ② foreground but idle — lock directly past the threshold
//
// ⚠️ External browser flows must be exempt. X authorization, fiat on-ramps, etc. call Browser.open,
//    which backgrounds the app inside the native shell — returning locked out would kill the flow.
//    So external flows get a suspend / resume gate pair.
import { App } from '@capacitor/app'
import { isNative } from '@/lib/native'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'

/** One more "user is here" tick. Mouse, keyboard, and touch all count */
let lastActiveAt = Date.now()
/** When the app left the foreground; null while in the foreground */
let leftAt: number | null = null
/** > 0 means inside an external flow (e.g. X authorization) — no timing, no locking meanwhile */
let suspendDepth = 0

const touch = () => { lastActiveAt = Date.now() }

/** External browser flow starts: pause auto-lock */
export function suspendAutoLock(): void {
  suspendDepth++
  leftAt = null
}

/** External browser flow ends: resume timing, and count the "just returned" as one activity */
export function resumeAutoLock(): void {
  suspendDepth = Math.max(0, suspendDepth - 1)
  touch()
}

/** Current threshold (ms). -1 = never lock, 0 = lock the moment it leaves */
const timeout = () => useSettings.getState().autoLockMs

function lockNow(): void {
  const { wallet, lock } = useWallet.getState()
  if (wallet) lock()   // The route guard jumps to /unlock on its own when it sees the signer become null
}

function onHidden(): void {
  if (suspendDepth > 0) return
  const t = timeout()
  if (t < 0) return
  if (t === 0) { lockNow(); return }   // "Immediately" locks the moment it leaves — no waiting for return
  leftAt = Date.now()
}

function onVisible(): void {
  touch()
  if (suspendDepth > 0) { leftAt = null; return }
  const t = timeout()
  if (t < 0) { leftAt = null; return }
  if (leftAt !== null && Date.now() - leftAt >= t) lockNow()
  leftAt = null
}

/**
 * Installs the listeners. Called once for the whole app; returns the teardown function (for tests and hot reload).
 */
export function initAutoLock(): () => void {
  const acts: (keyof DocumentEventMap)[] = ['pointerdown', 'keydown', 'touchstart', 'wheel']
  acts.forEach((e) => document.addEventListener(e, touch, { passive: true, capture: true }))

  const onVis = () => (document.hidden ? onHidden() : onVisible())
  document.addEventListener('visibilitychange', onVis)

  // Native shell: backgrounding doesn't always fire visibilitychange in the webview — use Capacitor's events
  let removeNative: (() => void) | undefined
  if (isNative) {
    App.addListener('appStateChange', ({ isActive }) => (isActive ? onVisible() : onHidden()))
      .then((h) => { removeNative = () => h.remove() })
      .catch(() => {})
  }

  // Foreground idle: checking every 15 s is enough, no need for more
  const timer = window.setInterval(() => {
    if (suspendDepth > 0 || document.hidden) return
    const t = timeout()
    if (t <= 0) return   // 0 only handles backgrounding, never kicks foreground users; -1 is never
    if (Date.now() - lastActiveAt >= t) lockNow()
  }, 15_000)

  return () => {
    acts.forEach((e) => document.removeEventListener(e, touch, { capture: true }))
    document.removeEventListener('visibilitychange', onVis)
    window.clearInterval(timer)
    removeNative?.()
  }
}

/** For the settings page display. Order = option order */
export const AUTO_LOCK_OPTIONS: { label: string; value: number }[] = [
  { label: '立即', value: 0 },
  { label: '1 分钟', value: 60_000 },
  { label: '5 分钟', value: 300_000 },
  { label: '15 分钟', value: 900_000 },
  { label: '1 小时', value: 3_600_000 },
  { label: '从不', value: -1 },
]

/** For tests: force the internal timer into a given state */
export const __testing = {
  setLastActive: (ms: number) => { lastActiveAt = ms },
  setLeftAt: (ms: number | null) => { leftAt = ms },
  state: () => ({ lastActiveAt, leftAt, suspendDepth }),
}
