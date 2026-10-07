// 网页版绑定 X：授权走新窗口，原页面不动。
//
// 以前是整页跳到 X 再整页跳回来，页面一重载，内存里的解锁状态就没了，
// 用户绑定完回来要重新输密码（私钥只在内存里，这点不能改）。
// 现在授权在新窗口里完成，新窗口拿到结果后通知原页面并自己关掉。
//
// 原生 App 不走这里：那边是系统浏览器叠在 App 上，授权完通过 meme.wallet.app:// 深链跳回，App 一直活着。
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
 * 授权窗口回来时调用（在 App 渲染之前）。
 * 是授权窗口就把结果交给原页面并关闭自己，返回 true 让调用方不要再渲染界面。
 */
export function handleXAuthPopup(): boolean {
  const result = readResultFromUrl()
  if (!result || !window.opener || window.opener === window) return false
  try { new BroadcastChannel(CHANNEL).postMessage(result) } catch { /* 老浏览器没有 BroadcastChannel */ }
  // 兜底：跨标签页的 storage 事件
  try { localStorage.setItem(KEY, JSON.stringify({ ...result, at: Date.now() })) } catch { /* 隐私模式 */ }
  window.close()
  return true
}

/** 原页面监听授权结果。返回取消监听的函数 */
export function onXAuthResult(cb: (r: XAuthResult) => void): () => void {
  let channel: BroadcastChannel | null = null
  try {
    channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (e) => cb(e.data as XAuthResult)
  } catch { /* 忽略 */ }
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY || !e.newValue) return
    try { cb(JSON.parse(e.newValue) as XAuthResult) } catch { /* 忽略坏数据 */ }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    channel?.close()
    window.removeEventListener('storage', onStorage)
  }
}

/**
 * 打开授权窗口。弹窗被拦时退回整页跳转（那种情况下回来仍需重新解锁，但至少能绑定）。
 * 返回 true 表示走的是新窗口。
 */
export function openXAuthWindow(url: string): boolean {
  const w = window.open(url, '0x4-x-auth', 'width=600,height=760')
  if (!w) { location.href = url; return false }
  try { w.focus() } catch { /* 忽略 */ }
  return true
}
