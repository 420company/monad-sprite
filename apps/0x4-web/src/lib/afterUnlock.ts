// Where to go after creating / unlocking a wallet (moved out of App.tsx on 2026-10-04 — the Onboarding wallet-creation page needs it too):
// /pc-login (arrived by scanning the computer's login code with the phone camera) and /watch/… (arrived from a share link to watch a stream) return there after entering the wallet — never dumped on the home page.
// Stored in sessionStorage as 0x4.afterUnlock; read-not-deleted during render (dev mode renders twice) — cleared once the /pc-login page is reached.
export const AFTER_UNLOCK = '0x4.afterUnlock'

export function takeAfterUnlock(): string {
  try { const v = sessionStorage.getItem(AFTER_UNLOCK); return v && (v.startsWith('/pc-login') || v.startsWith('/watch/')) ? v : '/' } catch { return '/' }
}
