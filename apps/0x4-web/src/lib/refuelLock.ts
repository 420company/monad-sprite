// 自动补燃料费的跨标签页互斥（2026-09-29 Codex 复审 P1）。
// 网页版可以同时开好几个标签，每个标签的首页都会判断「要不要自动补」。只用浏览器自带的 Web Locks（原子锁）：
// 拿到锁的标签才执行，拿不到的直接跳过（ifAvailable，不排队、不会死锁）。
// 浏览器不支持 Web Locks 时一律不自动补（本地存储做不成原子锁，多个标签可能同时拿到），只剩首页提醒和手动补充。
// Chrome 69+、Safari / iOS 15.4+、Firefox 96+ 都支持，原生 App 的 WebView 也支持。

type LockManager = { request: (name: string, opts: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<void>) => Promise<void> }

/** 是否能安全地自动补（有原子锁） */
export function canLockRefuel(nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  return typeof (nav as (Navigator & { locks?: LockManager }) | undefined)?.locks?.request === 'function'
}

/** 拿到锁才执行 fn；拿不到（别的标签正在补）或浏览器没有锁，返回 false 且不执行 */
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
