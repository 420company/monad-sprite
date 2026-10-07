// 会议等候室（2026-10-01 goat）的前端逻辑，网页版 / 手机 App（src/pages/MeetingRoom.tsx）和电脑端 meet/ 共用。
// 这里不引 @/ 别名、不引界面组件，meet 工程用相对路径直接引用；请求函数由调用方传进来（两边的 api() 不一样）。
//
// 规则在服务器（server/src/meetAuth.ts）：开了等候室，除主持人和临时管理员外进会先进等待列表，服务器不签进会令牌；
// 主持人 / 管理员「允许」「拒绝」「全部允许」；被拒的人看到「主持人未同意你加入」；允许只在本场有效。
import { useCallback, useEffect, useRef, useState } from 'react'

export type LobbyApi = <T>(path: string, init?: RequestInit) => Promise<T>
export interface LobbyWaiter { address: string; name: string; avatar: string | null; since: number }
/** waiting 还在等 / admitted 已允许（再进一次会拿令牌）/ denied 未同意 / none 不在等待列表里（太久没来问被清掉了，重新进会即可） */
export type WaitStatus = 'waiting' | 'admitted' | 'denied' | 'none'

/** 等着的人多久问一次状态；服务器 30 秒没收到就把人从列表里拿掉 */
export const LOBBY_POLL_MS = 3000
/** 主持人 / 管理员多久刷新一次等待列表（开着等候室时） */
export const LOBBY_HOST_POLL_MS = 3000
/** 等候室关着时也偶尔刷新一下（别的管理员可能打开了） */
export const LOBBY_HOST_IDLE_MS = 15_000

/** 服务器进会接口的「在等候室」回复（HTTP 202） */
export const isLobbyWaiting = (r: unknown): boolean => !!r && typeof r === 'object' && (r as { waiting?: unknown }).waiting === true

/**
 * 等着的人：每 3 秒问一次状态，结果一出（允许 / 拒绝 / 不在列表）就停下来回调。
 * 页面在后台也照常问：不问的话 30 秒后会被服务器当成离开。
 */
export function useLobbyWait(api: LobbyApi, code: string, active: boolean, onResult: (s: Exclude<WaitStatus, 'waiting'>) => void) {
  const cb = useRef(onResult)
  cb.current = onResult
  useEffect(() => {
    if (!active) return
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined
    const ask = async () => {
      try {
        const r = await api<{ status: WaitStatus }>(`/api/meet/meetings/${code}/lobby/me`)
        if (!alive) return
        if (r.status !== 'waiting') { cb.current(r.status); return }
      } catch { /* 网络抖一下：下一轮再问 */ }
      if (alive) timer = setTimeout(ask, LOBBY_POLL_MS)
    }
    timer = setTimeout(ask, LOBBY_POLL_MS)
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [api, code, active])
}

export interface LobbyHost {
  on: boolean
  waiting: LobbyWaiter[]
  /** 会中开关（关掉时正在等的人全部放进来） */
  toggle: (on: boolean) => Promise<void>
  admit: (address: string) => Promise<void>
  admitAll: () => Promise<void>
  deny: (address: string) => Promise<void>
}

/** 主持人 / 管理员：等待列表 + 操作。enabled = 自己是主持人或管理员（成员调接口会被服务器拒） */
export function useLobbyHost(api: LobbyApi, code: string, enabled: boolean, initialOn: boolean, onError: (e: unknown) => void): LobbyHost {
  const [on, setOn] = useState(initialOn)
  const [waiting, setWaiting] = useState<LobbyWaiter[]>([])
  const onRef = useRef(on)
  onRef.current = on
  const errRef = useRef(onError)
  errRef.current = onError
  useEffect(() => { setOn(initialOn) }, [initialOn])
  const load = useCallback(async () => {
    const r = await api<{ on: boolean; waiting: LobbyWaiter[] }>(`/api/meet/meetings/${code}/lobby`)
    setOn(!!r.on); setWaiting(Array.isArray(r.waiting) ? r.waiting : [])
  }, [api, code])
  useEffect(() => {
    if (!enabled) { setWaiting([]); return }
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try { await load() } catch { /* 下一轮再拉 */ }
      if (alive) timer = setTimeout(tick, onRef.current ? LOBBY_HOST_POLL_MS : LOBBY_HOST_IDLE_MS)
    }
    void tick()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [enabled, load])
  const post = useCallback(async (path: string, body: object) => {
    try {
      const r = await api<{ on?: boolean; waiting?: LobbyWaiter[] }>(`/api/meet/meetings/${code}/${path}`, { method: 'POST', body: JSON.stringify(body) })
      if (typeof r.on === 'boolean') setOn(r.on)
      if (Array.isArray(r.waiting)) setWaiting(r.waiting)
    } catch (e) { errRef.current(e) }
  }, [api, code])
  return {
    on, waiting,
    toggle: (v) => post('lobby', { on: v }),
    admit: (address) => post('lobby/admit', { address }),
    admitAll: () => post('lobby/admit', { all: true }),
    deny: (address) => post('lobby/deny', { address }),
  }
}

/** 等了多久：不到 1 分钟按秒，之后按分钟（界面自己套文案） */
export function waitedFor(since: number, now = Date.now()): { unit: 's' | 'm'; n: number } {
  const s = Math.max(0, Math.floor((now - since) / 1000))
  return s < 60 ? { unit: 's', n: s } : { unit: 'm', n: Math.floor(s / 60) }
}
