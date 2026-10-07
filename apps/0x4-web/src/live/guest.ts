// 游客（从分享链接进来、没登录）：能看 15 秒，之后弹登录框（2026-09-30 goat）。纯函数单独放，方便测试
export const GUEST_FREE_MS = 15_000
export function guestGateOpen(elapsedMs: number, loggedIn: boolean): boolean { return !loggedIn && elapsedMs >= GUEST_FREE_MS }
