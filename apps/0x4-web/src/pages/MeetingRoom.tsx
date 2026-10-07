// 会议室（2026-09-29 从 meet.420.meme 的会议室搬进 App，网页版「流媒体」里开会用；goat：直播、随机视频、会议原本就放一起）。
// 流程：设备预检 → 进会。进会后：顶部栏（会议名、计时、人数、复制邀请链接）、中间舞台（演讲者视图 / 画廊视图）、
// 右侧可折叠侧栏（聊天 / 成员）、底部控制条（麦克风、摄像头、共享屏幕、举手、表情、更多、离开）。
// 聊天、举手、表情走音视频服务的数据通道（会议里人人可发），不经过我们的 WebSocket，也不保留。
// 会议接口（/api/meet/meetings/*）认手机 App 的普通登录令牌，所以网页版用自己的钱包登录就能开会，不用扫码。
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
// 画面特效（2026-10-03 goat：会议里也要能用虚拟形象「不露脸」）：和直播同一套处理器、同一块面板、同一份本机设置（0x4.liveFx）
import { applyFx, processorForCamera } from '@/effects/fx'
import { loadFx, type FxSettings } from '@/effects/settings'
const EffectsPanel = lazy(() => import('@/effects/EffectsPanel'))


type Stage = 'precheck' | 'joining' | 'waiting' | 'denied' | 'in' | 'left' | 'ended' | 'kicked'
interface ChatLine { id: string; from: string; name: string; text: string; ts: number; mine: boolean }
const EMOJIS = ['👍', '👏', '🎉', '😂', '❤️', '🔥', '😮', '🙏']

/** 参与者资料（头像）按地址缓存：音视频服务里只有 identity = 地址和名字 */
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
        .catch(() => { /* 拿不到就用地址像素头像 */ })
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return Object.fromEntries(ids.map((id) => [id, profileCache.get(id) ?? null]))
}

/** 离开会议回哪：网页版回社区「会议」页（2026-10-01 社区合并），手机 App 回流媒体页（会议在那一页） */
const BACK = WEB_SURFACE ? '/meetings' : '/live'

export default function MeetingRoom() {
  const { code = '' } = useParams()
  const nav = useNavigate()
  const me = useSocial((s) => s.me)
  const [info, setInfo] = useState<Meeting | null>(null)
  // 分享到 X / 复制链接（2026-09-30 goat）：有密码的会议卡片显示「私人频道，您无法观看。」
  const [sharing, setSharing] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>('precheck')
  const lk = useLkRoom()
  const { room, parts } = lk
  // 扫码登录的公共电脑：自己在说话算「在用」（不会因为一直在讲话却没碰电脑被退出）
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
  const [screenHelp, setScreenHelp] = useState(false)   // 共享屏幕被系统拦下时的说明
  // 会议密码（2026-09-30）：有密码的会议在进会前输入；错了在输入框下提示
  const [pw, setPw] = useState('')
  const [pwErr, setPwErr] = useState<string | null>(null)
  // 会议管理状态（全员禁言 / 管理员 / 台上 / 举手申请），以服务器为准，见 meet/moderation.ts
  const [mod, setMod] = useState<ModState | null>(null)
  const hands = useMemo(() => new Set(mod?.hands.map((h) => h.address) ?? []), [mod])
  // 画笔标注（2026-09-30，规则见 meet/annotate.ts）：所有人共用一份笔画，能画的人 = 正在共享屏幕的人 + 主持人
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

  // 数据消息：聊天 / 举手 / 表情 / 主持人结束会议
  useEffect(() => {
    const onData = (payload: Uint8Array, p?: RemoteParticipant) => {
      const d = unpackData(payload)
      if (!d || !p) return
      if (d.t === 'ann') {
        // 标注：发送者身份用音视频服务给的 identity 判断（不信消息里自报的）；补发（sync）只认当前共享者
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
    // 有人新进来：我是当前共享者，就把现有笔画补发给他一个人（等他那边接好数据通道）
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

  // 停止共享 / 换人共享：所有人本地清空标注；自己不再能画就退出标注
  useEffect(() => { setStrokes([]) }, [sharerId])
  const localId = room.localParticipant.identity || me?.address || ''
  localIdRef.current = localId
  const canDraw = !!sharerId && !!info && canAnnotate(localId, sharerId, info.host)
  useEffect(() => { if (!canDraw) setAnnotating(false) }, [canDraw])
  // 激光笔淡出完就去掉（只在有激光笔时跑）
  const hasLaser = strokes.some((x) => x.tool === 'laser')
  useEffect(() => {
    if (!hasLaser) return
    const id = setInterval(() => setStrokes((x) => pruneLaser(x, Date.now())), 500)
    return () => clearInterval(id)
  }, [hasLaser])
  // Esc 退出标注
  useEffect(() => {
    if (!annotating) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setAnnotating(false) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [annotating])

  const send = (d: MeetData) => room.localParticipant.publishData(packData(d), { reliable: true }).catch(() => {})
  /** 自己的标注动作：本地先生效，再发给所有人 */
  const annLocal = (m: AnnMsg) => { setStrokes((x) => applyAnn(x, m, localIdRef.current, Date.now())); void send(m) }

  // 等候室（2026-10-01）：进会时选的设备记下来，主持人同意后用同一套设置再进一次
  const prefsRef = useRef<JoinPrefs>({ camOn: false, micOn: false })
  // 开摄像头：本机设置里有特效（虚拟形象 / 美颜 / 背景）就带上处理器。选了虚拟形象却没挂上（显卡不支持等）：马上关掉摄像头，绝不发出真人画面
  const camTrack = () => room.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack as LocalVideoTrack | undefined
  const camOn = async (deviceId?: string) => {
    await room.localParticipant.setCameraEnabled(true, { ...(deviceId ? { deviceId } : {}), resolution: VideoPresets.h720.resolution, processor: await processorForCamera() })
    if (loadFx().avatar === 'cat' && !camTrack()?.getProcessor()) {
      await room.localParticipant.setCameraEnabled(false).catch(() => {})
      toast.error(t('虚拟形象没能打开，已先关掉摄像头'))
    }
  }
  // 会议中改特效（和直播间 changeFx 同一个做法）
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
      // 有密码的会议带上密码（主持人不用）
      const needPw = !!info?.hasPassword && info.host !== me?.address
      const r = await api<Meeting & { token: string; url: string; state?: unknown }>(`/api/meet/meetings/${code}/join`, { method: 'POST', body: JSON.stringify(needPw ? { password: pw } : {}) })
      setPwErr(null)
      // 开了等候室：服务器没给令牌，先等主持人同意
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
      // 密码没输 / 输错：留在进会前的页面，在密码框下提示；被移出本场的：直接显示结果页
      if (why === 'PASSWORD_REQUIRED' || why === 'PASSWORD_WRONG') { setPwErr(why === 'PASSWORD_WRONG' ? t('密码不对') : t('请输入会议密码')); setStage('precheck'); return }
      if (why === 'KICKED') { setStage('kicked'); return }
      if (why === 'LOBBY_DENIED') { setStage('denied'); return }
      toast.error(errorText(e, t('暂时无法进入会议')))
      setStage(e instanceof Error && (/ended/i.test(e.message) || e.message.includes(t('会议已结束'))) ? 'ended' : 'precheck')
    }
  }

  // 在等候室：每 3 秒问一次；同意了（或者被服务器清出列表）就用原来的设置再进一次，拒绝了显示结果页
  useLobbyWait(api, code, stage === 'waiting', (s) => { if (s === 'denied') setStage('denied'); else void join(prefsRef.current) })

  // 会议中：服务器改了状态（房间元数据）马上更新；被主持人 / 管理员移出 → 结果页；自己的权限变了刷新按钮；每 20 秒心跳（大厅在线人数 + 兜底同步状态）
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
  // 自己能不能说话变了：给一句提示（开全员禁言、被请下台、批准上台）
  const prevTalk = useRef(true)
  useEffect(() => {
    if (stage === 'in' && prevTalk.current !== canTalk) {
      if (!canTalk) toast.info(mod?.muteAll ? t('已开启全员禁言，举手可申请发言') : t('你已被请下台'))
      else toast.success(t('你现在可以发言了'))
    }
    prevTalk.current = canTalk
  }, [canTalk, stage]) // eslint-disable-line react-hooks/exhaustive-deps
  /** 管理操作都走服务器，返回新状态 */
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
    // 禁言中：服务器已经收回推流权限，这里只给一句提示（关掉的操作不拦）
    if (!canTalk && !(kind === 'mic' ? local.mic : kind === 'cam' ? local.cam : local.screen)) { toast.info(t('全员禁言中，举手申请发言')); return }
    setBusy(kind)
    try {
      if (kind === 'mic') await room.localParticipant.setMicrophoneEnabled(!local.mic)
      else if (kind === 'cam') { if (local.cam) await room.localParticipant.setCameraEnabled(false); else await camOn() }
      else await room.localParticipant.setScreenShareEnabled(!local.screen, { audio: true })
      lk.refresh()
    } catch (e) {
      // 被系统拦下（Mac 没给浏览器屏幕录制权限）：弹出怎么打开；用户自己点取消的不提示
      if (kind === 'screen' && deniedBySystem(e)) setScreenHelp(true)
      else if (kind !== 'screen' || !(e instanceof Error && e.name === 'NotAllowedError')) toast.error(kind === 'mic' ? t('无法开启麦克风，请检查浏览器权限') : kind === 'cam' ? t('无法开启摄像头，请检查浏览器权限') : t('无法共享屏幕'))
    } finally { setBusy(null) }
  }
  // 举手 = 申请上台（走服务器，主持人和管理员在成员列表里批准 / 拒绝）
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

  // ---------- 会议外的几种状态 ----------
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

  // ---------- 会议中 ----------
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
    {/* 共享屏幕被系统拦下：说清楚去哪里打开（2026-09-30） */}
    <Modal open={screenHelp} onClose={() => setScreenHelp(false)} title={t('还不能共享窗口或整个屏幕')} width={440}>
      <p className="mb-3 text-sm text-muted">{t('系统没有给浏览器屏幕录制权限。现在仍然可以共享浏览器标签页。')}</p>
      <ScreenPermissionHelp />
      <button className="meet-btn meet-btn-primary mt-6 w-full" onClick={() => setScreenHelp(false)}>{t('知道了')}</button>
    </Modal>
    <ShareSheet open={sharing} onClose={() => setSharing(false)} kind="meet" id={code} title={info.title} hostName={info.hostNickname || ''} />
  </>
}

/** 右边侧栏：聊天 / 成员 / 画面特效 */
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
  // 等候室：主持人 / 管理员看等待列表、会中开关
  const lobby = useLobbyHost(api, code, isMod, !!info.lobby, (e) => toast.error(errorText(e, t('操作失败'))))
  // 共享画面上的标注层：只叠在正在共享的那个人的屏幕上；大画面上能画的人打开标注后可以画，其余地方只看
  const annLayer = (p: PSnap, drawable: boolean) => p.id === ann.sharerId && p.screenTrack
    ? <AnnotationLayer strokes={ann.strokes} localId={ann.localId} drawing={drawable && ann.on && ann.canDraw} tool={ann.tool} color={ann.color} onLocal={ann.act} />
    : undefined
  const alone = parts.length <= 1
  const myStrokes = ann.strokes.some((s) => s.by === ann.localId && s.tool === 'pen')
  const [pop, setPop] = useState<'emoji' | 'more' | null>(null)
  const avatars = useAvatars(parts.map((p) => p.id))
  // 能量礼物（2026-09-30）：会议里只能送给主持人 + 台上开着视频或共享屏幕的人（服务器会再核对）。
  // 送出的礼物服务器确认后广播到会议的礼物频道 meet:<会议码>，所有人收到才播动画
  const myAddr = useSocial((s) => s.me?.address)
  const fx = useRef<GiftFxLayerHandle>(null)
  const [giftOpen, setGiftOpen] = useState(false)
  useRoomGifts(`meet:${code}`, (g) => fx.current?.play(g), true)
  const giftTargets: GiftTarget[] = [
    { address: info.host, nickname: info.hostNickname, avatar: info.hostAvatar, label: t('主持人') },
    // 台上的人都能收（goat 10-01：不管开没开麦克风 / 视频，只要在台上）；没开全员禁言时人人都在台上
    ...parts.filter((p) => p.id !== info.host && speakOk(props.mod.state, p.id)).map((p) => ({ address: p.id, nickname: p.name, avatar: avatars[p.id] ?? null, label: p.screen ? t('正在共享') : t('台上') })),
  ].filter((x) => x.address !== myAddr)
  // 舞台主画面（2026-10-02 goat：别人没开摄像头时，主持人这边大屏变成一张头像、自己有画面的反而挤在角上）：
  // 固定的 > 共享屏幕 > 正在说话的别人 > 刚说过话且开着摄像头的别人 > 开着摄像头的别人 > 别人都没开摄像头而自己开着 → 自己 > 第一个别人 > 自己
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
  // 画廊每页最多 16 格（2026-10-02 goat 问人多会不会卡）：再多就翻页。看不到的人不解码视频（adaptiveStream 自动暂停），
  // 电脑不用同时解几十路画面。排序：在共享屏幕的、开着摄像头的排前面，第一页就是最有内容的人
  const GALLERY_PAGE = 16
  const [gPage, setGPage] = useState(0)
  const ordered = useMemo(() => [...parts].sort((a, b) => Number(!!b.screen) - Number(!!a.screen) || Number(!!b.cam) - Number(!!a.cam)), [parts])
  const gPages = Math.max(1, Math.ceil(ordered.length / GALLERY_PAGE))
  const gCur = Math.min(gPage, gPages - 1)
  const gShown = ordered.slice(gCur * GALLERY_PAGE, gCur * GALLERY_PAGE + GALLERY_PAGE)
  const gridCols = gShown.length <= 1 ? 1 : gShown.length <= 4 ? 2 : gShown.length <= 9 ? 3 : 4

  return <div className="meet-ui flex h-full flex-col bg-[var(--mt-page)]" data-testid="in-call">
    {/* 顶部栏 */}
    <header className="relative flex h-16 shrink-0 items-center gap-4 px-6">
      {/* 画笔工具栏（2026-10-02 goat）：放在顶栏正中——左边会议名称、右边全员禁言之间那块空档，不占视频的地方 */}
      {layout === 'speaker' && main && <div className="pointer-events-none absolute inset-x-0 top-1/2 z-20 flex -translate-y-1/2 justify-center"><div className="pointer-events-auto">{ann.on && ann.canDraw && main.id === ann.sharerId && <AnnotateToolbar tool={ann.tool} color={ann.color} onTool={ann.setTool} onColor={ann.setColor} onUndo={() => ann.act({ t: 'ann', k: 'undo' })} onClear={() => ann.act({ t: 'ann', k: 'clear' })} onExit={() => ann.setOn(false)} canUndo={myStrokes} canClear={ann.strokes.length > 0} />}</div></div>}
      <div className="min-w-0">
        <div className="truncate text-[15px] font-semibold tracking-tight">{info.title}</div>
        <div className="font-mono text-[11px] text-muted">{code}</div>
      </div>
      <span className="meet-hairline ml-2 flex items-center gap-1.5 rounded-full bg-[var(--mt-2)] px-3 py-1 text-[12.5px] tabular-nums text-fg/90"><span className="h-1.5 w-1.5 rounded-full bg-[#ff6b76]" />{clock(elapsed)}</span>
      {lk.state === 'reconnecting' && <span className="flex items-center gap-2 text-[12.5px] text-[#ffc9a8]"><Spinner size={12} />{t('正在重新连接')}</span>}
      {mod.state?.muteAll && <span className="flex items-center gap-1.5 rounded-full bg-[#ff6b76]/15 px-3 py-1 text-[12px] font-medium text-[#ff9aa2]"><MicOff size={13} />{t('全员禁言中')}</span>}
      <div className="ml-auto flex items-center gap-2">
        {/* 举手申请：主持人 / 管理员看到醒目的待处理数，点开成员列表处理 */}
        {pending > 0 && <button className="meet-btn h-9 animate-pulse bg-[#ffc9a8] px-3 text-[13px] font-semibold text-[#1a1208]" onClick={() => setPanel('people')} data-testid="hands-pending"><Hand size={15} />{t('{n} 人申请发言', { n: pending })}</button>}
        {isMod && <button className={`meet-btn h-9 px-3 text-[13px] ${mod.state?.muteAll ? 'bg-[#ff6b76] font-semibold text-[#1b0a0c]' : 'meet-btn-ghost'}`} onClick={() => mod.muteAll(!mod.state?.muteAll)} data-testid="mute-all">{mod.state?.muteAll ? <><Mic size={15} />{t('解除全员禁言')}</> : <><MicOff size={15} />{t('全员禁言')}</>}</button>}
        <button className="meet-btn meet-btn-ghost h-9 px-3 text-[13px]" onClick={() => setPanel(panel === 'people' ? null : 'people')}><Users size={15} /><span className="tabular-nums">{parts.length}</span></button>
        {/* 2026-09-30 goat：舞台中间的「只有你在会议里」浮条挡住共享画面，删掉；这里改成主按钮，只有自己一人时加一圈提示光晕 */}
        <button className={`meet-btn meet-btn-primary h-9 px-3.5 text-[13px] ${alone ? 'meet-invite-glow' : ''}`} onClick={props.onCopy} data-testid="copy-invite" title={alone ? t('只有你在会议里。把链接发给要参加的人') : undefined}><Copy size={14} />{t('复制邀请链接')}</button>
      </div>
    </header>

    <div className="flex min-h-0 flex-1 gap-3 px-4">
      {/* 舞台 */}
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
            {/* 画廊：每格 16:9，宽度同时按「横着放得下」和「竖着放得下」取小的那个，一屏装下、不重叠（2026-10-02 截图里第 3 格压住第 1 格） */}
            {gShown.map((p) => <div key={p.id}><Tile p={p} hand={hands.has(p.id)} avatar={avatars[p.id]} overlay={annLayer(p, false)} /></div>)}
          </div>
          {gPages > 1 && <>
            <button type="button" className="meet-ctl absolute left-0 top-1/2 -translate-y-1/2 disabled:opacity-30" disabled={gCur === 0} onClick={() => setGPage(gCur - 1)} aria-label={t('上一页')}><ChevronLeft size={20} /></button>
            <button type="button" className="meet-ctl absolute right-0 top-1/2 -translate-y-1/2 disabled:opacity-30" disabled={gCur >= gPages - 1} onClick={() => setGPage(gCur + 1)} aria-label={t('下一页')}><ChevronRight size={20} /></button>
            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-xs text-white/80 num">{t('第 {a} / {b} 页', { a: gCur + 1, b: gPages })}</span>
          </>}
        </div>}
        {/* 表情飘屏 */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {floats.map((f) => <div key={f.id} className="meet-float-up absolute bottom-6 flex flex-col items-center" style={{ left: `${f.left}%` }}><span className="text-[40px] leading-none">{f.emoji}</span><span className="mt-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">{f.name}</span></div>)}
        </div>
        {lk.audioBlocked && <button className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black shadow-lg" onClick={() => void lk.startAudio()}><Volume2 size={16} />{t('点这里开启声音')}</button>}
      </section>

      {/* 侧栏 */}
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
    {/* 底部控制条。z-30：它往上弹出的菜单（更多、表情）要盖在舞台上面——画廊里共享屏幕时右下角的摄像头小窗是 z-10，
        以前菜单没层级，被小窗挡住（2026-10-02 goat） */}
    <footer className="relative z-30 flex h-[88px] shrink-0 items-center px-6">
      <div className="hidden w-1/4 min-w-0 items-center gap-2 text-[13px] text-muted lg:flex"><span className="truncate font-mono">{code}</span></div>
      <div className="meet-dock flex flex-1 items-center justify-center gap-2.5">
        <button className="meet-ctl meet-tip" data-off={!local?.mic} data-locked={!mod.canTalk || undefined} data-tip={!mod.canTalk ? t('全员禁言中，举手申请发言') : local?.mic ? t('关闭麦克风') : t('开启麦克风')} disabled={busy === 'mic'} onClick={() => props.onToggle('mic')} aria-label={t('麦克风')} data-testid="ctl-mic">{local?.mic ? <Mic size={20} /> : <MicOff size={20} />}</button>
        <button className="meet-ctl meet-tip" data-off={!local?.cam} data-locked={!mod.canTalk || undefined} data-tip={!mod.canTalk ? t('全员禁言中，举手申请发言') : local?.cam ? t('关闭摄像头') : t('开启摄像头')} disabled={busy === 'cam'} onClick={() => props.onToggle('cam')} aria-label={t('摄像头')} data-testid="ctl-cam">{local?.cam ? <Video size={20} /> : <VideoOff size={20} />}</button>
        {/* 画面特效：虚拟形象（不露脸）、美颜、换背景 */}
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
            {/* 复制邀请链接不放这里（2026-10-02 goat：和右上角的按钮重复了） */}
            {/* 主持人改密码 / 去掉密码（2026-09-30 goat）；已经在会议里的人不受影响 */}
            {props.isHost && <MenuItem icon={<Lock size={16} />} label={t('会议密码')} onClick={() => { setPwOpen(true); setPop(null) }} />}
            {/* 等候室开关（2026-10-01 goat）：主持人和管理员；关掉时正在等的人全部进来 */}
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

/** 会议管理：InCall 用到的状态和操作（都走服务器） */
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
    {/* 举手申请（主持人 / 管理员）：批准后对方可以开麦、开摄像头、共享屏幕 */}
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

/** 主持人改会议密码：设置新密码或去掉密码（4~32 位）。已经在会议里的人不受影响，之后进来的人按新设置 */
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
