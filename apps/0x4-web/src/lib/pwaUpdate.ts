// 网页版（app.420.meme）更新后第一次打开还是旧版的处理（2026-09-26）。
//
// 原因：以前用 vite-plugin-pwa 的 registerType: 'autoUpdate' + 自动注入的 registerSW.js，只负责注册 Service Worker。
// 新版 SW 装好后会立刻接管（skipWaiting + clientsClaim），但当前这一页已经用旧 SW 缓存里的旧包跑起来了，
// 没有任何代码让它换成新包，所以要再刷新一次才是新版。
//
// 现在：自己注册 SW（vite.config 里 injectRegister: false），页面一加载就检查一次更新。
//   · 新 SW 在页面打开后 5 秒内接管、用户还没点过 / 按过键 / 输入过，而且页面在前台 → 自动刷新一次（用户几乎察觉不到）；
//   · 否则底部弹一条「有新版本，点这里刷新」，由用户自己点（goat 反感 App 自己刷新，输入到一半被刷掉最糟）。
// 防循环：自动刷新前在 sessionStorage 记时间，60 秒内已经自动刷过一次就不再自动刷，只弹提示。
// 第一次安装（之前这页没有被任何 SW 控制）不算更新：那时页面本来就是从网络拿的最新包。
// 回到前台时也检查一次更新（网页开着放很久的情况），那时早过了 5 秒，只会弹提示。
// 只在网页版生效：原生 App 打包（CAPACITOR_BUILD）和预览包没有 SW，__PWA__ 为 false，这里什么都不做。
import { create } from 'zustand'

declare const __PWA__: boolean

export const usePwaUpdate = create<{ ready: boolean }>()(() => ({ ready: false }))

const AUTO_WINDOW = 5000
const LOOP_GUARD = 60_000
const KEY = '0x4.swAutoReload'

export function reloadForUpdate() { location.reload() }

/** 新 SW 接管时能不能直接自动刷新（纯函数，单测覆盖） */
export function canAutoReload(s: { hadController: boolean; sinceLoad: number; interacted: boolean; typing: boolean; visible: boolean; sinceLastAuto: number }): boolean {
  return s.hadController && s.sinceLoad <= AUTO_WINDOW && !s.interacted && !s.typing && s.visible && s.sinceLastAuto > LOOP_GUARD
}

export function initPwaUpdate(): void {
  if (typeof __PWA__ === 'undefined' || !__PWA__) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const sw = navigator.serviceWorker
  const loadedAt = Date.now()
  // 页面加载时就已经被 SW 控制 = 这一页可能是旧缓存里的旧包；没被控制 = 首次安装，页面本身就是新的
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
    try { recent = Number(sessionStorage.getItem(KEY)) || 0 } catch { /* 存储不可用 */ }
    const canAuto = canAutoReload({ hadController, sinceLoad: Date.now() - loadedAt, interacted, typing,
      visible: document.visibilityState === 'visible', sinceLastAuto: Date.now() - recent })
    if (canAuto) {
      try { sessionStorage.setItem(KEY, String(Date.now())) } catch { /* 存储不可用：宁可不自动刷，下面照样能提示 */ return void usePwaUpdate.setState({ ready: true }) }
      reloadForUpdate()
    } else usePwaUpdate.setState({ ready: true })
  })

  const register = () => {
    sw.register('/sw.js', { scope: '/' }).then((reg) => {
      // 注册本身会查一次；显式再查一次，保证不走 HTTP 缓存里的旧 sw.js
      reg.update().catch(() => {})
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {})
      })
    }).catch(() => { /* 注册失败不影响使用 */ })
  }
  // 不等 load：越早查越可能赶在 5 秒内接管（旧页面本来就是从 SW 缓存出来的，不跟它抢网络）
  register()
}
