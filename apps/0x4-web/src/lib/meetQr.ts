// 电脑端扫码登录二维码的解析（纯函数，单独放一个文件方便测试）
// 两种码：ox4meet:<loginId>:<challenge> = 0x4 Meet（meet.420.meme）；ox4admin:<loginId>:<challenge> = 管理后台（lord.420.meme，只有工作人员能登录）
export interface MeetQr { loginId: string; challenge: string }
export type LoginKind = 'meet' | 'admin'
export interface LoginQr extends MeetQr { kind: LoginKind }

/** 解析二维码内容；不是 0x4 电脑端登录码返回 null */
export function parseLoginQr(raw: string): LoginQr | null {
  let v = String(raw || '').trim()
  // 网址格式（2026-09-27）：https://app.420.meme/#/pc-login?c=<码>，手机自带相机扫了能直接打开 App 网页版确认。
  // 只从里面取出码本身再按原格式校验，网址的域名不影响结果（码里的 challenge 才是凭证）
  const u = /[?&]c=([^&#]+)/.exec(v)
  if (/^https?:\/\//i.test(v) && u) { try { v = decodeURIComponent(u[1]).trim() } catch { return null } }
  const m = /^ox4(meet|admin):([A-Za-z0-9_-]{16,64}):([A-Za-z0-9_-]{16,64})$/.exec(v)
  return m ? { kind: m[1] as LoginKind, loginId: m[2], challenge: m[3] } : null
}

/** 只认 0x4 Meet 的码（老接口，保留给已有调用） */
export function parseMeetQr(raw: string): MeetQr | null {
  const q = parseLoginQr(raw)
  return q && q.kind === 'meet' ? { loginId: q.loginId, challenge: q.challenge } : null
}
