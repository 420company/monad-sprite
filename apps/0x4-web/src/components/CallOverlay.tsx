// Global call layer: mounted at the app root; incoming calls pop full-screen from any page; outgoing, in-call and ended states all live here.
// Signaling state in store/call.ts; audio/video via LiveKit (livekit-client lazy-loaded like the live room).
//
// No speaker / earpiece switching: WebView can't reach the system's audio routing, so such a button would be dead weight.
import { useEffect, useRef, useState } from 'react'
import type { Room as LKRoom, Track, LocalVideoTrack } from 'livekit-client'
import { LoaderCircle, Mic, MicOff, Phone, PhoneOff, SwitchCamera, Video, VideoOff, Volume2 } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { LiquidLayer } from '@/components/LiquidBackground'
import { useCall, type CallPeer } from '@/store/call'
import { useSocial, displayName } from '@/store/social'
import { api } from '@/lib/social'
import { playRingtone, primeRingtone, stopRingtone } from '@/lib/ringtone'
import { vibrate } from '@/lib/native'
import { shortId } from '@/lib/format'
import { t } from '@/lib/i18n'
import UserName from './UserName'

primeRingtone()

const peerName = (p: CallPeer | null) => (p ? (p.nickname ? displayName({ address: p.address, nickname: p.nickname }) : shortId(p.address)) : '')

export default function CallOverlay() {
  const phase = useCall((s) => s.phase)
  const hasToken = useCall((s) => !!s.token && !!s.url)
  const { socket, wsStatus, status } = useSocial()

  // Wire up ws events
  useEffect(() => {
    if (!socket) return
    const off = socket.on((d) => useCall.getState().onEvent(d as { type: string } & Record<string, unknown>))
    return () => { off() }
  }, [socket])
  // On connect / reconnect, catch up on ringing incoming calls (entered from a push, or arrived while disconnected)
  useEffect(() => { if (status === 'ready' && wsStatus === 'open') void useCall.getState().syncIncoming() }, [status, wsStatus])
  // On logout: dismiss directly
  useEffect(() => { if (status === 'idle') useCall.getState().reset() }, [status])

  // Ringing and vibration
  useEffect(() => {
    if (phase === 'incoming') {
      playRingtone('ring')
      vibrate(800)
      const iv = setInterval(() => vibrate(800), 2400)
      return () => { clearInterval(iv); stopRingtone() }
    }
    if (phase === 'outgoing') { playRingtone('ringback'); return () => stopRingtone() }
    stopRingtone()
  }, [phase])

  if (phase === 'idle') return null
  const inSession = (phase === 'connecting' || phase === 'active') && hasToken
  return (
    // The outer layer owns positioning: .sheet-glass is written outside the style layers and carries position: relative, which overrides fixed on the same element
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label={t('通话')}>
      <div className="sheet-glass flex h-full flex-col text-fg">
        <LiquidLayer />
        {inSession ? <CallSession /> : <CallCard />}
      </div>
    </div>
  )
}

/** Incoming / outgoing / connecting-after-answer / ended states: avatar + name + one status line + buttons */
function CallCard() {
  const { phase, peer, video, peerOnline, reason, accept, decline, hangup } = useCall()
  const kind = video ? t('视频通话') : t('语音通话')
  const line = phase === 'incoming' ? (video ? t('邀请你视频通话') : t('邀请你语音通话'))
    : phase === 'outgoing' ? t('正在呼叫…')
      : phase === 'connecting' ? t('正在连接…')
        : reason || t('通话已结束')
  return (
    <div className="safe-top safe-bottom flex min-h-0 flex-1 flex-col items-center px-6">
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        {peer && <Avatar address={peer.address} src={peer.avatar} name={peer.nickname} size={104} />}
        <div className="max-w-full truncate text-2xl font-semibold"><UserName size="lg" address={peer?.address} name={peerName(peer)} /></div>
        <div className="text-sm text-muted" role="status">{line}</div>
        {phase === 'outgoing' && !peerOnline && <div className="text-xs text-warning">{t('对方不在线')}</div>}
        {phase !== 'ended' && phase !== 'incoming' && <div className="text-xs text-muted">{kind}</div>}
      </div>
      <div className="flex w-full items-start justify-center gap-16 pb-10">
        {phase === 'incoming' && <>
          <RoundButton color="down" label={t('挂断')} onClick={() => void decline()}><PhoneOff size={28} /></RoundButton>
          <RoundButton color="up" label={t('接听')} onClick={() => void accept()}>{video ? <Video size={28} /> : <Phone size={28} />}</RoundButton>
        </>}
        {(phase === 'outgoing' || phase === 'connecting') && <RoundButton color="down" label={phase === 'outgoing' ? t('取消') : t('挂断')} onClick={() => void hangup()}><PhoneOff size={28} /></RoundButton>}
      </div>
    </div>
  )
}

function RoundButton({ color, label, onClick, children, active = true, disabled }: { color: 'up' | 'down' | 'plain'; label: string; onClick: () => void; children: React.ReactNode; active?: boolean; disabled?: boolean }) {
  const cls = color === 'up' ? 'bg-up text-white' : color === 'down' ? 'bg-down text-white' : active ? 'glass text-fg' : 'bg-fg text-bg'
  return (
    <div className="flex w-20 flex-col items-center gap-2">
      <button onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={color === 'plain' ? !active : undefined}
        className={`flex h-[68px] w-[68px] items-center justify-center rounded-full transition-transform active:scale-95 disabled:opacity-50 ${cls}`}>{children}</button>
      <span className="text-xs text-muted">{label}</span>
    </div>
  )
}

const fmtDur = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** The LiveKit-connected segment: connecting → in call */
function CallSession() {
  const { phase, peer, video, token, url, callId, startedAt, connected, fail, hangup } = useCall()
  const roomRef = useRef<LKRoom | null>(null)
  const [remoteVideo, setRemoteVideo] = useState<Track | null>(null)
  const [remoteAudio, setRemoteAudio] = useState<Track | null>(null)
  const [localVideo, setLocalVideo] = useState<LocalVideoTrack | null>(null)
  const [mic, setMic] = useState(true)
  const [cam, setCam] = useState(video)
  const [front, setFront] = useState(true)
  const [swapped, setSwapped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [audioBlocked, setAudioBlocked] = useState(false)
  const [warn, setWarn] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  // Establish the connection (component unmount = call end: disconnect and shut off camera/mic)
  useEffect(() => {
    if (!token || !url) return
    let alive = true
    let room: LKRoom | null = null
    const run = async () => {
      const sdk = await import('livekit-client').catch(() => null)
      if (!alive) return
      if (!sdk) { fail(t('音视频组件加载失败')); return }
      const { Room, RoomEvent, Track: TrackNS } = sdk
      // Echo cancellation hardcoded on: gift sound effects (like Hakimi) playing on the streamer's side won't be picked up by the mic again and doubled to viewers
      room = new Room({ adaptiveStream: true, dynacast: true, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      roomRef.current = room
      const r = room
      const refresh = () => {
        if (!alive) return
        const remote = [...r.remoteParticipants.values()][0]
        const pubs = remote ? [...remote.trackPublications.values()] : []
        setRemoteVideo(pubs.find((p) => p.kind === TrackNS.Kind.Video && p.track && !p.isMuted)?.track ?? null)
        setRemoteAudio(pubs.find((p) => p.kind === TrackNS.Kind.Audio && p.track)?.track ?? null)
        const lv = [...r.localParticipant.trackPublications.values()].find((p) => p.kind === TrackNS.Kind.Video && p.track && !p.isMuted)?.track as LocalVideoTrack | undefined
        setLocalVideo(lv ?? null)
        setMic(r.localParticipant.isMicrophoneEnabled)
        setCam(r.localParticipant.isCameraEnabled)
        if (remote) connected()
      }
      r.on(RoomEvent.TrackSubscribed, refresh).on(RoomEvent.TrackUnsubscribed, refresh).on(RoomEvent.ParticipantConnected, refresh)
        .on(RoomEvent.LocalTrackPublished, refresh).on(RoomEvent.LocalTrackUnpublished, refresh).on(RoomEvent.TrackMuted, refresh).on(RoomEvent.TrackUnmuted, refresh)
      // The other side left the room: on a normal hangup the server's call_ended usually arrives first; reaching here mostly means they dropped offline or the app was killed
      // Hold the verdict a moment to let call_ended arrive first, so the hint reads "the other side hung up" rather than a disconnect
      r.on(RoomEvent.ParticipantDisconnected, () => { setTimeout(() => { if (alive) fail(t('对方网络已断开')) }, 1500) })
      r.on(RoomEvent.Reconnecting, () => { if (alive) setWarn(t('网络不稳定，正在重连')) })
      r.on(RoomEvent.Reconnected, () => { if (alive) setWarn(null) })
      r.on(RoomEvent.Disconnected, () => { if (alive) fail(t('网络已断开，通话结束')) })
      r.on(RoomEvent.AudioPlaybackStatusChanged, () => { if (alive) setAudioBlocked(!r.canPlaybackAudio) })
      try {
        await r.connect(url, token)
        if (!alive) return
        // The system permission dialog briefly takes the app out of the foreground; don't let auto-lock interrupt that
        const { suspendAutoLock, resumeAutoLock } = await import('@/lib/autolock')
        suspendAutoLock()
        try {
          await r.localParticipant.setMicrophoneEnabled(true).catch(() => { if (alive) setWarn(t('麦克风未开启，请在系统设置里允许')) })
          // Voice calls don't open the camera
          if (video && alive) await r.localParticipant.setCameraEnabled(true, { facingMode: 'user' }).catch(() => { if (alive) setWarn(t('摄像头未开启，请在系统设置里允许')) })
        } finally { resumeAutoLock() }
        if (!alive) return
        setAudioBlocked(!r.canPlaybackAudio)
        refresh()
      } catch {
        if (alive) fail(t('暂时无法连接通话'))
      }
    }
    void run()
    return () => { alive = false; roomRef.current = null; void room?.disconnect() }
  }, [token, url]) // eslint-disable-line react-hooks/exhaustive-deps

  // The other side hasn't entered the room for a while (their side can't connect)
  useEffect(() => {
    if (phase !== 'connecting') return
    const tm = setTimeout(() => fail(t('连接超时，通话结束')), 30_000)
    return () => clearTimeout(tm)
  }, [phase, fail])

  // Keep-alive + timer
  useEffect(() => {
    if (!callId) return
    const hb = setInterval(() => { void api(`/api/calls/${callId}/alive`, { method: 'POST' }).catch(() => {}) }, 20_000)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => { clearInterval(hb); clearInterval(tick) }
  }, [callId])

  const toggleMic = async () => {
    const r = roomRef.current
    if (!r || busy) return
    setBusy(true)
    try { await r.localParticipant.setMicrophoneEnabled(!mic); setMic(r.localParticipant.isMicrophoneEnabled) } catch { setWarn(t('麦克风未开启，请在系统设置里允许')) } finally { setBusy(false) }
  }
  const toggleCam = async () => {
    const r = roomRef.current
    if (!r || busy) return
    setBusy(true)
    try { await r.localParticipant.setCameraEnabled(!cam, { facingMode: front ? 'user' : 'environment' }); setCam(r.localParticipant.isCameraEnabled) } catch { setWarn(t('摄像头未开启，请在系统设置里允许')) } finally { setBusy(false) }
  }
  const flip = async () => {
    if (!localVideo || busy) return
    setBusy(true)
    try { await localVideo.restartTrack({ facingMode: front ? 'environment' : 'user' }); setFront(!front) } catch { setWarn(t('切换摄像头失败')) } finally { setBusy(false) }
  }

  const status = phase === 'active' && startedAt ? fmtDur(now - startedAt) : t('正在连接…')
  // Video calls: the big view defaults to the other side, the small window to self; tapping the small window swaps them
  const big = video ? (swapped ? localVideo : remoteVideo) : null
  const small = video ? (swapped ? remoteVideo : localVideo) : null
  const bigIsLocal = swapped
  const showVideo = video && phase === 'active' && !!big

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {remoteAudio && <TrackAudio track={remoteAudio} />}
      {showVideo && big && <TrackVideo track={big} mirror={bigIsLocal && front} className="absolute inset-0 h-full w-full bg-black object-cover" />}
      {video && phase === 'active' && small && (
        <button onClick={() => setSwapped(!swapped)} aria-label={t('交换画面')}
          className="absolute right-3 top-[calc(env(safe-area-inset-top)+12px)] z-10 h-40 w-28 overflow-hidden rounded-2xl border border-white/20 bg-black shadow-lg">
          <TrackVideo track={small} mirror={!bigIsLocal && front} className="h-full w-full object-cover" />
        </button>
      )}

      <div className={`relative z-[1] flex flex-col items-center px-6 pt-[calc(1rem+env(safe-area-inset-top))] ${showVideo ? 'items-start' : 'flex-1 justify-center gap-4 text-center'}`}>
        {showVideo ? (
          <div className="mt-2 rounded-full bg-black/40 px-3 py-1 text-sm text-white">{peerName(peer)} · <span className="number">{status}</span></div>
        ) : <>
          {peer && <Avatar address={peer.address} src={peer.avatar} name={peer.nickname} size={104} />}
          <div className="max-w-full truncate text-2xl font-semibold"><UserName size="lg" address={peer?.address} name={peerName(peer)} /></div>
          <div className="number text-sm text-muted" role="status">{video && phase === 'active' && !remoteVideo ? t('对方关闭了摄像头') + ' · ' + status : status}</div>
        </>}
      </div>

      <div className={`relative z-[1] mt-auto px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] ${showVideo ? 'bg-gradient-to-t from-black/60 to-transparent pt-10' : ''}`}>
        {warn && <p className="pb-3 text-center text-xs text-warning" role="status">{warn}</p>}
        {audioBlocked && (
          <button onClick={() => void roomRef.current?.startAudio().then(() => setAudioBlocked(false)).catch(() => {})} className="mx-auto mb-4 flex items-center gap-2 rounded-full bg-card2 px-4 py-2 text-sm">
            <Volume2 size={16} />{t('点这里播放声音')}
          </button>
        )}
        <div className="flex items-start justify-center gap-3">
          <RoundButton color="plain" active={mic} label={mic ? t('静音') : t('已静音')} onClick={() => void toggleMic()} disabled={busy}>{mic ? <Mic size={26} /> : <MicOff size={26} />}</RoundButton>
          {video && <RoundButton color="plain" active={cam} label={cam ? t('关摄像头') : t('开摄像头')} onClick={() => void toggleCam()} disabled={busy}>{cam ? <Video size={26} /> : <VideoOff size={26} />}</RoundButton>}
          {video && <RoundButton color="plain" label={t('翻转')} onClick={() => void flip()} disabled={busy || !cam || !localVideo}><SwitchCamera size={26} /></RoundButton>}
          <RoundButton color="down" label={t('挂断')} onClick={() => void hangup()}>{phase === 'connecting' && busy ? <LoaderCircle size={26} className="animate-spin" /> : <PhoneOff size={26} />}</RoundButton>
        </div>
      </div>
    </div>
  )
}

function TrackVideo({ track, mirror, className }: { track: Track; mirror?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    track.attach(el)
    return () => { track.detach(el) }
  }, [track])
  return <video ref={ref} autoPlay playsInline muted className={`${className || ''} ${mirror ? '-scale-x-100' : ''}`} />
}

function TrackAudio({ track }: { track: Track }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    track.attach(el)
    return () => { track.detach(el) }
  }, [track])
  return <audio ref={ref} autoPlay />
}
