// Parse desktop scan-login QR codes (pure functions, in a standalone file for easy testing)
// Two code kinds: ox4meet:<loginId>:<challenge> = 0x4 Meet (meet.420.meme); ox4admin:<loginId>:<challenge> = admin backend (lord.420.meme, staff only)
export interface MeetQr { loginId: string; challenge: string }
export type LoginKind = 'meet' | 'admin'
export interface LoginQr extends MeetQr { kind: LoginKind }

/** Parse QR content; null when it's not a 0x4 desktop login code */
export function parseLoginQr(raw: string): LoginQr | null {
  let v = String(raw || '').trim()
  // URL format (2026-09-27): https://app.420.meme/#/pc-login?c=<code> — a phone's stock camera scan opens the app web build's confirm page directly.
  // Only the code itself is extracted and validated in the original format — the URL's domain doesn't affect the result (the challenge inside the code is the credential)
  const u = /[?&]c=([^&#]+)/.exec(v)
  if (/^https?:\/\//i.test(v) && u) { try { v = decodeURIComponent(u[1]).trim() } catch { return null } }
  const m = /^ox4(meet|admin):([A-Za-z0-9_-]{16,64}):([A-Za-z0-9_-]{16,64})$/.exec(v)
  return m ? { kind: m[1] as LoginKind, loginId: m[2], challenge: m[3] } : null
}

/** Only accept 0x4 Meet codes (legacy API, kept for existing callers) */
export function parseMeetQr(raw: string): MeetQr | null {
  const q = parseLoginQr(raw)
  return q && q.kind === 'meet' ? { loginId: q.loginId, challenge: q.challenge } : null
}
