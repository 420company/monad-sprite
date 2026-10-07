// 手机扫码登录电脑端 0x4 Meet（meet.420.meme）。
// 电脑上显示的二维码内容是 ox4meet:<loginId>:<challenge>；手机扫到后先告诉服务器「已扫码」（电脑上显示「请在手机上确认」），
// 用户在确认弹层点「登录」才真正发令牌给电脑。电脑端令牌只能用会议和直播，服务器按白名单拦截。
import { api } from '@/lib/social'
import { isNative } from './native'
import { t } from '@/lib/i18n'
import type { MeetQr } from '@/lib/meetQr'
export { parseLoginQr, parseMeetQr, type LoginQr, type MeetQr } from '@/lib/meetQr'

/** kind: meet = 0x4 Meet；admin = 管理后台（8 小时后自动失效，expiresAt 是失效时间） */
/** kind：meet = 会议 / 游戏电脑端，admin = 管理后台，web = 扫码登录的 0x4 网页版（2026-10-01）；region = 大致地区代码（如 TH） */
/** trusted：网页版扫码时选了「信任此设备」（保留 30 天） */
export interface MeetSession { id: string; kind?: 'meet' | 'admin' | 'web'; device: string; region?: string | null; createdAt: number; lastSeen: number; expiresAt?: number | null; trusted?: boolean }

/** 打开相机扫一个二维码，返回内容；用户取消返回 null。插件按需加载，不进主包 */
export async function scanQrCode(): Promise<string | null> {
  // 网页版（手机浏览器）用摄像头扫；原生 App 用系统扫码插件
  if (!isNative) return (await import('./webQrScan')).webScanQr()
  const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } = await import('@capacitor/barcode-scanner')
  try {
    const r = await CapacitorBarcodeScanner.scanBarcode({ hint: CapacitorBarcodeScannerTypeHint.QR_CODE, scanInstructions: t('对准电脑上的二维码'), scanButton: false })
    return r?.ScanResult || null
  } catch (e) {
    // 用户点了取消：插件抛错，信息各平台不同，一律当取消
    const msg = e instanceof Error ? e.message : String(e)
    if (/cancel/i.test(msg)) return null
    throw e
  }
}

export const meetScan = (q: MeetQr) => api<{ kind?: 'meet' | 'admin'; app?: 'meet' | 'game' | 'web'; role?: string; device: string; region?: string | null; createdAt: number; expiresAt: number }>(`/api/meet/login/${q.loginId}/scan`, { method: 'POST', body: JSON.stringify({ challenge: q.challenge }) })
/** trust：网页版扫码时手机上选了「信任此设备」（登录保留 30 天）；不传 = 仅本次登录 */
export const meetApprove = (q: MeetQr, trust?: boolean) => api<{ ok: true; device: string; trusted?: boolean }>(`/api/meet/login/${q.loginId}/approve`, { method: 'POST', body: JSON.stringify(trust === undefined ? { challenge: q.challenge } : { challenge: q.challenge, trust }) })
export const meetDeny = (q: MeetQr) => api<{ ok: true }>(`/api/meet/login/${q.loginId}/deny`, { method: 'POST', body: JSON.stringify({ challenge: q.challenge }) })
export const listMeetSessions = () => api<MeetSession[]>('/api/me/meet-sessions')
export const removeMeetSession = (id: string) => api<{ ok: true }>(`/api/me/meet-sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
/** 全部下线：所有扫码登录的电脑一起退出 */
export const removeAllMeetSessions = () => api<{ ok: true; count: number }>('/api/me/meet-sessions', { method: 'DELETE' })
