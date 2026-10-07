// Broadcast announcements (the "0x4 Official" conversation): list, unread count, realtime events.
//
// Don't touch store/social.ts: this subscribes to social's login state and socket, mounting its own WebSocket listener,
//   Logged in / realtime reconnected / app back to foreground → re-pull the first page (posts and recalls from the offline period all line up);
//   announcement event → insert at the front, unread +1; announcement_recall event → remove (decrement unread for the unread ones).
// Announcements are only published by admins in the backend; the server filters by "registered at publish time", and recalled ones aren't returned.
import { create } from 'zustand'
import { api } from '@/lib/social'
import { useSocial } from './social'
import { notifyHaptic } from '@/lib/notifyHaptics'

export interface Announcement { id: number; title: string | null; body: string; image: string | null; link: string | null; createdAt: number; read: boolean }
interface ListResp { list: Announcement[]; hasMore: boolean; unread: number }

interface AnnouncementState {
  /** Newest first */
  list: Announcement[]
  unread: number
  hasMore: boolean
  /** The first page has been pulled (before that, the conversation list doesn't show "0x4 Official" — avoids flashing an empty one) */
  loaded: boolean
  failed: boolean
  loadingMore: boolean
  load: () => Promise<void>
  loadMore: () => Promise<void>
  /** Entering the announcements page: mark all read locally, then tell the server */
  markAllRead: () => Promise<void>
  reset: () => void
}

const EMPTY = { list: [] as Announcement[], unread: 0, hasMore: false, loaded: false, failed: false, loadingMore: false }
let gen = 0   // After logout, drop in-flight old requests

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
    } catch { /* Can be tapped again on the page */ } finally { if (g === gen) set({ loadingMore: false }) }
  },
  async markAllRead() {
    if (!get().unread && get().list.every((a) => a.read)) return
    set({ unread: 0, list: get().list.map((a) => (a.read ? a : { ...a, read: true })) })
    try { await api('/api/announcements/read-all', { method: 'POST' }) } catch { /* Mark again next time in */ }
  },
  reset() { gen++; set({ ...EMPTY }) },
}))

/** Community unread total: groups + DMs + announcements (drives the red dot on the community page's "Messages" tab and the bottom nav's "Community" tab) */
export function useCommunityUnread(): number {
  const chats = useSocial((s) => { let n = 0; for (const v of Object.values(s.unreadGroup)) n += v; for (const v of Object.values(s.unreadDm)) n += v; return n })
  const ann = useAnnouncements((s) => s.unread)
  return chats + ann
}

/** WebSocket events (exported for tests) */
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

// ── follows social login ──
let off: (() => void) | null = null
useSocial.subscribe((cur, prev) => {
  if (cur.socket !== prev.socket) {
    off?.()
    off = cur.socket ? (cur.socket.on((d) => handleAnnouncementEvent(d as Parameters<typeof handleAnnouncementEvent>[0])) as () => void) : null
  }
  if (cur.status === 'ready' && prev.status !== 'ready') void useAnnouncements.getState().load()
  // Realtime dropped and reconnected: announcements / recalls during the outage miss their events — pull once more
  else if (cur.status === 'ready' && cur.wsStatus === 'open' && prev.wsStatus !== 'open' && useAnnouncements.getState().loaded) void useAnnouncements.getState().load()
  if (cur.status === 'idle' && prev.status !== 'idle') useAnnouncements.getState().reset()
})
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && useSocial.getState().status === 'ready') void useAnnouncements.getState().load()
  })
}
