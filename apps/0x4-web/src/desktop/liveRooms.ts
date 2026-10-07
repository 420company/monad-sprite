// Shared "now live" data for web (2026-10-01 community merge): the top bar "Community" red dot, the community left menu's "Livestream" number,
// the feed page's right rail "Now live", and the livestream page's room list — all use this one copy, no separate pulls.
// Public API /api/rooms (readable without login). Pulls every 10s while some page uses it; skipped when the tab is in background, pulled immediately on return.
import { useEffect } from 'react'
import { create } from 'zustand'
import { api } from '@/lib/social'
import type { RoomInfo } from '@/pages/Live'

interface LiveRoomsState {
  livekit: boolean | null
  rooms: RoomInfo[] | null
  updated: number
  loading: boolean
  failed: boolean
  refresh: () => Promise<void>
}

const POLL_MS = 10_000

export const useLiveRooms = create<LiveRoomsState>((set, get) => ({
  livekit: null,
  rooms: null,
  updated: 0,
  loading: false,
  failed: false,
  async refresh() {
    if (get().loading) return
    set({ loading: true })
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15_000)
    try {
      const r = await api<{ livekit: boolean; rooms: RoomInfo[] }>('/api/rooms', { signal: ctrl.signal }, { anonymous: true })
      if (!Array.isArray(r?.rooms) || typeof r.livekit !== 'boolean') throw new Error('bad')
      // Most viewers first; ties broken by most recently started
      const rooms = [...r.rooms].sort((a, b) => b.viewers - a.viewers || b.createdAt - a.createdAt)
      set({ livekit: r.livekit, rooms, updated: Date.now(), failed: false })
    } catch { set({ failed: true }) }
    finally { clearTimeout(timer); set({ loading: false }) }
  },
}))

let users = 0
let timer: ReturnType<typeof setInterval> | null = null
function onVisible() { if (!document.hidden) void useLiveRooms.getState().refresh() }

/** Pages subscribe with this: polling starts when the first consuming component mounts, stops when the last unmounts */
export function useLiveRoomsPoll() {
  useEffect(() => {
    users++
    if (users === 1) {
      void useLiveRooms.getState().refresh()
      timer = setInterval(() => { if (!document.hidden) void useLiveRooms.getState().refresh() }, POLL_MS)
      document.addEventListener('visibilitychange', onVisible)
    }
    return () => {
      users--
      if (users === 0) {
        if (timer) clearInterval(timer)
        timer = null
        document.removeEventListener('visibilitychange', onVisible)
      }
    }
  }, [])
}
