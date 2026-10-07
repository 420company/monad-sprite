// 网页版：用 0x4 手机 App 扫码登录（2026-10-01 goat：meet.420.meme 下线，会议只留网页版；电脑上没装插件也能登录开会、看直播）。
// 服务器流程和以前 meet 电脑端扫码一样（server/src/meetAuth.ts），start 时带 app:'web'：确认后发下来的是网页版令牌（和插件登录同一种）。
// 二维码内容是网址 https://app.420.meme/#/pc-login?c=ox4meet:…：手机 App 里扫、或者手机自带相机扫都能打开确认页（src/pages/PcLogin.tsx）。
// pollKey 只在这台电脑的内存里，别人拍到二维码也拿不到令牌。
import { api } from '@/lib/social'

export type QrLoginStatus = 'pending' | 'scanned' | 'approved' | 'denied' | 'expired'
interface StartRes { loginId: string; pollKey: string; qr: string; expiresAt: number; ttl: number }
interface PollRes { status: QrLoginStatus; token?: string; expiresAt?: number; trusted?: boolean }

/** 手机打开确认页的网址：手机 App 网页版（app.420.meme），确认要用手机上的钱包，不能是电脑网页版自己 */
const PHONE_BASE = 'https://app.420.meme'
export const phoneConfirmUrl = (qr: string, base: string = PHONE_BASE) => `${base}/#/pc-login?c=${encodeURIComponent(qr)}`

export interface QrLoginHandle {
  /** 二维码里的内容（网址） */
  url: string
  expiresAt: number
  /** 结束：approved 带令牌（trusted = 手机上选了「信任此设备」，登录保留 30 天）；被拒 / 过期 / 取消不带 */
  done: Promise<{ status: QrLoginStatus; token?: string; trusted?: boolean }>
  cancel: () => void
}

/**
 * 发起一次扫码登录：拿二维码，然后长轮询等手机确认。onStatus 每次状态变化回调一次（已扫码 → 页面写「请在手机上确认」）。
 * 二维码 3 分钟过期（服务器定），过期后调用方重新 begin 一次即可。
 */
export async function beginQrLogin(onStatus: (s: QrLoginStatus) => void, opts: { fetchImpl?: typeof api } = {}): Promise<QrLoginHandle> {
  const call = opts.fetchImpl ?? api
  const s = await call<StartRes>('/api/meet/login/start', { method: 'POST', body: JSON.stringify({ app: 'web' }) }, { anonymous: true })
  let stopped = false
  const done = (async () => {
    let known: QrLoginStatus = 'pending'
    for (;;) {
      if (stopped) return { status: known }
      let r: PollRes
      try {
        r = await call<PollRes>(`/api/meet/login/${encodeURIComponent(s.loginId)}?status=${known}`, { headers: { 'x-poll-key': s.pollKey } }, { anonymous: true })
      } catch (e) {
        // 404 = 二维码已失效（过期很久 / 服务器重启）：当成过期；网络错误歇一下再问
        if ((e as { status?: number }).status === 404) return { status: 'expired' as const }
        await new Promise((res) => setTimeout(res, 2000))
        continue
      }
      if (stopped) return { status: known }
      if (r.status !== known) { known = r.status; onStatus(known) }
      if (r.status === 'approved') return { status: 'approved' as const, token: r.token, trusted: r.trusted === true }
      if (r.status === 'denied' || r.status === 'expired') return { status: r.status }
    }
  })()
  return { url: phoneConfirmUrl(s.qr), expiresAt: s.expiresAt, done, cancel: () => { stopped = true } }
}
