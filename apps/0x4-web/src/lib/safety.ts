// 用户内容的安全功能（2026-10-02 goat，App 上架前必须有）：举报、拉黑、同意条款、注销账号的前端部分。
// 服务器：server/src/contentReports.ts（举报）、rooms.ts 的 /api/blocks（拉黑）、accountDelete.ts（注销）。
import { create } from 'zustand'
import { api } from './social'

// ---------- 举报 ----------
export type ReportKind = 'post' | 'comment' | 'user' | 'room' | 'meeting' | 'dm' | 'group_message'
export type ReportReason = 'spam' | 'harassment' | 'nudity' | 'scam' | 'violence' | 'minor' | 'other'
/** 界面上的顺序和文字（文字过 t() 翻译） */
export const REPORT_REASONS: { key: ReportReason; label: string }[] = [
  { key: 'spam', label: '垃圾广告' }, { key: 'scam', label: '诈骗' }, { key: 'harassment', label: '骚扰辱骂' },
  { key: 'nudity', label: '色情低俗' }, { key: 'violence', label: '暴力威胁' }, { key: 'minor', label: '涉及未成年人' }, { key: 'other', label: '其他' },
]
/** 要举报的东西。id：动态 / 评论 / 直播间 / 会议 / 群消息的 id；举报用户或私信时传对方地址 target。name 只用来在弹层标题里显示 */
export interface ReportTarget { kind: ReportKind; id?: string; target?: string; name?: string }

export const submitReport = (r: ReportTarget, reason: ReportReason, text: string, block: boolean) =>
  api<{ ok: true; id: string; blocked: boolean }>('/api/reports', { method: 'POST', body: JSON.stringify({ kind: r.kind, id: r.id, target: r.target, reason, text: text.trim() || undefined, block }) })

/** 举报弹层全站只有一个（挂在 App 里）：任何地方调 openReport() 打开 */
export const useReport = create<{ target: ReportTarget | null; open: (r: ReportTarget) => void; close: () => void }>((set) => ({
  target: null,
  open: (r) => set({ target: r }),
  close: () => set({ target: null }),
}))
export const openReport = (r: ReportTarget) => useReport.getState().open(r)

// ---------- 拉黑 ----------
// 拉黑以后：互相看不到对方的动态和评论、不能互发私信、对方进不了我的直播间、互相取消关注、不再收到对方的通知（服务器做）；
// 群聊和直播弹幕里对方的话在我这边折叠起来（这里的名单给界面用）。
export interface BlockedUser { address: string; ts: number; nickname: string | null; avatar: string | null }
interface BlocksState {
  list: BlockedUser[]
  /** 还没读过（没登录 / 刚换号） */
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
  load: async () => { try { set({ list: await api<BlockedUser[]>('/api/blocks'), loaded: true }) } catch { /* 读不到就当没拉黑过，下次再读 */ } },
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

// ---------- 同意条款 ----------
// 创建账号（第一次登录社交功能）之前要先同意《服务条款》和《隐私政策》，其中写明不许发布违法、色情、骚扰等内容。
// 按钱包地址记在本机：同一台设备换了钱包要再同意一次；注销账号后记录清掉，重新启用要再同意。
// 条款有实质改动时把版本号加一，所有人下次打开会再看到一次。
export const TERMS_VERSION = 1
const TERMS_KEY = '0x4.terms'
const readTerms = (): Record<string, number> => { try { const v = JSON.parse(localStorage.getItem(TERMS_KEY) || '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} } }
export const termsAccepted = (address: string | null | undefined) => !!address && readTerms()[address] === TERMS_VERSION
export function acceptTerms(address: string) { try { localStorage.setItem(TERMS_KEY, JSON.stringify({ ...readTerms(), [address]: TERMS_VERSION })) } catch { /* 存不了：这次照常登录，下次再问 */ } }
export function revokeTerms(address: string) { try { const m = readTerms(); delete m[address]; localStorage.setItem(TERMS_KEY, JSON.stringify(m)) } catch { /* 同上 */ } }

/** 「需要先同意条款」的弹层：登录被条款拦下时打开；用户点了「以后再说」这次打开期间不再自动弹（主动去点还会出来） */
export const useTermsGate = create<{ open: boolean; dismissed: boolean; show: (force?: boolean) => void; hide: (dismiss?: boolean) => void }>((set, get) => ({
  open: false, dismissed: false,
  show: (force) => { if (force || !get().dismissed) set({ open: true }) },
  hide: (dismiss) => set({ open: false, dismissed: dismiss ? true : get().dismissed }),
}))

// ---------- 注销账号 ----------
export interface DeletePreview {
  staff: boolean; balance: number; earnings: number
  sprites: { id: string; name: string }[]
  groupsTransfer: { id: string; name: string }[]; groupsDissolve: { id: string; name: string }[]
  pendingEarnings: number; posts: number
}
export const previewDeleteAccount = () => api<DeletePreview>('/api/me/delete/preview')
export const deleteAccount = (forfeit: boolean) => api<{ ok: true }>('/api/me/delete', { method: 'POST', body: JSON.stringify({ confirm: 'DELETE', forfeit }) })
