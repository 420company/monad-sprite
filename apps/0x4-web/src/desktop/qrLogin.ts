// Web: log in by scanning with the 0x4 mobile app (2026-10-01 goat: meet.420.meme retired, meetings are web-only; computers without the extension can still log in to meet and watch live).
// The server flow mirrors the old meet desktop QR scan (server/src/meetAuth.ts); start carries app:'web': after confirmation the issued token is a web token (same kind as extension logins).
// The QR code contains the URL https://app.420.meme/#/pc-login?c=ox4meet:…: scanning in the mobile app — or with the phone's own camera — opens the confirmation page (src/pages/PcLogin.tsx).
// The pollKey lives only in this computer's memory — photographing the QR code can't yield the token.
import { api } from '@/lib/social'

export type QrLoginStatus = 'pending' | 'scanned' | 'approved' | 'denied' | 'expired'
interface StartRes { loginId: string; pollKey: string; qr: string; expiresAt: number; ttl: number }
interface PollRes { status: QrLoginStatus; token?: string; expiresAt?: number; trusted?: boolean }

/** The URL the phone opens for confirmation: the mobile app's web version (app.420.meme); confirmation must use the phone's wallet, not the desktop web app itself */
const PHONE_BASE = 'https://app.420.meme'
export const phoneConfirmUrl = (qr: string, base: string = PHONE_BASE) => `${base}/#/pc-login?c=${encodeURIComponent(qr)}`

export interface QrLoginHandle {
  /** The QR code's content (a URL) */
  url: string
  expiresAt: number
  /** End: approved carries the token (trusted = "trust this device" was chosen on the phone, login lasts 30 days); rejections / expiry / cancellation carry none */
  done: Promise<{ status: QrLoginStatus; token?: string; trusted?: boolean }>
  cancel: () => void
}

/**
 * Start one QR login: fetch the QR code, then long-poll for the phone's confirmation. onStatus fires on every status change (scanned → the page shows "please confirm on your phone").
 * The QR code expires in 3 minutes (server-set); callers just begin again after expiry.
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
        // 404 = the QR code is dead (long expired / server restarted): treat as expired; on network errors, rest briefly and ask again
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
