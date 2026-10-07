// 一对一语音 / 视频通话的状态机（只管信令与界面状态；LiveKit 连接在 CallOverlay 里）。
//
// idle → outgoing（我打出去，等对方）→ connecting（对方接了 / 我接了，正在连音视频）→ active → ended → idle
// idle → incoming（来电响铃）→ connecting …
// ended 停留一会儿显示结果（对方已拒绝、无人接听…），然后自动回 idle。
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
  /** 我是主叫 */
  outgoingCall: boolean
  /** 被叫当前有没有连着（离线时只能靠推送叫醒） */
  peerOnline: boolean
  token: string | null
  url: string | null
  startedAt: number | null
  /** ended 时显示的一句话 */
  reason: string | null

  startCall: (peer: CallPeer, video: boolean) => Promise<void>
  accept: () => Promise<void>
  decline: () => Promise<void>
  /** 主叫取消 / 通话中挂断，统一入口 */
  hangup: (reason?: string) => Promise<void>
  /** LiveKit 连上了 */
  connected: () => void
  /** 本机音视频出错或对方断开，结束通话并告诉服务器 */
  fail: (reason: string) => void
  /** ws 事件 */
  onEvent: (d: { type: string } & Record<string, unknown>) => void
  /** 打开 App / ws 重连后补拿正在响铃的来电 */
  syncIncoming: () => Promise<void>
  reset: () => void
}

/** 结束画面停留时长 */
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
        // 等待期间用户已取消
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
        // 本机正在通话（多设备同账号时服务端也会判占线，这里再兜一层）
        if (busy()) return
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null }
        set({ ...IDLE, phase: 'incoming', callId: id, video: !!d.video, peer: { address: String(d.from || ''), nickname: (d.nickname as string | null) ?? null, avatar: (d.avatar as string | null) ?? null } })
        return
      }
      if (s.callId !== id) return
      switch (d.type) {
        case 'call_accepted':
          if (s.phase === 'outgoing') set({ phase: 'connecting' })
          // 还在响铃 = 是同账号的另一台设备接的
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
