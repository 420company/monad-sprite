// Host PK frontend state (2026-09-30, server server/src/livePk.ts).
// The server pushes over the realtime connection: roompk (public state both rooms receive), roompk_link / roompk_unlink (host only: the token for streaming into the other room),
// roompk_queue_state (queue), roompk_invite / roompk_invite_state (invites), roompk_notice (won / lost), roompk_error.
import { useEffect, useRef, useState } from 'react'
import { useSocial } from '@/store/social'

export interface PkSide { room: string; host: string; nickname: string; avatar: string | null; score: number; streak: number; level: number; identity: string }
export interface PkUser { address: string; nickname: string; avatar: string | null }
export interface PkState {
  id: string; phase: 'running' | 'result' | 'linked'; startedAt: number; endsAt: number; resultUntil: number | null; serverNow: number
  me: PkSide; opp: PkSide; winner: 'me' | 'opp' | 'tie' | null; reason: string | null; valid: boolean
  top: { me: PkUser[]; opp: PkUser[] }; rematch: { me: boolean; opp: boolean }
  /** Score trend (2026-10-01, the web PK card's "candles"): starts 0:0 + one point per gift, from this room's perspective */
  history?: { t: number; me: number; opp: number }[]
}
export interface PkLink { pkId: string; url: string; token: string; oppRoom: string }
export interface PkInvite { id: string; expiresAt: number; serverNow: number; from: { host: string; room: string; nickname: string; avatar: string | null; streak: number; level: number } }

/** The left side's share (0–1). Half each when both are 0 */
export function pkRatio(me: number, opp: number): number {
  const total = me + opp
  if (total <= 0) return 0.5
  // Minimum 8%, so one side can't be squeezed out of sight
  return Math.min(0.92, Math.max(0.08, me / total))
}
/** Remaining time mm:ss (server clock skew already corrected) */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export type QueueState = { state: 'idle' } | { state: 'queued'; since: number }

/**
 * A livestream room's PK state. skew = server time − local time (countdowns use the server's clock).
 * isHost: the host additionally receives the link token, queue state, and invites.
 */
export function usePk(roomId: string, isHost: boolean) {
  const socket = useSocial((s) => s.socket)
  const [pk, setPk] = useState<PkState | null>(null)
  const [link, setLink] = useState<PkLink | null>(null)
  const [queue, setQueue] = useState<QueueState>({ state: 'idle' })
  const [invite, setInvite] = useState<PkInvite | null>(null)
  const [inviteState, setInviteState] = useState<{ id: string; state: string } | null>(null)
  const [notice, setNotice] = useState<{ kind: 'won' | 'lost'; next: 'auto' | 'manual'; at: number } | null>(null)
  const [error, setError] = useState<{ text: string; at: number } | null>(null)
  const skew = useRef(0)
  useEffect(() => {
    if (!socket) return
    setPk(null); setLink(null); setQueue({ state: 'idle' }); setInvite(null); setNotice(null)
    const off = socket.on((d) => {
      if (d.roomId !== roomId) return
      if (d.type === 'roompk') {
        const s = d.pk as PkState | null
        if (s?.serverNow) skew.current = s.serverNow - Date.now()
        setPk(s)
        if (s) setQueue({ state: 'idle' })
      }
      if (!isHost) return
      if (d.type === 'roompk_link') setLink({ pkId: String(d.pkId), url: String(d.url), token: String(d.token), oppRoom: String(d.oppRoom) })
      if (d.type === 'roompk_unlink') setLink((l) => (l && l.pkId === d.pkId ? null : l))
      if (d.type === 'roompk_queue_state') setQueue(d.state === 'queued' ? { state: 'queued', since: Number(d.since) - (Number(d.serverNow) - Date.now() || 0) } : { state: 'idle' })
      if (d.type === 'roompk_invite') setInvite(d as unknown as PkInvite)
      if (d.type === 'roompk_invite_state') { setInviteState({ id: String(d.id), state: String(d.state) }); setInvite((i) => (i && i.id === d.id && d.state !== 'sent' ? null : i)) }
      if (d.type === 'roompk_notice') setNotice({ kind: d.kind === 'won' ? 'won' : 'lost', next: d.next === 'auto' ? 'auto' : 'manual', at: Date.now() })
      if (d.type === 'roompk_error') setError({ text: String(d.error || ''), at: Date.now() })
    })
    return () => { off() }
  }, [socket, roomId, isHost])
  // Pull once on room entry (realtime connection dropped, or joined mid-way)
  useEffect(() => {
    let alive = true
    import('@/lib/social').then(({ api }) => api<{ pk: PkState | null }>(`/api/rooms/${roomId}/pk`)).then((r) => { if (alive && r.pk) { skew.current = r.pk.serverNow - Date.now(); setPk(r.pk) } }).catch(() => {})
    return () => { alive = false }
  }, [roomId])
  const send = (type: string, extra: Record<string, unknown> = {}) => socket?.send({ type, roomId, ...extra })
  return {
    pk, link, queue, invite, inviteState, notice, error, serverNow: () => Date.now() + skew.current,
    queueUp: (lang?: string) => { setQueue({ state: 'queued', since: Date.now() }); send('roompk_queue', { lang }) },
    cancelQueue: () => { setQueue({ state: 'idle' }); send('roompk_cancel') },
    inviteHost: (to: string) => send('roompk_invite', { to }),
    answer: (id: string, accept: boolean) => { setInvite(null); send('roompk_answer', { id, accept }) },
    rematch: () => send('roompk_rematch'),
    leave: () => send('roompk_leave'),
    clearNotice: () => setNotice(null),
  }
}

/** Refresh every 250ms (countdown) */
export function useTicker(active: boolean, ms = 250) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => set((n) => n + 1), ms)
    return () => clearInterval(id)
  }, [active, ms])
}
