// 「动钱才验证」的闸门（2026-09-25）。
//
// 以前整个 App 挡在解锁页后面：锁着就什么都看不了，App 一关再开就得重新输密码 / 刷脸。
// 现在（仅原生 App）拆成两层：
//   看    —— 社交登录令牌和私信密钥存在本机安全存储里，打开就能刷动态、收发私信
//   动钱  —— 签名器是「带闸的」：真要签名时才检查钱包解没解锁，没解锁就弹验证面板，
//            验过了继续签，用户取消就抛 UnlockCancelled，调用方按普通失败处理
//
// 本模块不引用钱包 store（避免循环依赖）：是否已解锁由 store 通过 setUnlockedCheck 告诉这里，
// 验证面板（components/UnlockSheet）订阅 useUnlockPrompt 显示。
import { create } from 'zustand'

export class UnlockCancelled extends Error {
  constructor() { super('已取消') }
}

interface PromptState { open: boolean; reason: string }
export const useUnlockPrompt = create<PromptState>(() => ({ open: false, reason: '' }))

let isUnlocked: () => boolean = () => false
let waiters: { resolve: () => void; reject: (e: Error) => void }[] = []
const lockListeners = new Set<() => void>()

export function setUnlockedCheck(fn: () => boolean): void { isUnlocked = fn }

/**
 * 网页版连着 0x4 插件时，解锁交给插件（请插件弹它自己的解锁窗口），不弹本机验证面板（网页版没有那个面板，
 * 2026-10-06 插件锁了网页不再登出之后，网页上「锁着」成了常态，不交给插件的话这里会一直等）。
 * 钱包 store 挂上插件时设置、摘掉时清掉
 */
let externalUnlock: (() => Promise<void>) | null = null
export function setExternalUnlock(fn: (() => Promise<void>) | null): void { externalUnlock = fn }

/** 签名前调用。已解锁直接过；否则弹验证面板（网页版插件：请插件解锁），同时来的多个请求共用一次验证 */
export function ensureUnlocked(reason = '确认这笔操作'): Promise<void> {
  if (isUnlocked()) return Promise.resolve()
  if (externalUnlock) return externalUnlock()
  return new Promise((resolve, reject) => {
    waiters.push({ resolve, reject })
    if (!useUnlockPrompt.getState().open) useUnlockPrompt.setState({ open: true, reason })
  })
}

/** 验证面板收尾：ok = 已解锁，false = 用户取消 */
export function finishUnlock(ok: boolean): void {
  const pending = waiters
  waiters = []
  useUnlockPrompt.setState({ open: false })
  pending.forEach((w) => (ok ? w.resolve() : w.reject(new UnlockCancelled())))
}

/** 钱包锁定时通知（例如合约交易的代理密钥缓存要跟着清） */
export function onLock(fn: () => void): () => void {
  lockListeners.add(fn)
  return () => lockListeners.delete(fn)
}
export function notifyLock(): void { lockListeners.forEach((fn) => fn()) }
