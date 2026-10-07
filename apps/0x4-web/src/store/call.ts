// 1:1 voice / video call state machine (signaling and UI state only; the LiveKit connection lives in CallOverlay).
//
// idle → outgoing (I called, waiting for them) → connecting (they picked up / I picked up, connecting audio-video) → active → ended → idle
// idle → incoming (incoming call ringing) → connecting …
// ended lingers briefly to show the outcome (declined, no answer…), then auto-returns to idle.
import { create } from 'zustand'
import { api } from '@/lib/social'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'

export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended'
export interface CallPeer { address: string; nickname?: string | null; avatar?: string | null }

interface CallState {
  phase: CallPhase
  callId: string | null
  peer: CallPeer | null
  video: boolean
  /** I am the caller */
  outgoingCall: boolean
  /** Whether the callee is currently connected (offline callees can only be woken by push) */
  peerOnline: boolean
  token: string | null
  url: string | null
  startedAt: number | null
  /** The one-liner shown at ended */
  reason: string | null

  startCall: (peer: CallPeer, video: boolean) => Promise<void>
  accept: () => Promise<void>
  decline: () => Promise<void>
  /** Caller cancel / hang up mid-call — single entry point */
  hangup: (reason?: string) => Promise<void>
  /** LiveKit connected */
  connected: () => void
  /** Local audio-video error or the other side disconnected: end the call and tell the server */
  fail: (reason: string) => void
  /** ws events */
  onEvent: (d: { type: string } & Record<string, unknown>) => void
  /** After app open / ws reconnect, catch up on incoming calls still ringing */
  syncIncoming: () => Promise<void>
  reset: () => void
}

/** How long the ended screen lingers */
export const ENDED_HOLD_MS = 1800

const IDLE = { phase: 'idle' as CallPhase, callId: null, peer: null, video: false, outgoingCall: false, peerOnline: true, token: null, url: null, startedAt: null, reason: null }

let holdTimer: ReturnType<typeof setTimeout> | null = null

export const useCall = create<CallState>()((set, get) => {
  const end = (reason: string) => {
    set({ phase: 'ended', reason, token: null })
    if (holdTimer) clearTimeout(holdTimer)
    holdTimer = setTimeout(() => { holdTimer = null; if (get().phase === 'ended') set({ ...IDLE }) }, ENDED_HOLD_MS)
  }
  const post = (path: string) => { const id = get().callId; if (id) void api(`/api/calls/${id}/${path}`, { method: 'POST' }).catch(() => {}) }
  const busy = () => get().phase !== 'idle' && get().phase !== 'ended'

  return {
    ...IDLE,

    async startCall(peer, video) {
      if (busy()) return
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null }
      set({ ...IDLE, phase: 'outgoing', peer, video, outgoingCall: true })
      try {
        const r = await api<{ status: 'ringing' | 'busy'; callId?: string; online?: boolean; token?: string; url?: string; peer?: CallPeer }>('/api/calls', { method: 'POST', body: JSON.stringify({ to: peer.address, video }) })
        // User cancelled during the wait
        if (get().phase !== 'outgoing' || get().peer?.address !== peer.address) {
          if (r.callId) void api(`/api/calls/${r.callId}/cancel`, { method: 'POST' }).catch(() => {})
          return
        }
        if (r.status === 'busy') return end(t('对方正在通话中'))
        set({ callId: r.callId || null, token: r.token || null, url: r.url || null, peerOnline: r.online !== false, peer: { ...peer, ...(r.peer || {}), nickname: r.peer?.nickname ?? peer.nickname, avatar: r.peer?.avatar ?? peer.avatar } })
      } catch (e) {
        if (get().phase === 'outgoing') end(errorText(e, t('呼叫失败')))
      }
    },

    async accept() {
      const { phase, callId } = get()
      if (phase !== 'incoming' || !callId) return
      set({ phase: 'connecting' })
      try {
        const r = await api<{ token: string; url: string }>(`/api/calls/${callId}/accept`, { method: 'POST' })
        if (get().callId !== callId || get().phase !== 'connecting') return
        set({ token: r.token, url: r.url })
      } catch (e) {
        if (get().callId === callId) end(errorText(e, t('通话已结束')))
      }
    },

    async decline() {
      if (get().phase !== 'incoming') return
      post('decline')
      end(t('已拒绝'))
    },

    async hangup(reason) {
      const { phase, outgoingCall } = get()
      if (phase === 'idle' || phase === 'ended') return
      if (phase === 'incoming') return get().decline()
      if (phase === 'outgoing') { post('cancel'); end(reason || t('已取消')); return }
      post('end')
      end(reason || (outgoingCall || phase === 'active' ? t('通话已结束') : t('已挂断')))
    },

    connected() {
      if (get().phase === 'connecting') set({ phase: 'active', startedAt: Date.now() })
    },

    fail(reason) {
      if (!busy()) return
      post('end')
      end(reason)
    },

    onEvent(d) {
      const id = typeof d.callId === 'string' ? d.callId : null
      if (!id) return
      const s = get()
      if (d.type === 'call_invite') {
        // This device is already in a call (the server also reports busy for multi-device same-account — this is a second layer)
        if (busy()) return
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null }
        set({ ...IDLE, phase: 'incoming', callId: id, video: !!d.video, peer: { address: String(d.from || ''), nickname: (d.nickname as string | null) ?? null, avatar: (d.avatar as string | null) ?? null } })
        return
      }
      if (s.callId !== id) return
      switch (d.type) {
        case 'call_accepted':
          if (s.phase === 'outgoing') set({ phase: 'connecting' })
          // Still ringing = another device on the same account picked up
          else if (s.phase === 'incoming') end(t('已在其他设备接听'))
          break
        case 'call_declined': if (s.phase === 'outgoing') end(t('对方已拒绝')); break
        case 'call_cancelled': if (s.phase === 'incoming') end(t('对方已取消')); break
        case 'call_missed': if (busy()) end(s.outgoingCall ? t('对方无人接听') : t('未接来电')); break
        case 'call_ended':
          if (!busy()) break
          if (d.self) end(s.phase === 'incoming' ? t('已在其他设备处理') : t('通话已结束'))
          else end(d.reason === 'lost' ? t('对方网络已断开') : t('对方已挂断'))
          break
      }
    },

    async syncIncoming() {
      if (get().phase !== 'idle' && get().phase !== 'ended') return
      const r = await api<{ call: null | { callId: string; from: string; video: boolean; nickname?: string | null; avatar?: string | null } }>('/api/calls/current').catch(() => null)
      if (r?.call) get().onEvent({ type: 'call_invite', ...r.call })
    },

    reset() { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null } set({ ...IDLE }) },
  }
})
