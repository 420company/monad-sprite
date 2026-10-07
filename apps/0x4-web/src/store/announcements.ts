// 全员公告（「0x4 官方」会话）：列表、未读数、实时事件。
//
// 不改 store/social.ts：这里订阅 social 的登录状态和 socket，自己挂一个 WebSocket 监听器，
//   登录好了 / 实时连接重连上 / App 切回前台 → 重新拉第一页（离线期间发的、撤回的都能对上）；
//   announcement 事件 → 插到最前面、未读 +1；announcement_recall 事件 → 删掉（没读过的顺带减未读）。
// 公告只有管理员在后台发，服务端按「发布时已注册」过滤，撤回的不返回。
import { create } from 'zustand'
import { api } from '@/lib/social'
import { useSocial } from './social'
import { notifyHaptic } from '@/lib/notifyHaptics'

export interface Announcement { id: number; title: string | null; body: string; image: string | null; link: string | null; createdAt: number; read: boolean }
interface ListResp { list: Announcement[]; hasMore: boolean; unread: number }

interface AnnouncementState {
  /** 新的在前 */
  list: Announcement[]
  unread: number
  hasMore: boolean
  /** 第一页拉到过（没拉到之前会话列表里不显示「0x4 官方」，免得闪一下空的） */
  loaded: boolean
  failed: boolean
  loadingMore: boolean
  load: () => Promise<void>
  loadMore: () => Promise<void>
  /** 进公告页：本地全标已读，再告诉服务器 */
  markAllRead: () => Promise<void>
  reset: () => void
}

const EMPTY = { list: [] as Announcement[], unread: 0, hasMore: false, loaded: false, failed: false, loadingMore: false }
let gen = 0   // 退出登录后丢掉还在路上的旧请求

export const useAnnouncements = create<AnnouncementState>()((set, get) => ({
  ...EMPTY,
  async load() {
    const g = gen
    try {
      const r = await api<ListResp>('/api/announcements?limit=20')
      if (g !== gen) return
      set({ list: r.list, unread: r.unread, hasMore: r.hasMore, loaded: true, failed: false })
    } catch {
      if (g === gen) set({ failed: true })
    }
  },
  async loadMore() {
    const { list, hasMore, loadingMore } = get()
    if (!hasMore || loadingMore || !list.length) return
    const g = gen
    set({ loadingMore: true })
    try {
      const r = await api<ListResp>(`/api/announcements?limit=20&before=${list[list.length - 1].id}`)
      if (g !== gen) return
      const seen = new Set(get().list.map((a) => a.id))
      set({ list: [...get().list, ...r.list.filter((a) => !seen.has(a.id))], hasMore: r.hasMore, unread: r.unread })
    } catch { /* 页面上可以再点 */ } finally { if (g === gen) set({ loadingMore: false }) }
  },
  async markAllRead() {
    if (!get().unread && get().list.every((a) => a.read)) return
    set({ unread: 0, list: get().list.map((a) => (a.read ? a : { ...a, read: true })) })
    try { await api('/api/announcements/read-all', { method: 'POST' }) } catch { /* 下次进来再标 */ }
  },
  reset() { gen++; set({ ...EMPTY }) },
}))

/** 社区的未读总数：群 + 私信 + 公告（社区页「消息」标签和底部导航「社区」上的红点用） */
export function useCommunityUnread(): number {
  const chats = useSocial((s) => { let n = 0; for (const v of Object.values(s.unreadGroup)) n += v; for (const v of Object.values(s.unreadDm)) n += v; return n })
  const ann = useAnnouncements((s) => s.unread)
  return chats + ann
}

/** WebSocket 事件（导出给测试用） */
export function handleAnnouncementEvent(d: { type?: unknown; a?: unknown; id?: unknown }) {
  const s = useAnnouncements.getState()
  if (d.type === 'announcement' && d.a && typeof d.a === 'object') {
    const a = d.a as Omit<Announcement, 'read'>
    if (typeof a.id !== 'number' || s.list.some((x) => x.id === a.id)) return
    useAnnouncements.setState({ list: [{ ...a, read: false }, ...s.list], unread: s.unread + 1, loaded: true })
    notifyHaptic('official')
  } else if (d.type === 'announcement_recall') {
    const hit = s.list.find((x) => x.id === d.id)
    if (!hit) return
    useAnnouncements.setState({ list: s.list.filter((x) => x.id !== d.id), unread: hit.read ? s.unread : Math.max(0, s.unread - 1) })
  }
}

// ── 跟着社交登录走 ──
let off: (() => void) | null = null
useSocial.subscribe((cur, prev) => {
  if (cur.socket !== prev.socket) {
    off?.()
    off = cur.socket ? (cur.socket.on((d) => handleAnnouncementEvent(d as Parameters<typeof handleAnnouncementEvent>[0])) as () => void) : null
  }
  if (cur.status === 'ready' && prev.status !== 'ready') void useAnnouncements.getState().load()
  // 实时连接断过又连上：断开期间的公告 / 撤回收不到事件，重新拉一次
  else if (cur.status === 'ready' && cur.wsStatus === 'open' && prev.wsStatus !== 'open' && useAnnouncements.getState().loaded) void useAnnouncements.getState().load()
  if (cur.status === 'idle' && prev.status !== 'idle') useAnnouncements.getState().reset()
})
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && useSocial.getState().status === 'ready') void useAnnouncements.getState().load()
  })
}
