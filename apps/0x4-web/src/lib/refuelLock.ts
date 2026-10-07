// Cross-tab mutual exclusion for auto gas top-ups (2026-09-29 Codex review P1).
// The web build can have several tabs open, and each tab's home decides "should I auto top up". Uses only the browser's built-in Web Locks (atomic locks):
// only the tab holding the lock executes; others skip outright (ifAvailable — no queueing, no deadlocks).
// Where the browser lacks Web Locks, never auto top up (local storage can't be an atomic lock — multiple tabs could grab it); only the home reminder and manual top-ups remain.
// Supported on Chrome 69+, Safari / iOS 15.4+, Firefox 96+, and the native app's WebView.

type LockManager = { request: (name: string, opts: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<void>) => Promise<void> }

/** Whether auto top-up is safe (has an atomic lock) */
export function canLockRefuel(nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  return typeof (nav as (Navigator & { locks?: LockManager }) | undefined)?.locks?.request === 'function'
}

/** Run fn only with the lock held; if the lock can't be taken (another tab is topping up) or the browser has no locks, return false without running */
export async function withRefuelLock(fn: () => Promise<void>, nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): Promise<boolean> {
  const locks = (nav as (Navigator & { locks?: LockManager }) | undefined)?.locks
  if (typeof locks?.request !== 'function') return false
  let ran = false
  await locks.request('0x4-auto-refuel', { ifAvailable: true }, async (lock) => {
    if (!lock) return
    ran = true
    await fn()
  })
  return ran
}
