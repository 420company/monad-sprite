// 网页版「正在直播」的共用数据（2026-10-01 社区合并）：顶栏「社区」的红点、社区左边菜单「直播」的数字、
// 动态页右边栏「正在直播」、直播页的房间列表，都用这一份，不各拉各的。
// 公开接口 /api/rooms（不登录也能读）。有页面在用时每 10 秒拉一次，标签页在后台时跳过，切回来马上拉。
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
      // 看的人多的在前，同样多的新开播在前
      const rooms = [...r.rooms].sort((a, b) => b.viewers - a.viewers || b.createdAt - a.createdAt)
      set({ livekit: r.livekit, rooms, updated: Date.now(), failed: false })
    } catch { set({ failed: true }) }
    finally { clearTimeout(timer); set({ loading: false }) }
  },
}))

let users = 0
let timer: ReturnType<typeof setInterval> | null = null
function onVisible() { if (!document.hidden) void useLiveRooms.getState().refresh() }

/** 页面用这个订阅：第一个用的组件挂上时开始轮询，最后一个卸载时停 */
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
