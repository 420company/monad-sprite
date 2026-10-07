// 自动锁定。
//
// 在此之前，`lock()` 全项目只有设置页那一个手动入口在调：手机往桌上一放，
// 谁拿起来都能直接花钱。钱包不能这样。
//
// 两个触发源，用同一个超时阈值：
//   ① 切后台 / 切标签页  —— 离开超过阈值，回来就锁
//   ② 就在前台但没人动   —— 闲置超过阈值直接锁
//
// ⚠️ 外部浏览器流程必须豁免。X 授权、法币入金这些会调 Browser.open，
//    原生壳里等于把 App 切到后台，回来就被锁在门外，流程直接断掉。
//    所以给外部流程留了 suspend / resume 一对闸。
import { App } from '@capacitor/app'
import { isNative } from '@/lib/native'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'

/** 记满一次「人还在」。鼠标、键盘、触摸都算 */
let lastActiveAt = Date.now()
/** 离开前台的时刻；在前台时为 null */
let leftAt: number | null = null
/** > 0 表示正处在外部流程里（例如 X 授权），这期间不计时也不锁 */
let suspendDepth = 0

const touch = () => { lastActiveAt = Date.now() }

/** 外部浏览器流程开始：暂停自动锁定 */
export function suspendAutoLock(): void {
  suspendDepth++
  leftAt = null
}

/** 外部浏览器流程结束：恢复计时，并把「刚回来」算成一次活动 */
export function resumeAutoLock(): void {
  suspendDepth = Math.max(0, suspendDepth - 1)
  touch()
}

/** 当前阈值（毫秒）。-1 = 从不锁，0 = 一离开就锁 */
const timeout = () => useSettings.getState().autoLockMs

function lockNow(): void {
  const { wallet, lock } = useWallet.getState()
  if (wallet) lock()   // 路由守卫看到签名器变 null 会自己跳到 /unlock
}

function onHidden(): void {
  if (suspendDepth > 0) return
  const t = timeout()
  if (t < 0) return
  if (t === 0) { lockNow(); return }   // 「立即」就是离开当场锁，不等回来
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
 * 装上监听。整个 App 只调一次，返回卸载函数（给测试和热更新用）。
 */
export function initAutoLock(): () => void {
  const acts: (keyof DocumentEventMap)[] = ['pointerdown', 'keydown', 'touchstart', 'wheel']
  acts.forEach((e) => document.addEventListener(e, touch, { passive: true, capture: true }))

  const onVis = () => (document.hidden ? onHidden() : onVisible())
  document.addEventListener('visibilitychange', onVis)

  // 原生壳：切后台时 webview 不一定触发 visibilitychange，要用 Capacitor 的事件
  let removeNative: (() => void) | undefined
  if (isNative) {
    App.addListener('appStateChange', ({ isActive }) => (isActive ? onVisible() : onHidden()))
      .then((h) => { removeNative = () => h.remove() })
      .catch(() => {})
  }

  // 前台闲置：每 15 秒看一眼就够，没必要更密
  const timer = window.setInterval(() => {
    if (suspendDepth > 0 || document.hidden) return
    const t = timeout()
    if (t <= 0) return   // 0 只管切后台，前台不踢人；-1 是从不
    if (Date.now() - lastActiveAt >= t) lockNow()
  }, 15_000)

  return () => {
    acts.forEach((e) => document.removeEventListener(e, touch, { capture: true }))
    document.removeEventListener('visibilitychange', onVis)
    window.clearInterval(timer)
    removeNative?.()
  }
}

/** 供设置页展示用。顺序即选项顺序 */
export const AUTO_LOCK_OPTIONS: { label: string; value: number }[] = [
  { label: '立即', value: 0 },
  { label: '1 分钟', value: 60_000 },
  { label: '5 分钟', value: 300_000 },
  { label: '15 分钟', value: 900_000 },
  { label: '1 小时', value: 3_600_000 },
  { label: '从不', value: -1 },
]

/** 测试用：把内部计时器摆到指定状态 */
export const __testing = {
  setLastActive: (ms: number) => { lastActiveAt = ms },
  setLeftAt: (ms: number | null) => { leftAt = ms },
  state: () => ({ lastActiveAt, leftAt, suspendDepth }),
}
