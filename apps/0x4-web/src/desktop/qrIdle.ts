// 扫码登录的公共电脑（手机上选了「仅本次登录」）：长时间没人在用就自动退出（2026-10-01 goat：网吧、公司电脑扫码后忘了退出）。
// 「信任此设备」的电脑不走这里（登录保留 30 天，不因没操作退出）。插件 / 钱包登录也不走这里。
// 服务器按「最后活跃」判断（server/src/auth.ts WEB_QR_*）：30 分钟没有活动弹窗，再给 2 分钟，到 32 分钟失效。这里负责：
//   1. 只有真的在用才告诉服务器「还在用」，最多一分钟一次——不是定时器。算在用的（服务器也只认这几种）：
//      input = 点、按键、滚轮、触摸；speak = 在会议 / 直播里自己正在说话（只看 LiveKit 给的「正在说话」，不录音不上传）；
//      chat = 发消息；gift = 送礼。只是开着页面看、听都不算。
//   2. 30 分钟没有这些活动，弹「系统检测到您长时间未进行任何操作，是否停止当前服务？」；2 分钟内不点就自动退出。
import { api } from '@/lib/social'

/** 多久没活动弹窗 */
export const IDLE_MS = 30 * 60_000
/** 弹窗后再等多久自动退出 */
export const GRACE_MS = 2 * 60_000
/** 两次「还在用」最少隔多久 */
export const PING_GAP_MS = 60_000
/** 算作「真的在操作」的输入事件（鼠标移动不算：鼠标碰一下桌子不代表有人在） */
export const ACTIVE_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
/** 算「在用」的活动类型（和服务器 WEB_ACTIVE_KINDS 一致） */
export type ActivityKind = 'input' | 'speak' | 'chat' | 'gift'

export type IdleStage = 'ok' | 'warn' | 'out'
/** 距离上一次活动多久：还好 / 该弹窗 / 该退出 */
export function idleStage(now: number, lastActive: number, idleMs = IDLE_MS, graceMs = GRACE_MS): IdleStage {
  const idle = now - lastActive
  if (idle >= idleMs + graceMs) return 'out'
  if (idle >= idleMs) return 'warn'
  return 'ok'
}
/** 这次活动要不要告诉服务器（离上次告诉超过一分钟才发） */
export const shouldPing = (now: number, lastPing: number, gap = PING_GAP_MS) => now - lastPing >= gap

/** 告诉服务器「还在用」，带上是哪种活动；会话已经失效时服务器回 401，api() 会走统一的「登录已失效」处理 */
export const pingActive = (token: string, kind: ActivityKind = 'input') =>
  api<{ ok: true; expiresAt?: number | null }>('/api/auth/web-active', { method: 'POST', body: JSON.stringify({ kind }) }, { token })

export interface IdleWatcher { stop: () => void; touch: (kind?: ActivityKind) => void }

// 当前页面正在盯着的那一个（会议、直播、聊天、礼物面板直接调 reportActivity，不用层层传）
let current: IdleWatcher | null = null
/** 页面里发生了算「在用」的事：自己在说话、发了消息、送了礼。没有扫码登录（没在盯）时什么都不做 */
export function reportActivity(kind: ActivityKind) { current?.touch(kind) }

/**
 * 盯着这一页的活动。onStage 在阶段变化时回调（warn = 弹窗，out = 退出）。
 * 计时用每 15 秒看一次「离上次活动多久」，不靠一个 30 分钟的长定时器（电脑睡眠醒来后长定时器不准）。
 * ★弹窗出来以后，只有点「继续使用」（或调 touch）才续；弹窗期间别的输入不算（不然鼠标碰一下就关掉了，人可能已经走了）。
 */
export function watchIdle(opts: { onStage: (s: IdleStage) => void; ping: (kind: ActivityKind) => Promise<unknown>; now?: () => number; target?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>; tickMs?: number }): IdleWatcher {
  const now = opts.now ?? Date.now
  const target = opts.target ?? window
  let lastActive = now(), lastPing = now(), stage: IdleStage = 'ok', stopped = false
  const set = (s: IdleStage) => { if (s !== stage) { stage = s; opts.onStage(s) } }
  const touch = (kind: ActivityKind = 'input') => {
    if (stopped || stage === 'out') return
    const t = now()
    lastActive = t
    set('ok')
    if (shouldPing(t, lastPing)) { lastPing = t; void opts.ping(kind).catch(() => { /* 401 由统一处理退出；网络错误下次活动再报 */ }) }
  }
  // 页面上的真实操作：弹窗出来以后不算（要点按钮）
  const onInput = () => { if (stage === 'ok') touch('input') }
  const tick = () => { if (!stopped) set(idleStage(now(), lastActive)) }
  for (const e of ACTIVE_EVENTS) target.addEventListener(e, onInput, { passive: true, capture: true } as AddEventListenerOptions)
  const timer = setInterval(tick, opts.tickMs ?? 15_000)
  const w: IdleWatcher = {
    touch,
    stop: () => {
      stopped = true
      clearInterval(timer)
      for (const e of ACTIVE_EVENTS) target.removeEventListener(e, onInput, { capture: true } as EventListenerOptions)
      if (current === w) current = null
    },
  }
  current = w
  return w
}
