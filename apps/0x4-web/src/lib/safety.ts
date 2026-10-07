// User-content safety features (2026-10-02 goat, required before app listing): the frontend half of reporting, blocking, terms acceptance, and account deletion.
// Server: server/src/contentReports.ts (reports), rooms.ts's /api/blocks (blocks), accountDelete.ts (deletion).
import { create } from 'zustand'
import { api } from './social'

// ---------- Reporting ----------
export type ReportKind = 'post' | 'comment' | 'user' | 'room' | 'meeting' | 'dm' | 'group_message'
export type ReportReason = 'spam' | 'harassment' | 'nudity' | 'scam' | 'violence' | 'minor' | 'other'
/** Order and wording as shown in the UI (wording goes through t() translation) */
export const REPORT_REASONS: { key: ReportReason; label: string }[] = [
  { key: 'spam', label: '垃圾广告' }, { key: 'scam', label: '诈骗' }, { key: 'harassment', label: '骚扰辱骂' },
  { key: 'nudity', label: '色情低俗' }, { key: 'violence', label: '暴力威胁' }, { key: 'minor', label: '涉及未成年人' }, { key: 'other', label: '其他' },
]
/** The thing being reported. id: the feed post / comment / live room / meeting / group message id; when reporting a user or DM, pass the other address as target. name is only shown in the sheet title */
export interface ReportTarget { kind: ReportKind; id?: string; target?: string; name?: string }

export const submitReport = (r: ReportTarget, reason: ReportReason, text: string, block: boolean) =>
  api<{ ok: true; id: string; blocked: boolean }>('/api/reports', { method: 'POST', body: JSON.stringify({ kind: r.kind, id: r.id, target: r.target, reason, text: text.trim() || undefined, block }) })

/** There's a single report sheet for the whole site (mounted in App): open it from anywhere with openReport() */
export const useReport = create<{ target: ReportTarget | null; open: (r: ReportTarget) => void; close: () => void }>((set) => ({
  target: null,
  open: (r) => set({ target: r }),
  close: () => set({ target: null }),
}))
export const openReport = (r: ReportTarget) => useReport.getState().open(r)

// ---------- Blocking ----------
// After blocking: both sides stop seeing each other's posts and comments, can't DM each other, the other side can't enter my live room, follows are mutually removed, and their notifications stop arriving (server-side);
// in group chats and live danmaku, their messages collapse on my side (this list feeds the UI).
export interface BlockedUser { address: string; ts: number; nickname: string | null; avatar: string | null }
interface BlocksState {
  list: BlockedUser[]
  /** Not loaded yet (not logged in / just switched accounts) */
  loaded: boolean
  has: (address: string) => boolean
  load: () => Promise<void>
  block: (address: string) => Promise<void>
  unblock: (address: string) => Promise<void>
  reset: () => void
}
export const useBlocks = create<BlocksState>((set, get) => ({
  list: [], loaded: false,
  has: (address) => get().list.some((b) => b.address === address),
  load: async () => { try { set({ list: await api<BlockedUser[]>('/api/blocks'), loaded: true }) } catch { /* If it can't be read, treat as never blocked; try reading again next time */ } },
  block: async (address) => {
    await api(`/api/blocks/${encodeURIComponent(address)}`, { method: 'POST' })
    if (!get().has(address)) set({ list: [{ address, ts: Date.now(), nickname: null, avatar: null }, ...get().list] })
    void get().load()
  },
  unblock: async (address) => {
    await api(`/api/blocks/${encodeURIComponent(address)}`, { method: 'DELETE' })
    set({ list: get().list.filter((b) => b.address !== address) })
  },
  reset: () => set({ list: [], loaded: false }),
}))

// ---------- Terms acceptance ----------
// Before creating an account (first social-feature login), users must accept the Terms of Service and Privacy Policy, which prohibit illegal, sexual, harassing and similar content.
// Recorded locally per wallet address: switching wallets on the same device requires accepting again; records are cleared after account deletion, re-enabling requires accepting again.
// When the terms change materially, bump the version number — everyone sees them once more on next open.
export const TERMS_VERSION = 1
const TERMS_KEY = '0x4.terms'
const readTerms = (): Record<string, number> => { try { const v = JSON.parse(localStorage.getItem(TERMS_KEY) || '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} } }
export const termsAccepted = (address: string | null | undefined) => !!address && readTerms()[address] === TERMS_VERSION
export function acceptTerms(address: string) { try { localStorage.setItem(TERMS_KEY, JSON.stringify({ ...readTerms(), [address]: TERMS_VERSION })) } catch { /* Can't be stored: log in normally this time, ask again next time */ } }
export function revokeTerms(address: string) { try { const m = readTerms(); delete m[address]; localStorage.setItem(TERMS_KEY, JSON.stringify(m)) } catch { /* Same as above */ } }

/** The "accept the terms first" sheet: opens when login is blocked by terms; if the user taps "Later", it won't auto-pop again during this session (manually tapping still opens it) */
export const useTermsGate = create<{ open: boolean; dismissed: boolean; show: (force?: boolean) => void; hide: (dismiss?: boolean) => void }>((set, get) => ({
  open: false, dismissed: false,
  show: (force) => { if (force || !get().dismissed) set({ open: true }) },
  hide: (dismiss) => set({ open: false, dismissed: dismiss ? true : get().dismissed }),
}))

// ---------- Account deletion ----------
export interface DeletePreview {
  staff: boolean; balance: number; earnings: number
  sprites: { id: string; name: string }[]
  groupsTransfer: { id: string; name: string }[]; groupsDissolve: { id: string; name: string }[]
  pendingEarnings: number; posts: number
}
export const previewDeleteAccount = () => api<DeletePreview>('/api/me/delete/preview')
export const deleteAccount = (forfeit: boolean) => api<{ ok: true }>('/api/me/delete', { method: 'POST', body: JSON.stringify({ confirm: 'DELETE', forfeit }) })
