// 意外刷新记录（2026-09-25：goat 反馈 App 开着会自己刷新，输入到一半的私钥都丢了）。
//
// App 里没有任何代码会主动刷新；唯一的来源是 iOS 杀掉网页进程后，Capacitor 自动重新加载页面
// （node_modules/@capacitor/ios/…/WebViewDelegationHandler.swift webViewWebContentProcessDidTerminate）。
// 这里每 3 秒写一次心跳（时间 + 当前页面 + 是否在前台）。下次启动时如果上一次心跳离现在不到 20 秒、
// 而且当时在前台，说明是「前台被杀后立刻重载」，不是正常的冷启动 → 记一条，个人中心「高级」里能看到。
// 只记最近 10 条，不含任何账户信息。
// ★2026-09-29 goat：这是排查用的调试记录，正式构建里不在任何界面显示；诊断构建（VITE_DIAG=1）的「关于」里才看得到。
//   记录本身照常写在本机（开发者用网页检查器能读 0x4.reloads），不上传。
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
} catch { /* 存储不可用 */ }

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
