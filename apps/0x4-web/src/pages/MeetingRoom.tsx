// Meeting room (moved from meet.420.meme into the app on 2026-09-29; used for meetings in the web "Streaming" section. goat: live, random video, and meetings were always meant to live together).
// Flow: device pre-check → join. After joining: top bar (meeting name, timer, headcount, copy invite link), center stage (speaker view / gallery view),
// collapsible right sidebar (chat / members), bottom control bar (mic, camera, screen share, raise hand, reactions, more, leave).
// Chat, hand-raises, and reactions go through the A/V service's data channel (everyone in the meeting can send them) — not our WebSocket, and not persisted.
// Meeting APIs (/api/meet/meetings/*) accept the mobile app's regular login token, so the web client can host meetings with its own wallet login — no QR scan needed.
import type React from 'react'
import { WEB_SURFACE } from '@/lib/surface'
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { DisconnectReason, RoomEvent, Track, VideoPresets, type LocalVideoTrack, type RemoteParticipant } from 'livekit-client'
import { ArrowDown, ArrowLeft, Check, ChevronLeft, ChevronRight, Copy, DoorOpen, Hand, Share2, LayoutGrid, Link2, Lock, Maximize, MessageSquare, Mic, MicOff, MonitorUp, MoreHorizontal, Pencil, PhoneOff, Presentation, Send, ShieldCheck, ShieldOff, Smile, Sparkles, UserX, Users, Video, VideoOff, Volume2, X } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { toast } from '@/components/Toast'
import { api } from '@/lib/social'
import { MEET_CODE, meetLink, type Meeting } from '@/meet/links'
import { ShareSheet } from '@/live/LiveSheets'
import { copyText } from '@/lib/native'
import { errorText } from '@/lib/errors'
import { t } from '@/lib/i18n'
import { displayName, useSocial } from '@/store/social'
import { useLkRoom, packData, unpackData, type MeetData, type PSnap } from '@/meet/lk'
import { AudioSink, Modal, Precheck, ScreenPermissionHelp, Spinner, Tile, clock, deniedBySystem, type JoinPrefs } from '@/meet/ui'
import { AnnotateToolbar, AnnotationLayer } from '@/meet/AnnotationLayer'
import { applyAnn, canAnnotate, chunkSync, pruneLaser, sanitizeAnn, type AnnColor, type AnnMsg, type AnnTool, type Stroke } from '@/meet/annotate'
import { canManage, parseModState, roleIn, speakOk, type ModState } from '@/meet/moderation'
import '@/meet/meet.css'
import { isLobbyWaiting, useLobbyHost, useLobbyWait } from '@/meet/lobbyCore'
import { LobbyHostCard, LobbyWaiting } from '@/meet/Lobby'
import { Gift } from 'lucide-react'
import GiftPanel, { type GiftTarget } from '@/components/energy/GiftPanel'
import { GiftFxLayer, useRoomGifts, type GiftFxLayerHandle } from '@/components/energy/GiftFxLayer'
import { ENERGY_GIFTS } from '@/lib/energy'
import { reportActivity } from '@/desktop/qrIdle'
import { watchSpeaking } from '@/desktop/speakActivity'
// Video effects (2026-10-03 goat: the virtual avatar "faceless" mode must also work in meetings): same processor, same panel, same local settings (0x4.liveFx) as live streaming.
import { applyFx, processorForCamera } from '@/effects/fx'
import { loadFx, type FxSettings } from '@/effects/settings'
const EffectsPanel = lazy(() => import('@/effects/EffectsPanel'))


type Stage = 'precheck' | 'joining' | 'waiting' | 'denied' | 'in' | 'left' | 'ended' | 'kicked'
interface ChatLine { id: string; from: string; name: string; text: string; ts: number; mine: boolean }
const EMOJIS = ['👍', '👏', '🎉', '😂', '❤️', '🔥', '😮', '🙏']

/** Participant profiles (avatars) cached by address: the A/V service only gives identity = address and name */
const profileCache = new Map<string, string | null>()
function useAvatars(ids: string[]): Record<string, string | null> {
  const [, force] = useState(0)
  const key = ids.join(',')
  useEffect(() => {
    for (const id of ids) {
      if (!id || profileCache.has(id)) continue
      profileCache.set(id, null)
      api<{ avatar: string | null }>(`/api/users/${encodeURIComponent(id)}`)
        .then((p) => { profileCache.set(id, p.avatar ?? null); force((n) => n + 1) })
        .catch(() => { /* Fall back to an address-generated pixel avatar when unavailable */ })
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return Object.fromEntries(ids.map((id) => [id, profileCache.get(id) ?? null]))
}

/** Where leaving takes you: web returns to the community "Meetings" page (2026-10-01 community merge); the mobile app returns to the Streaming page (meetings live there) */
const BACK = WEB_SURFACE ? '/meetings' : '/live'

export default function MeetingRoom() {
  const { code = '' } = useParams()
  const nav = useNavigate()
  const me = useSocial((s) => s.me)
  const [info, setInfo] = useState<Meeting | null>(null)
  // Share to X / copy link (2026-09-30 goat): password-protected meeting cards show a "private channel" notice
  const [sharing, setSharing] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>('precheck')
  const lk = useLkRoom()
  const { room, parts } = lk
  // Shared computers signed in via QR: talking counts as "in use" (you won't get logged out for talking without touching the machine).
  useEffect(() => watchSpeaking(room), [room])
  const [joinedAt, setJoinedAt] = useState(0)
  const [nowTs, setNowTs] = useState(Date.now())
  const [layout, setLayout] = useState<'speaker' | 'grid'>('speaker')
  const [panel, setPanel] = useState<Panel>(null)
  const [chat, setChat] = useState<ChatLine[]>([])
  const [unread, setUnread] = useState(0)
  const [floats, setFloats] = useState<{ id: number; emoji: string; left: number; name: string }[]>([])
  const [busy, setBusy] = useState<'mic' | 'cam' | 'screen' | null>(null)
  const [leaveAsk, setLeaveAsk] = useState(false)
  const [screenHelp, setScreenHelp] = useState(false)   // Explainer shown when the OS blocks screen sharing
  // Meeting password (2026-09-30): password-protected meetings ask for it before joining; a wrong password shows a hint under the input.
  const [pw, setPw] = useState('')
  const [pwErr, setPwErr] = useState<string | null>(null)
  // Meeting moderation state (mute-all / admin / on-stage / hand-raise requests) is server-authoritative, see meet/moderation.ts
  const [mod, setMod] = useState<ModState | null>(null)
  const hands = useMemo(() => new Set(mod?.hands.map((h) => h.address) ?? []), [mod])
  // Whiteboard annotations (2026-09-30, rules in meet/annotate.ts): everyone shares one stroke set; who can draw = the current screen sharer + the host.
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const strokesRef = useRef(strokes)
  strokesRef.current = strokes
  const [annotating, setAnnotating] = useState(false)
  const [annTool, setAnnTool] = useState<AnnTool>('pen')
  const [annColor, setAnnColor] = useState<AnnColor>('red')
  const sharerId = parts.find((p) => p.screen)?.id ?? null
  const sharerRef = useRef(sharerId)
  sharerRef.current = sharerId
  const localIdRef = useRef('')
  const panelRef = useRef(panel)
  panelRef.current = panel

  useEffect(() => {
    if (!MEET_CODE.test(code)) { setLoadErr(t('会议不存在')); return }
    api<Meeting>(`/api/meet/meetings/${code}`).then((m) => { setInfo(m); if (m.endedAt) setStage('ended') }).catch((e) => setLoadErr(errorText(e, t('会议不存在'))))
  }, [code])
  useEffect(() => { if (stage !== 'in') return; const id = setInterval(() => setNowTs(Date.now()), 1000); return () => clearInterval(id) }, [stage])

  const addFloat = useCallback((emoji: string, name: string) => {
    const id = Date.now() + Math.random()
    setFloats((f) => [...f.slice(-14), { id, emoji, name, left: 4 + Math.random() * 18 }])
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 2900)
  }, [])

  // Data messages: chat / hand-raise / reactions / host ends the meeting
  useEffect(() => {
    const onData = (payload: Uint8Array, p?: RemoteParticipant) => {
      const d = unpackData(payload)
      if (!d || !p) return
      if (d.t === 'ann') {
        // Annotations: sender identity comes from the identity the A/V service assigns (never trust the one claimed inside the message); catch-up (sync) only trusts the current sharer.
        const m = sanitizeAnn(d)
        if (!m || !info || !canAnnotate(p.identity, sharerRef.current, info.host)) return
        if (m.k === 'sync' && p.identity !== sharerRef.current) return
        setStrokes((s) => applyAnn(s, m, p.identity, Date.now()))
        return
      }
      if (d.t === 'chat') {
        setChat((c) => [...c.slice(-199), { id: d.id, from: p.identity, name: p.name || p.identity, text: String(d.text).slice(0, 1000), ts: Date.now(), mine: false }])
        if (panelRef.current !== 'chat') setUnread((n) => n + 1)
      } else if (d.t === 'react' && EMOJIS.includes(d.emoji)) addFloat(d.emoji, p.name || '')
      else if (d.t === 'end' && info && p.identity === info.host) { void room.disconnect(); setStage('ended') }
    }
    // Someone new joins: if I'm the current sharer, resend the existing strokes to just that person (once their data channel is ready).
    const onJoined = (p: RemoteParticipant) => {
      if (sharerRef.current !== room.localParticipant.identity) return
      setTimeout(() => {
        if (sharerRef.current !== room.localParticipant.identity || !strokesRef.current.length) return
        for (const m of chunkSync(strokesRef.current)) void room.localParticipant.publishData(packData(m), { reliable: true, destinationIdentities: [p.identity] }).catch(() => {})
      }, 1200)
    }
    room.on(RoomEvent.DataReceived, onData)
    room.on(RoomEvent.ParticipantConnected, onJoined)
    return () => { room.off(RoomEvent.DataReceived, onData); room.off(RoomEvent.ParticipantConnected, onJoined) }
  }, [room, info, addFloat])

  // Screen share stops / switches sharer: everyone clears local annotations; if I can no longer draw, exit annotation mode.
  useEffect(() => { setStrokes([]) }, [sharerId])
  const localId = room.localParticipant.identity || me?.address || ''
  localIdRef.current = localId
  const canDraw = !!sharerId && !!info && canAnnotate(localId, sharerId, info.host)
  useEffect(() => { if (!canDraw) setAnnotating(false) }, [canDraw])
  // The laser pointer is removed once its fade-out finishes (only runs while a laser pointer exists).
  const hasLaser = strokes.some((x) => x.tool === 'laser')
  useEffect(() => {
    if (!hasLaser) return
    const id = setInterval(() => setStrokes((x) => pruneLaser(x, Date.now())), 500)
    return () => clearInterval(id)
  }, [hasLaser])
  // Esc exits annotation mode
  useEffect(() => {
    if (!annotating) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setAnnotating(false) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [annotating])

  const send = (d: MeetData) => room.localParticipant.publishData(packData(d), { reliable: true }).catch(() => {})
  /** Your own annotation strokes: apply locally first, then broadcast to everyone */
  const annLocal = (m: AnnMsg) => { setStrokes((x) => applyAnn(x, m, localIdRef.current, Date.now())); void send(m) }

  // Waiting room (2026-10-01): devices picked before joining are remembered; rejoin with the same settings once the host approves.
  const prefsRef = useRef<JoinPrefs>({ camOn: false, micOn: false })
  // Camera on: attach the processor when local settings include effects (virtual avatar / beautify / background). Virtual avatar selected but failed to attach (GPU unsupported, etc.): kill the camera immediately — never transmit the real face.
  const camTrack = () => room.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack as LocalVideoTrack | undefined
  const camOn = async (deviceId?: string) => {
    await room.localParticipant.setCameraEnabled(true, { ...(deviceId ? { deviceId } : {}), resolution: VideoPresets.h720.resolution, processor: await processorForCamera() })
    if (loadFx().avatar === 'cat' && !camTrack()?.getProcessor()) {
      await room.localParticipant.setCameraEnabled(false).catch(() => {})
      toast.error(t('虚拟形象没能打开，已先关掉摄像头'))
    }
  }
  // Changing effects mid-meeting (same approach as the live room's changeFx)
  const changeFx = async (s: FxSettings) => {
    try { await applyFx(camTrack(), s) } catch {
      if (s.avatar === 'cat') { await room.localParticipant.setCameraEnabled(false).catch(() => {}); toast.error(t('虚拟形象没能打开，已先关掉摄像头')) }
      else toast.error(t('特效没能打开'))
    }
    lk.refresh()
  }

  const join = async (prefs: JoinPrefs) => {
    prefsRef.current = prefs
    setStage('joining')
    try {
      // Password-protected meetings include the password (hosts don't need it).
      const needPw = !!info?.hasPassword && info.host !== me?.address
      const r = await api<Meeting & { token: string; url: string; state?: unknown }>(`/api/meet/meetings/${code}/join`, { method: 'POST', body: JSON.stringify(needPw ? { password: pw } : {}) })
      setPwErr(null)
      // Waiting room enabled: the server hasn't issued a token yet, so wait for the host's approval first.
      if (isLobbyWaiting(r)) { setStage('waiting'); return }
      setInfo(r)
      setMod(parseModState(r.state))
      if (!r.url) throw new Error(t('音视频服务暂不可用'))
      if (!(await lk.connect(r.url, r.token))) throw new Error(t('暂时无法连接音视频'))
      if (prefs.spkId) await room.switchActiveDevice('audiooutput', prefs.spkId).catch(() => {})
      if (prefs.micOn) await room.localParticipant.setMicrophoneEnabled(true, prefs.micId ? { deviceId: prefs.micId } : undefined).catch(() => toast.error(t('麦克风未开启')))
      if (prefs.camOn) await camOn(prefs.camId).catch(() => toast.error(t('摄像头未开启')))
      lk.refresh()
      setJoinedAt(Date.now()); setNowTs(Date.now())
      setStage('in')
    } catch (e) {
      void room.disconnect()
      const why = (e as { code?: unknown }).code
      // Password missing / wrong: stay on the pre-join page with a hint under the password box; if removed from this session: show the result page directly.
      if (why === 'PASSWORD_REQUIRED' || why === 'PASSWORD_WRONG') { setPwErr(why === 'PASSWORD_WRONG' ? t('密码不对') : t('请输入会议密码')); setStage('precheck'); return }
      if (why === 'KICKED') { setStage('kicked'); return }
      if (why === 'LOBBY_DENIED') { setStage('denied'); return }
      toast.error(errorText(e, t('暂时无法进入会议')))
      setStage(e instanceof Error && (/ended/i.test(e.message) || e.message.includes(t('会议已结束'))) ? 'ended' : 'precheck')
    }
  }

  // In the waiting room: poll every 3 seconds; once approved (or cleared from the list by the server), rejoin with the original settings; if rejected, show the result page.
  useLobbyWait(api, code, stage === 'waiting', (s) => { if (s === 'denied') setStage('denied'); else void join(prefsRef.current) })

  // In the meeting: server state changes (room metadata) apply immediately; removed by host / admin → result page; refresh buttons when your own permissions change; heartbeat every 20 s (lobby online count + fallback state sync).
  const refreshRef = useRef(lk.refresh)
  refreshRef.current = lk.refresh
  useEffect(() => {
    if (stage !== 'in') return
    const onMeta = (m?: string) => { const st = parseModState(m); if (st) setMod(st) }
    const onDisc = (reason?: DisconnectReason) => { if (reason === DisconnectReason.PARTICIPANT_REMOVED) setStage('kicked') }
    const onPerm = () => refreshRef.current()
    room.on(RoomEvent.RoomMetadataChanged, onMeta)
    room.on(RoomEvent.Disconnected, onDisc)
    room.on(RoomEvent.ParticipantPermissionsChanged, onPerm)
    const beat = setInterval(() => {
      api<{ ok: boolean; state?: unknown }>(`/api/meet/meetings/${code}/heartbeat`, { method: 'POST' })
        .then((r) => { const st = parseModState(r.state); if (st) setMod(st) }).catch(() => {})
    }, 20_000)
    return () => { room.off(RoomEvent.RoomMetadataChanged, onMeta); room.off(RoomEvent.Disconnected, onDisc); room.off(RoomEvent.ParticipantPermissionsChanged, onPerm); clearInterval(beat) }
  }, [stage, room, code])
  const myRole = roleIn(mod, localId)
  const canTalk = speakOk(mod, localId)
  // Your speaking permission changed: show a one-line notice (mute-all enabled, taken off stage, approved to go on stage).
  const prevTalk = useRef(true)
  useEffect(() => {
    if (stage === 'in' && prevTalk.current !== canTalk) {
      if (!canTalk) toast.info(mod?.muteAll ? t('已开启全员禁言，举手可申请发言') : t('你已被请下台'))
      else toast.success(t('你现在可以发言了'))
    }
    prevTalk.current = canTalk
  }, [canTalk, stage]) // eslint-disable-line react-hooks/exhaustive-deps
  /** All moderation actions go through the server, which returns the new state */
  const modAct = (path: string, body: object) => api<{ state?: unknown }>(`/api/meet/meetings/${code}/${path}`, { method: 'POST', body: JSON.stringify(body) })
    .then((r) => { const st = parseModState(r.state); if (st) setMod(st) })
    .catch((e) => toast.error(errorText(e, t('操作失败'))))
  const modActions = {
    muteAll: (on: boolean) => void modAct('mute-all', { on }),
    setAdmin: (address: string, on: boolean) => void modAct('admins', { address, on }),
    kick: (address: string) => void modAct('kick', { address }),
    stage: (address: string, action: 'approve' | 'deny' | 'remove') => void modAct('stage', { address, action }),
  }

  const local = parts.find((p) => p.isLocal)
  const toggle = async (kind: 'mic' | 'cam' | 'screen') => {
    if (busy || !local) return
    // While muted: the server has already revoked publish rights; just show a notice here (the turn-off action itself isn't blocked).
    if (!canTalk && !(kind === 'mic' ? local.mic : kind === 'cam' ? local.cam : local.screen)) { toast.info(t('全员禁言中，举手申请发言')); return }
    setBusy(kind)
    try {
      if (kind === 'mic') await room.localParticipant.setMicrophoneEnabled(!local.mic)
      else if (kind === 'cam') { if (local.cam) await room.localParticipant.setCameraEnabled(false); else await camOn() }
      else await room.localParticipant.setScreenShareEnabled(!local.screen, { audio: true })
      lk.refresh()
    } catch (e) {
      // Blocked by the OS (browser lacks screen-recording permission on Mac): pop up how to enable it; don't prompt when the user dismissed it themselves.
      if (kind === 'screen' && deniedBySystem(e)) setScreenHelp(true)
      else if (kind !== 'screen' || !(e instanceof Error && e.name === 'NotAllowedError')) toast.error(kind === 'mic' ? t('无法开启麦克风，请检查浏览器权限') : kind === 'cam' ? t('无法开启摄像头，请检查浏览器权限') : t('无法共享屏幕'))
    } finally { setBusy(null) }
  }
  // Raise hand = request to go on stage (via the server; hosts and admins approve / reject in the member list).
  const myHand = hands.has(localId)
  const toggleHand = () => void modAct('hand', { up: !myHand })
  const react = (emoji: string) => { addFloat(emoji, t('你')); void send({ t: 'react', emoji }) }
  const sendChat = (text: string) => {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    setChat((c) => [...c.slice(-199), { id, from: me?.address || '', name: t('你'), text, ts: Date.now(), mine: true }])
    void send({ t: 'chat', text, id })
    reportActivity('chat')
  }
  const copyInvite = () => copyText(meetLink(code)).then(() => toast.success(t('邀请链接已复制')), () => toast.error(t('复制失败')))
  const leave = async (end: boolean) => {
    setLeaveAsk(false)
    if (end) {
      await send({ t: 'end' })
      try { await api(`/api/meet/meetings/${code}/end`, { method: 'POST' }) } catch (e) { toast.error(errorText(e, t('失败'))) }
    }
    await room.disconnect()
    setStage(end ? 'ended' : 'left')
  }
  const isHost = !!info && !!me && info.host === me.address

  // ---------- Pre-join states ----------
  if (loadErr) return <Centered title={loadErr} action={<button className="meet-btn meet-btn-ghost" onClick={() => nav(BACK)}><ArrowLeft size={16} />{t('回到会议')}</button>} />
  if (!info) return <div className="meet-ui flex h-full items-center justify-center"><Spinner size={22} /></div>
  if (stage === 'ended') return <Centered title={t('会议已结束')} sub={info.title} action={<button className="meet-btn meet-btn-primary" onClick={() => nav(BACK)}>{t('回到会议')}</button>} />
  if (stage === 'kicked') return <Centered title={t('你已被移出本场会议')} sub={info.title} action={<button className="meet-btn meet-btn-primary" onClick={() => nav(BACK)}>{t('回到会议')}</button>} />
  if (stage === 'denied') return <Centered title={t('主持人未同意你加入')} sub={info.title} action={<button className="meet-btn meet-btn-primary" onClick={() => nav(BACK)}>{t('回到会议')}</button>} />
  if (stage === 'waiting') return <LobbyWaiting title={info.title} hostName={info.hostNickname || displayName({ address: info.host })} onCancel={() => setStage('precheck')} />
  if (stage === 'left') return <Centered title={t('你已离开会议')} sub={info.title} action={<div className="flex gap-2"><button className="meet-btn meet-btn-ghost" onClick={() => setStage('precheck')}>{t('重新加入')}</button><button className="meet-btn meet-btn-primary" onClick={() => nav(BACK)}>{t('回到会议')}</button></div>} />
  if (stage === 'precheck' || stage === 'joining') {
    return <div className="meet-ui relative flex h-full flex-col overflow-y-auto">
      <ShareSheet open={sharing} onClose={() => setSharing(false)} kind="meet" id={code} title={info.title} hostName={info.hostNickname || ''} />
      <header className="relative z-10 flex items-center px-6 py-5 lg:px-10">
        <button onClick={() => nav(BACK)} className="icon-button -ml-2" aria-label={t('返回')}><ArrowLeft size={21} /></button>
      </header>
      <div className="relative z-10 flex flex-1 items-center pb-12">
        <Precheck
          heading={<><p className="text-[13px] font-medium text-muted">{t('准备加入')}</p><h1 className="mt-2 font-display text-[32px] font-semibold leading-tight">{info.title}</h1></>}
          sub={<span>{t('主持人 {name}', { name: info.hostNickname || displayName({ address: info.host }) })}</span>}
          joinLabel={t('加入会议')}
          joining={stage === 'joining'}
          onJoin={join}
          aside={<div className="flex w-full flex-col gap-3">
          {info.hasPassword && info.host !== me?.address && <div className="meet-card w-full p-4" data-testid="meet-password">
            <label className="flex items-center gap-2 text-[13px] text-muted" htmlFor="meet-pw"><Lock size={14} />{t('会议密码')}</label>
            <input id="meet-pw" type="password" className="meet-input mt-2 h-11 w-full text-[14px]" value={pw} onChange={(e) => { setPw(e.target.value); setPwErr(null) }} placeholder={t('输入密码后加入')} maxLength={32} autoComplete="off" />
            {pwErr && <p className="mt-2 text-[12.5px] text-[#ff6b76]" role="alert">{pwErr}</p>}
          </div>}
          <div className="meet-card w-full p-4">
            <div className="flex items-center gap-2 text-[13px] text-muted"><Link2 size={14} />{t('邀请链接')}</div>
            <div className="mt-2 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{meetLink(code).replace(/^https?:\/\//, '')}</span>
              <button className="rounded-lg p-2 text-muted hover:bg-[var(--mt-2)] hover:text-fg" onClick={copyInvite} aria-label={t('复制邀请链接')}><Copy size={15} /></button>
              <button className="rounded-lg p-2 text-muted hover:bg-[var(--mt-2)] hover:text-fg" onClick={() => setSharing(true)} aria-label={t('分享')} data-testid="meet-share"><Share2 size={15} /></button>
            </div>
          </div>
          </div>}
        />
      </div>
    </div>
  }

  // ---------- In the meeting ----------
  return <>
  <InCall {...{ info, code, parts, lk, layout, setLayout, panel, setPanel, chat, unread, setUnread, hands, floats, busy, local, myHand, isHost }}
    mod={{ state: mod, me: localId, role: myRole, canTalk, ...modActions }}
    ann={{ strokes, localId, sharerId, canDraw, on: annotating, tool: annTool, color: annColor, setOn: setAnnotating, setTool: setAnnTool, setColor: setAnnColor, act: annLocal }}
    elapsed={nowTs - joinedAt} onFx={(s) => void changeFx(s)} onToggle={toggle} onHand={toggleHand} onReact={react} onChat={sendChat} onCopy={() => setSharing(true)} onLeave={() => (isHost ? setLeaveAsk(true) : void leave(false))}
    leaveModal={<Modal open={leaveAsk} onClose={() => setLeaveAsk(false)} title={t('离开会议？')} width={400}>
      <p className="text-sm text-muted">{t('你是主持人。可以自己离开，会议继续；也可以为所有人结束会议。')}</p>
      <div className="mt-6 flex flex-col gap-2">
        <button className="meet-btn meet-btn-danger w-full" onClick={() => void leave(true)}>{t('为所有人结束会议')}</button>
        <button className="meet-btn meet-btn-ghost w-full" onClick={() => void leave(false)}>{t('只是我离开')}</button>
      </div>
    </Modal>} />
    {/* Screen share blocked by the OS: explain exactly where to enable it (2026-09-30) */}
    <Modal open={screenHelp} onClose={() => setScreenHelp(false)} title={t('还不能共享窗口或整个屏幕')} width={440}>
      <p className="mb-3 text-sm text-muted">{t('系统没有给浏览器屏幕录制权限。现在仍然可以共享浏览器标签页。')}</p>
      <ScreenPermissionHelp />
      <button className="meet-btn meet-btn-primary mt-6 w-full" onClick={() => setScreenHelp(false)}>{t('知道了')}</button>
    </Modal>
    <ShareSheet open={sharing} onClose={() => setSharing(false)} kind="meet" id={code} title={info.title} hostName={info.hostNickname || ''} />
  </>
}

/** Right sidebar: chat / members / video effects */
type Panel = 'chat' | 'people' | 'fx' | null

function InCall(props: {
  info: Meeting; code: string; parts: PSnap[]; lk: ReturnType<typeof useLkRoom>; layout: 'speaker' | 'grid'; setLayout: (l: 'speaker' | 'grid') => void
  panel: Panel; setPanel: (p: Panel) => void; onFx: (s: FxSettings) => void; chat: ChatLine[]; unread: number; setUnread: (n: number) => void
  hands: Set<string>; floats: { id: number; emoji: string; left: number; name: string }[]; busy: string | null; local?: PSnap; myHand: boolean; isHost: boolean
  elapsed: number; onToggle: (k: 'mic' | 'cam' | 'screen') => void; onHand: () => void; onReact: (e: string) => void; onChat: (text: string) => void; onCopy: () => void; onLeave: () => void; leaveModal: React.ReactNode
  ann: { strokes: Stroke[]; localId: string; sharerId: string | null; canDraw: boolean; on: boolean; tool: AnnTool; color: AnnColor; setOn: (v: boolean) => void; setTool: (t: AnnTool) => void; setColor: (c: AnnColor) => void; act: (m: AnnMsg) => void }
  mod: ModCtl
}) {
  const [pwOpen, setPwOpen] = useState(false)
  const { info, code, parts, lk, layout, setLayout, panel, setPanel, chat, unread, setUnread, hands, floats, busy, local, myHand, elapsed, ann, mod } = props
  const isMod = mod.role !== 'member'
  const pending = isMod ? mod.state?.hands.length ?? 0 : 0
  // Waiting room: hosts / admins see the waiting list and in-meeting toggles.
  const lobby = useLobbyHost(api, code, isMod, !!info.lobby, (e) => toast.error(errorText(e, t('操作失败'))))
  // Annotation layer over the shared screen: only overlays whoever is currently sharing; those allowed to draw on the main view can draw once annotation mode is on, everywhere else is view-only.
  const annLayer = (p: PSnap, drawable: boolean) => p.id === ann.sharerId && p.screenTrack
    ? <AnnotationLayer strokes={ann.strokes} localId={ann.localId} drawing={drawable && ann.on && ann.canDraw} tool={ann.tool} color={ann.color} onLocal={ann.act} />
    : undefined
  const alone = parts.length <= 1
  const myStrokes = ann.strokes.some((s) => s.by === ann.localId && s.tool === 'pen')
  const [pop, setPop] = useState<'emoji' | 'more' | null>(null)
  const avatars = useAvatars(parts.map((p) => p.id))
  // Energy gifts (2026-09-30): in meetings you can only gift the host + people on stage with video or screen share on (the server double-checks).
  // Once the server confirms a gift, it's broadcast to the meeting's gift channel meet:<code>; animations play only after everyone receives it.
  const myAddr = useSocial((s) => s.me?.address)
  const fx = useRef<GiftFxLayerHandle>(null)
  const [giftOpen, setGiftOpen] = useState(false)
  useRoomGifts(`meet:${code}`, (g) => fx.current?.play(g), true)
  const giftTargets: GiftTarget[] = [
    { address: info.host, nickname: info.hostNickname, avatar: info.hostAvatar, label: t('主持人') },
    // Everyone on stage can receive (goat 10-01: mic / camera on or off doesn't matter, being on stage is what counts); when mute-all is off, everyone is on stage.
    ...parts.filter((p) => p.id !== info.host && speakOk(props.mod.state, p.id)).map((p) => ({ address: p.id, nickname: p.name, avatar: avatars[p.id] ?? null, label: p.screen ? t('正在共享') : t('台上') })),
  ].filter((x) => x.address !== myAddr)
  // Stage main view (2026-10-02 goat: when others had cameras off, the host's big screen became one avatar while my own video squeezed into a corner):
  // pinned > screen share > others currently speaking > others who recently spoke with camera on > others with camera on > nobody else on camera but I am → me > first other person > me
  const [pinned, setPinned] = useState<string | null>(null)
  const lastSpeaker = useRef<string | null>(null)
  const speaker = parts.find((p) => !p.isLocal && p.speaking)
  if (speaker) lastSpeaker.current = speaker.id
  const main = useMemo(() => parts.find((p) => p.id === pinned) || parts.find((p) => p.screen) || speaker
    || parts.find((p) => p.id === lastSpeaker.current && !p.isLocal && p.cam) || parts.find((p) => !p.isLocal && p.cam)
    || parts.find((p) => p.isLocal && p.cam) || parts.find((p) => !p.isLocal) || parts[0], [parts, pinned, speaker])
  const others = parts.filter((p) => p !== main)
  useEffect(() => { if (panel === 'chat') setUnread(0) }, [panel, setUnread])
  useEffect(() => {
    if (!pop) return
    const off = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('[data-pop]')) setPop(null) }
    window.addEventListener('mousedown', off)
    return () => window.removeEventListener('mousedown', off)
  }, [pop])
  // Gallery: at most 16 tiles per page (2026-10-02 goat asked whether many people would lag): extra pages beyond that. People not visible don't decode video (adaptiveStream auto-pauses),
  // so the machine never decodes dozens of streams at once. Sort order: screen sharers and camera-on users first — page one is always the most content-rich people.
  const GALLERY_PAGE = 16
  const [gPage, setGPage] = useState(0)
  const ordered = useMemo(() => [...parts].sort((a, b) => Number(!!b.screen) - Number(!!a.screen) || Number(!!b.cam) - Number(!!a.cam)), [parts])
  const gPages = Math.max(1, Math.ceil(ordered.length / GALLERY_PAGE))
  const gCur = Math.min(gPage, gPages - 1)
  const gShown = ordered.slice(gCur * GALLERY_PAGE, gCur * GALLERY_PAGE + GALLERY_PAGE)
  const gridCols = gShown.length <= 1 ? 1 : gShown.length <= 4 ? 2 : gShown.length <= 9 ? 3 : 4

  return <div className="meet-ui flex h-full flex-col bg-[var(--mt-page)]" data-testid="in-call">
    {/* Top bar */}
    <header className="relative flex h-16 shrink-0 items-center gap-4 px-6">
      {/* Annotation toolbar (2026-10-02 goat): centered in the top bar — in the gap between the meeting name on the left and mute-all on the right, taking no video space */}
      {layout === 'speaker' && main && <div className="pointer-events-none absolute inset-x-0 top-1/2 z-20 flex -translate-y-1/2 justify-center"><div className="pointer-events-auto">{ann.on && ann.canDraw && main.id === ann.sharerId && <AnnotateToolbar tool={ann.tool} color={ann.color} onTool={ann.setTool} onColor={ann.setColor} onUndo={() => ann.act({ t: 'ann', k: 'undo' })} onClear={() => ann.act({ t: 'ann', k: 'clear' })} onExit={() => ann.setOn(false)} canUndo={myStrokes} canClear={ann.strokes.length > 0} />}</div></div>}
      <div className="min-w-0">
        <div className="truncate text-[15px] font-semibold tracking-tight">{info.title}</div>
        <div className="font-mono text-[11px] text-muted">{code}</div>
      </div>
      <span className="meet-hairline ml-2 flex items-center gap-1.5 rounded-full bg-[var(--mt-2)] px-3 py-1 text-[12.5px] tabular-nums text-fg/90"><span className="h-1.5 w-1.5 rounded-full bg-[#ff6b76]" />{clock(elapsed)}</span>
      {lk.state === 'reconnecting' && <span className="flex items-center gap-2 text-[12.5px] text-[#ffc9a8]"><Spinner size={12} />{t('正在重新连接')}</span>}
      {mod.state?.muteAll && <span className="flex items-center gap-1.5 rounded-full bg-[#ff6b76]/15 px-3 py-1 text-[12px] font-medium text-[#ff9aa2]"><MicOff size={13} />{t('全员禁言中')}</span>}
      <div className="ml-auto flex items-center gap-2">
        {/* Hand-raise requests: hosts / admins see a prominent pending count, then open the member list to handle them */}
        {pending > 0 && <button className="meet-btn h-9 animate-pulse bg-[#ffc9a8] px-3 text-[13px] font-semibold text-[#1a1208]" onClick={() => setPanel('people')} data-testid="hands-pending"><Hand size={15} />{t('{n} 人申请发言', { n: pending })}</button>}
        {isMod && <button className={`meet-btn h-9 px-3 text-[13px] ${mod.state?.muteAll ? 'bg-[#ff6b76] font-semibold text-[#1b0a0c]' : 'meet-btn-ghost'}`} onClick={() => mod.muteAll(!mod.state?.muteAll)} data-testid="mute-all">{mod.state?.muteAll ? <><Mic size={15} />{t('解除全员禁言')}</> : <><MicOff size={15} />{t('全员禁言')}</>}</button>}
        <button className="meet-btn meet-btn-ghost h-9 px-3 text-[13px]" onClick={() => setPanel(panel === 'people' ? null : 'people')}><Users size={15} /><span className="tabular-nums">{parts.length}</span></button>
        {/* 2026-09-30 goat: the "you're the only one here" floating banner in the middle of the stage covered shared screens, so it was removed; now a primary button here, with a highlight glow when you're the only one in the meeting */}
        <button className={`meet-btn meet-btn-primary h-9 px-3.5 text-[13px] ${alone ? 'meet-invite-glow' : ''}`} onClick={props.onCopy} data-testid="copy-invite" title={alone ? t('只有你在会议里。把链接发给要参加的人') : undefined}><Copy size={14} />{t('复制邀请链接')}</button>
      </div>
    </header>

    <div className="flex min-h-0 flex-1 gap-3 px-4">
      {/* Stage */}
      <section className="relative min-w-0 flex-1" aria-label={t('舞台')}>
        <GiftFxLayer ref={fx} />
        {layout === 'speaker' && main ? <div className="flex h-full gap-3">
          <div className="relative min-w-0 flex-1" onDoubleClick={() => { if (!ann.on) setPinned(pinned ? null : main.id) }}><Tile p={main} big hand={hands.has(main.id)} avatar={avatars[main.id]} overlay={annLayer(main, true)} />
            {pinned && <button className="absolute right-3 top-3 rounded-full bg-black/55 px-3 py-1 text-xs text-white" onClick={() => setPinned(null)}>{t('取消固定')}</button>}
          </div>
          {others.length > 0 && <div className="hidden w-[232px] shrink-0 flex-col gap-3 overflow-y-auto pb-1 md:flex">
            {others.map((p) => <button key={p.id} className="aspect-video w-full shrink-0 text-left" onClick={() => setPinned(p.id)} title={t('固定到主画面')}><Tile p={p} hand={hands.has(p.id)} avatar={avatars[p.id]} overlay={annLayer(p, false)} /></button>)}
          </div>}
        </div> : <div className={`relative h-full ${gPages > 1 ? 'px-12' : ''}`}>
          <div className="meet-gallery" style={{ '--cols': gridCols, '--rows': Math.ceil(gShown.length / gridCols) } as React.CSSProperties}>
            {/* Gallery: each tile 16:9; tile width takes the smaller of "fits horizontally" and "fits vertically" so one screen holds everything without overlap (2026-10-02 screenshot: tile 3 covered tile 1) */}
            {gShown.map((p) => <div key={p.id}><Tile p={p} hand={hands.has(p.id)} avatar={avatars[p.id]} overlay={annLayer(p, false)} /></div>)}
          </div>
          {gPages > 1 && <>
            <button type="button" className="meet-ctl absolute left-0 top-1/2 -translate-y-1/2 disabled:opacity-30" disabled={gCur === 0} onClick={() => setGPage(gCur - 1)} aria-label={t('上一页')}><ChevronLeft size={20} /></button>
            <button type="button" className="meet-ctl absolute right-0 top-1/2 -translate-y-1/2 disabled:opacity-30" disabled={gCur >= gPages - 1} onClick={() => setGPage(gCur + 1)} aria-label={t('下一页')}><ChevronRight size={20} /></button>
            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-xs text-white/80 num">{t('第 {a} / {b} 页', { a: gCur + 1, b: gPages })}</span>
          </>}
        </div>}
        {/* Floating reactions */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {floats.map((f) => <div key={f.id} className="meet-float-up absolute bottom-6 flex flex-col items-center" style={{ left: `${f.left}%` }}><span className="text-[40px] leading-none">{f.emoji}</span><span className="mt-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">{f.name}</span></div>)}
        </div>
        {lk.audioBlocked && <button className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black shadow-lg" onClick={() => void lk.startAudio()}><Volume2 size={16} />{t('点这里开启声音')}</button>}
      </section>

      {/* Sidebar */}
      {panel === 'fx' && <div className="meet-fade meet-hairline meet-glass meet-fx flex w-[340px] shrink-0 flex-col overflow-hidden rounded-[20px] bg-[var(--mt-surface)]">
        <Suspense fallback={null}><EffectsPanel title={t('画面特效')} onClose={() => setPanel(null)} onChange={props.onFx} /></Suspense>
      </div>}
      {panel && panel !== 'fx' && <aside className="meet-fade meet-hairline meet-glass flex w-[340px] shrink-0 flex-col overflow-hidden rounded-[20px] bg-[var(--mt-surface)]">
        <div className="flex items-center gap-1 p-2">
          {(['chat', 'people'] as const).map((k) => <button key={k} onClick={() => setPanel(k)} className={`flex-1 rounded-xl py-2 text-[13px] font-medium transition ${panel === k ? 'bg-[var(--mt-3)] text-fg' : 'text-muted hover:text-fg'}`}>{k === 'chat' ? t('聊天') : t('成员 {n}', { n: parts.length })}</button>)}
          <button className="rounded-xl p-2 text-muted hover:bg-[var(--mt-2)] hover:text-fg" onClick={() => setPanel(null)} aria-label={t('关闭')}><X size={16} /></button>
        </div>
        {panel === 'chat' ? <ChatPanel lines={chat} onSend={props.onChat} locked={!mod.canTalk} /> : <PeoplePanel parts={parts} hands={hands} host={info.host} avatars={avatars} onCopy={props.onCopy} mod={mod} />}
      </aside>}
    </div>

    {ENERGY_GIFTS && giftOpen && <GiftPanel open onClose={() => setGiftOpen(false)} room={`meet:${code}`} targets={giftTargets} />}
    {/* Bottom control bar. z-30: its pop-up menus (more, reactions) must render above the stage — during gallery screen-sharing the camera PiP at bottom-right is z-10,\n        and menus used to have no z-index and got covered by it (2026-10-02 goat) */}
    <footer className="relative z-30 flex h-[88px] shrink-0 items-center px-6">
      <div className="hidden w-1/4 min-w-0 items-center gap-2 text-[13px] text-muted lg:flex"><span className="truncate font-mono">{code}</span></div>
      <div className="meet-dock flex flex-1 items-center justify-center gap-2.5">
        <button className="meet-ctl meet-tip" data-off={!local?.mic} data-locked={!mod.canTalk || undefined} data-tip={!mod.canTalk ? t('全员禁言中，举手申请发言') : local?.mic ? t('关闭麦克风') : t('开启麦克风')} disabled={busy === 'mic'} onClick={() => props.onToggle('mic')} aria-label={t('麦克风')} data-testid="ctl-mic">{local?.mic ? <Mic size={20} /> : <MicOff size={20} />}</button>
        <button className="meet-ctl meet-tip" data-off={!local?.cam} data-locked={!mod.canTalk || undefined} data-tip={!mod.canTalk ? t('全员禁言中，举手申请发言') : local?.cam ? t('关闭摄像头') : t('开启摄像头')} disabled={busy === 'cam'} onClick={() => props.onToggle('cam')} aria-label={t('摄像头')} data-testid="ctl-cam">{local?.cam ? <Video size={20} /> : <VideoOff size={20} />}</button>
        {/* Video effects: virtual avatar (faceless), beautify, background swap */}
        <button className="meet-ctl meet-tip" data-on={panel === 'fx'} data-tip={t('虚拟形象和美颜')} onClick={() => setPanel(panel === 'fx' ? null : 'fx')} aria-label={t('画面特效')} data-testid="ctl-fx"><Sparkles size={20} /></button>
        <button className="meet-ctl meet-tip" data-on={!!local?.screen} data-locked={!mod.canTalk || undefined} data-tip={!mod.canTalk ? t('全员禁言中，举手申请发言') : local?.screen ? t('停止共享') : t('共享屏幕')} disabled={busy === 'screen'} onClick={() => props.onToggle('screen')} aria-label={t('共享屏幕')}><MonitorUp size={20} /></button>
        {ann.canDraw && <button className="meet-ctl meet-tip" data-on={ann.on} data-tip={ann.on ? t('退出标注') : t('在共享画面上标注')} onClick={() => { if (!ann.on) { setLayout('speaker'); setPinned(null) } ann.setOn(!ann.on) }} aria-label={t('标注')} data-testid="ctl-annotate"><Pencil size={19} /></button>}
        {ENERGY_GIFTS && giftTargets.length > 0 && <button className="meet-ctl meet-tip" data-tip={t('送礼物')} onClick={() => setGiftOpen(true)} aria-label={t('送礼物')} data-testid="ctl-gift"><Gift size={20} /></button>}
        <button className="meet-ctl meet-tip" data-on={myHand} data-tip={myHand ? t('取消申请') : t('举手申请发言')} onClick={props.onHand} aria-label={t('举手')} data-testid="ctl-hand"><Hand size={20} /></button>
        <div className="relative" data-pop>
          <button className="meet-ctl meet-tip" data-on={pop === 'emoji'} data-tip={t('表情')} onClick={() => setPop(pop === 'emoji' ? null : 'emoji')} aria-label={t('表情')}><Smile size={20} /></button>
          {pop === 'emoji' && <div className="meet-fade meet-glass absolute bottom-[calc(100%+12px)] left-1/2 flex -translate-x-1/2 gap-1 rounded-full bg-[var(--mt-panel)] p-1.5 shadow-[0_20px_60px_-10px_var(--mt-shadow),inset_0_0_0_1px_var(--mt-line)]">
            {EMOJIS.map((e) => <button key={e} className="flex h-10 w-10 items-center justify-center rounded-full text-[22px] transition hover:scale-110 hover:bg-[var(--mt-3)]" onClick={() => props.onReact(e)}>{e}</button>)}
          </div>}
        </div>
        <div className="relative" data-pop>
          <button className="meet-ctl meet-tip" data-on={pop === 'more'} data-tip={t('更多')} onClick={() => setPop(pop === 'more' ? null : 'more')} aria-label={t('更多')}><MoreHorizontal size={20} /></button>
          {pop === 'more' && <div className="meet-fade meet-glass absolute bottom-[calc(100%+12px)] left-1/2 w-60 -translate-x-1/2 rounded-2xl bg-[var(--mt-panel)] p-1.5 text-[13.5px] shadow-[0_20px_60px_-10px_var(--mt-shadow),inset_0_0_0_1px_var(--mt-line)]">
            <MenuItem icon={<Presentation size={16} />} label={t('演讲者视图')} active={layout === 'speaker'} onClick={() => { setLayout('speaker'); setPop(null) }} />
            <MenuItem icon={<LayoutGrid size={16} />} label={t('画廊视图')} active={layout === 'grid'} onClick={() => { setLayout('grid'); setPop(null) }} />
            <div className="my-1 h-px bg-line" />
            <MenuItem icon={<Maximize size={16} />} label={t('全屏')} onClick={() => { void document.documentElement.requestFullscreen?.().catch(() => {}); setPop(null) }} />
            {/* Copy-invite-link doesn't go here (2026-10-02 goat: it duplicates the top-right button) */}
            {/* Host changes / removes the password (2026-09-30 goat); people already in the meeting are unaffected */}
            {props.isHost && <MenuItem icon={<Lock size={16} />} label={t('会议密码')} onClick={() => { setPwOpen(true); setPop(null) }} />}
            {/* Waiting-room toggle (2026-10-01 goat): hosts and admins; turning it off admits everyone currently waiting */}
            {isMod && <MenuItem icon={<DoorOpen size={16} />} label={t('等候室')} active={lobby.on} onClick={() => { void lobby.toggle(!lobby.on); setPop(null) }} />}
          </div>}
        </div>
        <button className="ml-2 inline-flex h-12 items-center gap-2 rounded-full bg-[#ff6b76] px-5 text-[14px] font-semibold text-[#1b0a0c] transition hover:brightness-110" onClick={props.onLeave} aria-label={t('离开')} data-testid="leave"><PhoneOff size={19} />{t('离开')}</button>
      </div>
      <div className="flex w-1/4 items-center justify-end gap-1.5">
        <button className={`meet-ctl meet-tip !h-11 !w-11 ${panel === 'people' ? '!bg-[var(--mt-4)]' : '!bg-transparent hover:!bg-[var(--mt-3)]'}`} data-tip={t('成员')} onClick={() => setPanel(panel === 'people' ? null : 'people')} aria-label={t('成员')}><Users size={19} /></button>
        <button className={`meet-ctl meet-tip !h-11 !w-11 ${panel === 'chat' ? '!bg-[var(--mt-4)]' : '!bg-transparent hover:!bg-[var(--mt-3)]'}`} data-tip={t('聊天')} onClick={() => setPanel(panel === 'chat' ? null : 'chat')} aria-label={t('聊天')} data-testid="ctl-chat">
          <MessageSquare size={19} />{unread > 0 && panel !== 'chat' && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-[#121318]">{unread > 9 ? '9+' : unread}</span>}
        </button>
        {mod.role !== 'member' && <span className="meet-hairline ml-2 hidden rounded-full px-2.5 py-1 text-[11px] font-medium text-muted xl:inline">{mod.role === 'host' ? t('主持人') : t('管理员')}</span>}
      </div>
    </footer>
    {parts.filter((p) => p.audioTrack).map((p) => <AudioSink key={p.id} track={p.audioTrack!} />)}
    {props.leaveModal}
    {pwOpen && <PasswordModal code={props.code} hasPassword={!!props.info.hasPassword} onClose={() => setPwOpen(false)} />}
    <LobbyHostCard lobby={lobby} />
  </div>
}

function MenuItem({ icon, label, onClick, active }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-fg/90 hover:bg-[var(--mt-2)]"><span className="text-muted">{icon}</span><span className="flex-1">{label}</span>{active && <Check size={15} className="text-accent" />}</button>
}

function ChatPanel({ lines, onSend, locked }: { lines: ChatLine[]; onSend: (text: string) => void; locked?: boolean }) {
  const [draft, setDraft] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' }) }, [lines.length])
  const submit = () => { const s = draft.trim(); if (!s) return; onSend(s.slice(0, 1000)); setDraft('') }
  return <>
    <div ref={box} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
      {!lines.length && <p className="px-2 pt-8 text-center text-[13px] leading-relaxed text-muted">{t('会议里的消息只有在场的人能看到，离开后不保留。')}</p>}
      {lines.map((l) => <div key={l.id} className="meet-fade">
        <div className="flex items-baseline gap-2 text-[12px]"><span className={`font-semibold ${l.mine ? 'text-accent' : 'text-fg/90'}`}>{l.name}</span><span className="text-muted">{new Date(l.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
        <div className="mt-1 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-fg/90">{l.text}</div>
      </div>)}
    </div>
    <form className="flex items-center gap-2 p-3" onSubmit={(e) => { e.preventDefault(); submit() }}>
      <input className="meet-input h-11 flex-1 rounded-full text-[13.5px]" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={locked ? t('全员禁言中') : t('发消息给所有人')} maxLength={1000} disabled={locked} data-testid="chat-input" />
      <button type="submit" disabled={locked || !draft.trim()} className="meet-brand-fill flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#121318] transition disabled:opacity-30" aria-label={t('发送')}><Send size={16} /></button>
    </form>
  </>
}

/** Meeting moderation: state and actions used by InCall (all server-side) */
interface ModCtl {
  state: ModState | null; me: string; role: 'host' | 'admin' | 'member'; canTalk: boolean
  muteAll: (on: boolean) => void; setAdmin: (address: string, on: boolean) => void; kick: (address: string) => void; stage: (address: string, action: 'approve' | 'deny' | 'remove') => void
}

function PeoplePanel({ parts, hands, host, avatars, onCopy, mod }: { parts: PSnap[]; hands: Set<string>; host: string; avatars: Record<string, string | null>; onCopy: () => void; mod: ModCtl }) {
  const st = mod.state
  const sorted = [...parts].sort((a, b) => Number(hands.has(b.id)) - Number(hands.has(a.id)) || Number(b.id === host) - Number(a.id === host) || Number(b.isLocal) - Number(a.isLocal))
  const [menu, setMenu] = useState<string | null>(null)
  const isMod = mod.role !== 'member'
  const nameOf = (id: string) => parts.find((p) => p.id === id)?.name || st?.hands.find((h) => h.address === id)?.name || id.slice(0, 6)
  return <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
    <button onClick={onCopy} className="mx-2 mb-2 flex w-[calc(100%-16px)] items-center gap-3 rounded-xl px-3 py-3 text-left text-[13.5px] hover:bg-[var(--mt-2)]"><span className="meet-brand-fill flex h-9 w-9 items-center justify-center rounded-full text-[#121318]"><Link2 size={16} /></span><span className="flex-1">{t('邀请别人加入')}</span><ChevronRight size={15} className="text-muted" /></button>
    {/* Hand-raise requests (hosts / admins): approving lets the person unmute, turn on camera, and share screen */}
    {isMod && !!st?.hands.length && <div className="mx-2 mb-2 rounded-2xl bg-[#ffc9a8]/10 p-2" data-testid="hand-requests">
      <div className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-[.14em] text-[#ffc9a8]">{t('申请发言')}</div>
      {st.hands.map((h) => <div key={h.address} className="flex items-center gap-2 rounded-xl px-2 py-2">
        <Avatar address={h.address} src={avatars[h.address]} name={h.name} size={28} />
        <span className="min-w-0 flex-1 truncate text-[13px]">{nameOf(h.address)}</span>
        <button className="meet-btn meet-btn-primary h-8 px-3 text-[12.5px]" onClick={() => mod.stage(h.address, 'approve')} data-testid="approve-hand">{t('批准')}</button>
        <button className="meet-btn meet-btn-ghost h-8 px-3 text-[12.5px]" onClick={() => mod.stage(h.address, 'deny')}>{t('拒绝')}</button>
      </div>)}
    </div>}
    <div className="px-4 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[.14em] text-muted">{t('在会议中')}</div>
    {sorted.map((p) => {
      const r = roleIn(st, p.id), onStage = !!st?.stage.includes(p.id), manage = canManage(st, mod.me, p.id)
      return <div key={p.id} className="relative flex items-center gap-3 rounded-xl px-4 py-2.5 hover:bg-[var(--mt-1)]">
        <Avatar address={p.id} src={avatars[p.id]} name={p.name} size={34} />
        <div className="min-w-0 flex-1"><div className="truncate text-[13.5px]">{p.name}{p.isLocal ? ` (${t('你')})` : ''}</div>
          {(r !== 'member' || onStage) && <div className="text-[11px] text-muted">{r === 'host' ? t('主持人') : r === 'admin' ? t('管理员') : t('台上发言')}</div>}</div>
        {hands.has(p.id) && <Hand size={15} className="text-[#ffc9a8]" />}
        {p.mic ? <Mic size={15} className={p.speaking ? 'text-[#8fe0ff]' : 'text-muted'} /> : <MicOff size={15} className="text-[#ff6b76]" />}
        {manage && <button className="rounded-lg p-1.5 text-muted hover:bg-[var(--mt-3)] hover:text-fg" onClick={() => setMenu(menu === p.id ? null : p.id)} aria-label={t('管理')} data-testid={`manage-${p.id}`}><MoreHorizontal size={16} /></button>}
        {menu === p.id && manage && <div className="meet-fade meet-glass absolute right-3 top-[calc(100%-4px)] z-20 w-48 rounded-2xl bg-[var(--mt-panel)] p-1.5 text-[13px] shadow-[0_20px_60px_-10px_var(--mt-shadow),inset_0_0_0_1px_var(--mt-line)]" onMouseLeave={() => setMenu(null)}>
          {mod.role === 'host' && (r === 'admin'
            ? <MenuItem icon={<ShieldOff size={15} />} label={t('撤销管理员')} onClick={() => { mod.setAdmin(p.id, false); setMenu(null) }} />
            : <MenuItem icon={<ShieldCheck size={15} />} label={t('设为管理员')} onClick={() => { mod.setAdmin(p.id, true); setMenu(null) }} />)}
          {onStage && <MenuItem icon={<ArrowDown size={15} />} label={t('请下台')} onClick={() => { mod.stage(p.id, 'remove'); setMenu(null) }} />}
          <MenuItem icon={<UserX size={15} />} label={t('移出会议')} onClick={() => { mod.kick(p.id); setMenu(null) }} />
        </div>}
      </div>
    })}
  </div>
}

function Centered({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return <div className="meet-ui relative flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
    <h1 className="font-display relative mt-4 text-[28px] font-semibold">{title}</h1>
    {sub && <p className="relative text-muted">{sub}</p>}
    <div className="relative mt-5">{action}</div>
  </div>
}

/** Host changes the meeting password: set a new one or remove it (4–32 chars). People already in the meeting are unaffected; later joiners follow the new setting */
function PasswordModal({ code, hasPassword, onClose }: { code: string; hasPassword: boolean; onClose: () => void }) {
  const [on, setOn] = useState(hasPassword)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const save = async (password: string) => {
    if (password && (password.length < 4 || password.length > 32)) { setErr(t('密码需要 4~32 位')); return }
    setBusy(true); setErr(null)
    try {
      const r = await api<{ hasPassword: boolean }>(`/api/meet/meetings/${code}/password`, { method: 'POST', body: JSON.stringify({ password }) })
      setOn(r.hasPassword)
      toast.success(r.hasPassword ? t('会议密码已更新') : t('已去掉会议密码'))
      onClose()
    } catch (e) { setErr(errorText(e, t('失败'))) } finally { setBusy(false) }
  }
  return <Modal open onClose={onClose} title={t('会议密码')} width={400}>
    <p className="text-sm text-muted">{on ? t('当前需要密码才能加入') : t('当前任何人都可以加入')}</p>
    <input type="password" className="meet-input mt-4 h-11 w-full text-[14px]" value={pw} onChange={(e) => { setPw(e.target.value); setErr(null) }} placeholder={on ? t('输入新密码') : t('设置密码（4~32 位）')} maxLength={32} autoComplete="new-password" data-testid="meet-new-pw" />
    {err && <p className="mt-2 text-[12.5px] text-[#ff9aa2]">{err}</p>}
    <div className="mt-5 flex flex-col gap-2">
      <button className="meet-btn meet-btn-primary w-full" disabled={busy || !pw} onClick={() => void save(pw)}>{busy ? <Spinner size={16} /> : t('保存密码')}</button>
      {on && <button className="meet-btn meet-btn-ghost w-full" disabled={busy} onClick={() => void save('')}>{t('去掉密码，公开会议')}</button>}
    </div>
  </Modal>
}
