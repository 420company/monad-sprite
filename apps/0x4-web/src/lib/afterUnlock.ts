// 建好 / 解锁钱包以后回哪（2026-10-04 从 App.tsx 挪出来，建钱包页 Onboarding 也要用）：
// 用手机相机扫电脑登录码进来的 /pc-login、从分享链接进来看直播的 /watch/…，进钱包后回到那里，不丢到首页。
// 记在 sessionStorage 0x4.afterUnlock；渲染时只读不删（开发模式会渲染两次），到了 /pc-login 页再清。
export const AFTER_UNLOCK = '0x4.afterUnlock'

export function takeAfterUnlock(): string {
  try { const v = sessionStorage.getItem(AFTER_UNLOCK); return v && (v.startsWith('/pc-login') || v.startsWith('/watch/')) ? v : '/' } catch { return '/' }
}
