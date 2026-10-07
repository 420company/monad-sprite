// Meeting lobby (2026-10-01 goat) frontend logic, shared by web / mobile app (src/pages/MeetingRoom.tsx) and the desktop meet/.
// No @/ aliases or UI components here — the meet project references via relative paths; the request function is passed in by callers (the two sides' api() differ).
//
// Rules live on the server (server/src/meetAuth.ts): with the lobby on, everyone except the host and temp admins lands on the waiting list first — the server won't sign a join token;
// the host / admins "admit" / "deny" / "admit all"; denied people see "the host didn't approve you"; admission is valid for this meeting only.
import { useCallback, useEffect, useRef, useState } from 'react'

export type LobbyApi = <T>(path: string, init?: RequestInit) => Promise<T>
export interface LobbyWaiter { address: string; name: string; avatar: string | null; since: number }
/** waiting = still waiting / admitted = approved (rejoining gets a token) / denied = not approved / none = not on the waiting list (cleared after too long without polling — just rejoin) */
export type WaitStatus = 'waiting' | 'admitted' | 'denied' | 'none'

/** How often waiters poll their status; the server drops people from the list after 30s without a poll */
export const LOBBY_POLL_MS = 3000
/** How often the host / admins refresh the waiting list (while the lobby is on) */
export const LOBBY_HOST_POLL_MS = 3000
/** Also refresh occasionally while the lobby is off (another admin may have turned it on) */
export const LOBBY_HOST_IDLE_MS = 15_000

/** The server join API's "in lobby" response (HTTP 202) */
export const isLobbyWaiting = (r: unknown): boolean => !!r && typeof r === 'object' && (r as { waiting?: unknown }).waiting === true

/**
 * Waiters: poll status every 3s; stop and call back as soon as there's an outcome (admitted / denied / not on list).
 * Keep polling even in the background: without polls the server treats them as gone after 30s.
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
      } catch { /* Network hiccup: ask again next round */ }
      if (alive) timer = setTimeout(ask, LOBBY_POLL_MS)
    }
    timer = setTimeout(ask, LOBBY_POLL_MS)
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [api, code, active])
}

export interface LobbyHost {
  on: boolean
  waiting: LobbyWaiter[]
  /** In-meeting switch (turning it off admits everyone currently waiting) */
  toggle: (on: boolean) => Promise<void>
  admit: (address: string) => Promise<void>
  admitAll: () => Promise<void>
  deny: (address: string) => Promise<void>
}

/** Host / admins: waiting list + actions. enabled = I am the host or an admin (members calling the API get rejected by the server) */
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
      try { await load() } catch { /* Pull again next round */ }
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

/** How long waited: seconds under a minute, minutes after (the UI wraps it in copy itself) */
export function waitedFor(since: number, now = Date.now()): { unit: 's' | 'm'; n: number } {
  const s = Math.max(0, Math.floor((now - since) / 1000))
  return s < 60 ? { unit: 's', n: s } : { unit: 'm', n: Math.floor(s / 60) }
}
