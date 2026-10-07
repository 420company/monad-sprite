/**
 * 浏览器说用户刚操作过（点击、按键后几秒内）。不支持这个接口的浏览器一律当「没有」，宁可不弹。
 * 网页版用它判断「这次插件弹窗是不是用户自己点出来的」：页面自己在后台发起的签名 / 登录不许把插件窗口弹出来
 * （desktop/walletGate.ts needSocialLogin、store/social.ts 插件锁着时的登录）
 */
export function userActing(): boolean {
  const ua = typeof navigator !== 'undefined' ? (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation : undefined
  return !!ua?.isActive
}
