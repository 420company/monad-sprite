// Phone scans to log in to 0x4 Meet on desktop (meet.420.meme).
// The QR shown on the computer encodes ox4meet:<loginId>:<challenge>; after scanning, the phone first tells the server "scanned" (the computer shows "please confirm on your phone"),
// the token is only issued to the computer once the user taps "Log in" in the confirm sheet. Desktop tokens work for meetings and livestreams only — the server enforces a whitelist.
import { api } from '@/lib/social'
import { isNative } from './native'
import { t } from '@/lib/i18n'
import type { MeetQr } from '@/lib/meetQr'
export { parseLoginQr, parseMeetQr, type LoginQr, type MeetQr } from '@/lib/meetQr'

/** kind: meet = 0x4 Meet; admin = admin backend (expires automatically after 8 hours, expiresAt is the expiry time) */
/** kind: meet = meeting / game desktop, admin = admin backend, web = scan-logged-in 0x4 web (2026-10-01); region = rough region code (e.g. TH) */
/** trusted: "trust this device" was chosen during web scan login (kept 30 days) */
export interface MeetSession { id: string; kind?: 'meet' | 'admin' | 'web'; device: string; region?: string | null; createdAt: number; lastSeen: number; expiresAt?: number | null; trusted?: boolean }

/** Open the camera to scan a QR code, return the content; null on user cancel. The plugin loads on demand, stays out of the main bundle */
export async function scanQrCode(): Promise<string | null> {
  // Web (phone browser) uses the camera; the native app uses the system scan plugin
  if (!isNative) return (await import('./webQrScan')).webScanQr()
  const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } = await import('@capacitor/barcode-scanner')
  try {
    const r = await CapacitorBarcodeScanner.scanBarcode({ hint: CapacitorBarcodeScannerTypeHint.QR_CODE, scanInstructions: t('对准电脑上的二维码'), scanButton: false })
    return r?.ScanResult || null
  } catch (e) {
    // User cancelled: the plugin throws, messages differ per platform — treat all as cancel
    const msg = e instanceof Error ? e.message : String(e)
    if (/cancel/i.test(msg)) return null
    throw e
  }
}

export const meetScan = (q: MeetQr) => api<{ kind?: 'meet' | 'admin'; app?: 'meet' | 'game' | 'web'; role?: string; device: string; region?: string | null; createdAt: number; expiresAt: number }>(`/api/meet/login/${q.loginId}/scan`, { method: 'POST', body: JSON.stringify({ challenge: q.challenge }) })
/** trust: "trust this device" was chosen on the phone during web scan login (login kept 30 days); omitted = this session only */
export const meetApprove = (q: MeetQr, trust?: boolean) => api<{ ok: true; device: string; trusted?: boolean }>(`/api/meet/login/${q.loginId}/approve`, { method: 'POST', body: JSON.stringify(trust === undefined ? { challenge: q.challenge } : { challenge: q.challenge, trust }) })
export const meetDeny = (q: MeetQr) => api<{ ok: true }>(`/api/meet/login/${q.loginId}/deny`, { method: 'POST', body: JSON.stringify({ challenge: q.challenge }) })
export const listMeetSessions = () => api<MeetSession[]>('/api/me/meet-sessions')
export const removeMeetSession = (id: string) => api<{ ok: true }>(`/api/me/meet-sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
/** Log out everywhere: all scan-logged-in computers sign out together */
export const removeAllMeetSessions = () => api<{ ok: true; count: number }>('/api/me/meet-sessions', { method: 'DELETE' })
