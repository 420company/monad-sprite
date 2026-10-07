// 直播间：LiveKit 音视频，付费房先买票，主播可结束。
// 2026-09-30 goat 直播改造（docs/LIVE_PK_PLAN.md）：随机视频取消、换成主播 PK（左右分屏、比分、倒计时、结束画面、连胜）；
// 等级徽章、点赞、进场特效；主播 / 房管踢人禁言；分享到 X；被踢出 / 被平台关闭时整页提示。
// 直播间里只能送礼，没有任何直接转账 / 红包入口。
import { Suspense, lazy, useEffect, useRef, useState, useMemo } from 'react'
import { WEB_SURFACE } from '@/lib/surface'
import { isNative } from '@/lib/native'
import { Precheck, type JoinPrefs } from '@/meet/ui'
import { BALANCE_FEATURES } from '@/lib/features'
import { useNavigate, useParams } from 'react-router-dom'
import type { Room as LKRoom, Track, RemoteTrack, Participant } from 'livekit-client'
import { ArrowLeft, Flag, Gift, LoaderCircle, Sparkles, Mic, MicOff, PhoneOff, RefreshCw, Send, Share2, Swords, Ticket, Video, VideoOff, Volume2, WifiOff } from 'lucide-react'
import GiftSheet from '@/components/GiftSheet'
import { applyFx, processorForCamera } from '@/effects/fx'
import { loadFx, type FxSettings } from '@/effects/settings'
import type { LocalVideoTrack } from 'livekit-client'
// 直播特效面板（网页版主播，2026-10-02）：按需加载
const EffectsPanel = lazy(() => import('@/effects/EffectsPanel'))
const CoverPicker = lazy(() => import('@/desktop/community/CoverPicker'))   // 开播检查页选直播封面（只有网页版有检查页）
import GiftPanel, { type GiftTarget } from '@/components/energy/GiftPanel'
import { GiftFxLayer, giftDisplayName, useRoomGifts, type GiftFxLayerHandle } from '@/components/energy/GiftFxLayer'
import { ENERGY_GIFTS, energyEarnings, energyFile } from '@/lib/energy'
const energyFileUrl = (u: string) => energyFile(u) || u
import Button from '@/components/Button'
import Avatar from '@/components/Avatar'
import FollowButton from '@/components/FollowButton'
import { openReport, useBlocks } from '@/lib/safety'
import { toast } from '@/components/Toast'
import { api } from '@/lib/social'
import { transfer } from '@/lib/transfer'
import { NATIVE_EVM, NATIVE_SOL, SOLANA_CHAIN_ID, chainName } from '@/lib/chains'
import { fmtAmount, shortId } from '@/lib/format'
import { useSocial, displayName, proveEvmIfNeeded } from '@/store/social'
import { useWallet } from '@/store/wallet'
import { useSettings } from '@/store/settings'
import type { RoomInfo } from './Live'
import XBadge from '@/components/XBadge'
import { GiftIcon } from '@/components/gifts'
import { renderServerText } from '@/lib/sysText'
import { t, useLang } from '@/lib/i18n'
import UserName from '@/components/UserName'
import { useBack } from '@/lib/useBack'
import { errorText } from '@/lib/errors'
import { usePk } from '@/live/pk'
import { PkBar, PkResult } from '@/live/PkBar'
import { PkHostBar, PkHostSheet, PkInviteDialog } from '@/live/PkHost'
import { usePkPublish } from '@/live/pkPublish'
import { LevelBadge, StreakBadge, LiveTag } from '@/live/Badges'
import LikeButton from '@/live/LikeButton'
import { EnterBanner, RoomGone, ShareSheet, ViewerSheet, type ModInfo } from '@/live/LiveSheets'
import { reportActivity } from '@/desktop/qrIdle'
import { watchSpeaking } from '@/desktop/speakActivity'

type Tile = { id: string; name: string; isLocal: boolean; mic: boolean; video?: RemoteTrack | Track; audio?: RemoteTrack }
type ChatLine = { id: string; from: string; nickname: string | null; avatar?: string | null; text: string; ts: number; gift?: boolean; giftId?: string; giftIcon?: string | null; lv?: number; mod?: boolean; system?: boolean }
type Gone = 'kicked' | 'dissolved' | 'blocked' | 'ended' | null

// 门票款已付、服务端还没登记上的交易：记下来，再点只重交这笔，不会再付一次
const pendingKey = (room: string) => `0x4.ticketTx.${room}`
const readPendingTx = (room: string) => { try { return localStorage.getItem(pendingKey(room)) } catch { return null } }
const writePendingTx = (room: string, tx: string | null) => { try { if (tx) localStorage.setItem(pendingKey(room), tx); else localStorage.removeItem(pendingKey(room)) } catch { /* 存不了只是少了防重复付款 */ } }

/** 电脑网页版主播开播前先检查设备（手机 App 直接开播，系统会弹权限） */
const HOST_PRECHECK = WEB_SURFACE && !isNative

export default function Room() {
  const { id = '' } = useParams()
  // 离开房间：退回上一页（一般是直播列表，列表的滚动位置会还原）；从推送 / 深链直接进来的去直播列表
  const back = useBack('/live')
  const { me, status, socket, wsStatus, login } = useSocial()
  const [gifting, setGifting] = useState(false)
  // 能量礼物（2026-09-30）：服务器确认扣好能量后广播 roomgift，收到才播动画 + 飘屏（手机 App 也播，只是没有送礼按钮和价格）
  const [energyOpen, setEnergyOpen] = useState(false)
  const [fxOpen, setFxOpen] = useState(false)
  // 开着猫头时主播自己的预览不镜像（2026-10-02 goat：镜像后猫脸上的 0、x 是反的）；真人模式照旧镜像
  const [fxCat, setFxCat] = useState(() => loadFx().avatar === 'cat')
  const fx = useRef<GiftFxLayerHandle>(null)
  const lang = useLang((s) => s.lang)
  const navigate = useNavigate()
  // 主播自己：今天收到几个礼物（App 里只显示个数，网页版另外显示今日收益）
  const [hostToday, setHostToday] = useState<{ gifts: number; today: string } | null>(null)
  // 弹幕：只保留最近 60 条，不落库；在线人数由服务端按地址去重后推送
  const [chat, setChat] = useState<ChatLine[]>([])
  // 我拉黑的人：弹幕在我这边不显示
  const blockedList = useBlocks((s) => s.list)
  const blockedSet = useMemo(() => new Set(blockedList.map((b) => b.address)), [blockedList])
  const [viewers, setViewers] = useState<number | null>(null)
  const [likes, setLikes] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const chatBox = useRef<HTMLDivElement>(null)
  const { wallet, evmAccount } = useWallet()
  const rpcUrl = useSettings((s) => s.rpcUrl)
  const [info, setInfo] = useState<RoomInfo | null>(null)
  const [needTicket, setNeedTicket] = useState(false)
  const [tiles, setTiles] = useState<Tile[]>([])
  const [mic, setMic] = useState(false)
  const [cam, setCam] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [buying, setBuying] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [retry, setRetry] = useState(0)
  const [mediaBusy, setMediaBusy] = useState<'mic' | 'cam' | null>(null)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [audioBlocked, setAudioBlocked] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [pendingTx, setPendingTx] = useState<string | null>(null)
  const [gone, setGone] = useState<Gone>(null)
  const [mod, setMod] = useState<ModInfo | null>(null)
  const [modGen, setModGen] = useState(0)
  const [sharing, setSharing] = useState(false)
  const [pkOpen, setPkOpen] = useState(false)
  const [target, setTarget] = useState<{ address: string; nickname: string | null; avatar?: string | null; level?: number } | null>(null)
  const [enter, setEnter] = useState<{ key: string; nickname: string; level: number; tier: number } | null>(null)
  const [lkRoom, setLkRoom] = useState<LKRoom | null>(null)
  // 扫码登录的公共电脑：主播 / 连麦的人自己在说话算「在用」
  useEffect(() => watchSpeaking(lkRoom), [lkRoom])
  const roomRef = useRef<LKRoom | null>(null)
  const generation = useRef(0)
  const isHost = !!info && info.host === me?.address
  const pk = usePk(id, isHost)
  const pkState = pk.pk
  const hostTile = info ? tiles.find((x) => x.id === info.host) : undefined
  const oppTile = pkState ? tiles.find((x) => x.id === pkState.opp.identity) : undefined
  const muted = !!mod?.muted
  const canPk = isHost && info?.kind === 'video' && !(info?.price > 0)

  const rebuild = (room: LKRoom) => {
    const list: Tile[] = []
    const push = (p: Participant, isLocal: boolean) => {
      const video = [...p.trackPublications.values()].find((t) => t.kind === 'video' && t.track && !t.isMuted)?.track
      const audio = [...p.trackPublications.values()].find((t) => t.kind === 'audio' && t.track)?.track as RemoteTrack | undefined
      list.push({ id: p.identity, name: p.name || shortId(p.identity), isLocal, mic: p.isMicrophoneEnabled, video: video ?? undefined, audio: isLocal ? undefined : audio })
    }
    push(room.localParticipant, true)
    room.remoteParticipants.forEach((p) => push(p, false))
    setTiles(list)
    setMic(room.localParticipant.isMicrophoneEnabled)
    setCam(room.localParticipant.isCameraEnabled)
  }

  // 开播前检查（只在电脑网页版的主播）：拿到进房令牌后先停在这里，确认设备再推流
  const [precheck, setPrecheck] = useState<{ url: string; token: string; kind: 'voice' | 'video' } | null>(null)
  const [going, setGoing] = useState(false)
  useEffect(() => { setPrecheck(null) }, [id])
  const goLiveWith = async (prefs: JoinPrefs) => {
    if (!precheck || going) return
    setGoing(true)
    try { await connect(precheck.url, precheck.token, precheck.kind, true, prefs) } finally { setGoing(false); setPrecheck(null) }
  }
  // publish=false：直播间观众只订阅主播的画面和声音，不开自己的麦克风和摄像头
  // prefs：开播前检查选的设备（不传 = 默认设备、麦克风和摄像头都开）
  const connect = async (url: string, token: string, kind: 'voice' | 'video', publish = true, prefs?: JoinPrefs) => {
    if (!url) { setErr(t('音视频服务暂不可用')); return }
    const attempt = generation.current
    // 音视频 SDK 仅在进房时加载，避免主包超过 PWA 的单文件缓存上限。
    const sdk = await import('livekit-client').catch(() => null)
    if (generation.current !== attempt) return
    if (!sdk) { setErr(t('音视频组件加载失败，请重试')); return }
    const { Room: RoomClient, RoomEvent } = sdk
    void roomRef.current?.disconnect()
    // 回声消除写死开着：礼物音效（如哈基米）在主播这端播放时，不会被麦克风再收进去传给观众变成双声
    const room = new RoomClient({ adaptiveStream: true, dynacast: true, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    roomRef.current = room
    const current = () => generation.current === attempt && roomRef.current === room
    const refresh = () => { if (current()) rebuild(room) }
    setErr(null); setReconnecting(false); setConnected(false); setMediaError(null)
    room.on(RoomEvent.TrackSubscribed, refresh).on(RoomEvent.TrackUnsubscribed, refresh).on(RoomEvent.ParticipantConnected, refresh).on(RoomEvent.ParticipantDisconnected, refresh).on(RoomEvent.LocalTrackPublished, refresh).on(RoomEvent.LocalTrackUnpublished, refresh).on(RoomEvent.TrackMuted, refresh).on(RoomEvent.TrackUnmuted, refresh)
    room.on(RoomEvent.Reconnecting, () => { if (current()) setReconnecting(true) })
    room.on(RoomEvent.Reconnected, () => { if (current()) { setReconnecting(false); setConnected(true); setErr(null); refresh() } })
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => { if (current()) setAudioBlocked(!room.canPlaybackAudio) })
    room.on(RoomEvent.Disconnected, () => { if (current()) { setConnected(false); setReconnecting(false); setErr(t('音视频连接已中断')); setTiles([]); setLkRoom(null) } })
    try {
      await room.connect(url, token)
      // 离开房间后的迟到连接不能重新打开设备或回写页面。
      if (!current()) { void room.disconnect(); return }
      setConnected(true)
      setLkRoom(room)
      if (!publish) { setAudioBlocked(!room.canPlaybackAudio); refresh(); return }
      if (prefs?.spkId) await room.switchActiveDevice('audiooutput', prefs.spkId).catch(() => {})
      if (prefs?.micOn !== false) await room.localParticipant.setMicrophoneEnabled(true, prefs?.micId ? { deviceId: prefs.micId } : undefined).catch(() => { if (current()) setMediaError(t('麦克风未开启')) })
      if (!current()) { void room.disconnect(); return }
      if (kind === 'video' && prefs?.camOn !== false) await room.localParticipant.setCameraEnabled(true, { ...(prefs?.camId ? { deviceId: prefs.camId } : {}), processor: await processorForCamera() }).catch(() => { if (current()) setMediaError(t('摄像头未开启')) })
      if (!current()) { void room.disconnect(); return }
      setAudioBlocked(!room.canPlaybackAudio)
      refresh()
    } catch { if (current()) { roomRef.current = null; setConnected(false); setReconnecting(false); setTiles([]); setLkRoom(null); setErr(t('暂时无法连接音视频')); void room.disconnect() } }
  }

  /** 离开音视频（被踢出 / 被关闭时） */
  const dropMedia = () => { generation.current++; const r = roomRef.current; roomRef.current = null; void r?.disconnect(); setConnected(false); setTiles([]); setLkRoom(null) }

  // 实时频道：弹幕、人数、礼物飘屏、点赞、进场特效、管理变化、被踢 / 被关闭
  // 付费房要有门票才能订阅（服务端也会拒），买到票后 needTicket 变回 false 会重新订阅
  useEffect(() => {
    if (!socket || wsStatus !== 'open' || needTicket || gone) return
    socket.send({ type: 'roomjoin', roomId: id })
    const off = socket.on((d) => {
      if (d.roomId !== id) return
      if (d.type === 'roommsg') setChat((c) => [...c.slice(-59), { id: String(d.id), from: String(d.from), nickname: (d.nickname as string | null) ?? null, avatar: (d.avatar as string | null) ?? null, text: String(d.text), ts: Number(d.ts), lv: Number(d.lv) || undefined, mod: d.mod === true }])
      if (d.type === 'roomcount') setViewers(Number(d.n))
      if (d.type === 'roomlikes') setLikes(Number(d.total))
      if (d.type === 'gift' && BALANCE_FEATURES) {   // 手机 App 不显示礼物飘屏
        const item = { id: Date.now() + Math.random() }
        setChat((c) => [...c.slice(-59), { id: 'g' + item.id, from: String(d.from || ''), nickname: null, text: renderServerText(String(d.text || ''), d.key, d.params, d.giftId), ts: Date.now(), gift: true, giftId: typeof d.giftId === 'string' ? d.giftId : undefined }])
      }
      if (d.type === 'roomenter') setEnter({ key: `${d.address}${Date.now()}`, nickname: String(d.nickname || ''), level: Number(d.level), tier: Number(d.tier) })
      if (d.type === 'roommod') {
        setModGen((n) => n + 1)
        const ev = d.event as { kind: string; target: string; on: boolean; nickname: string } | undefined
        if (ev?.kind === 'mute' && ev.target === me?.address) toast[ev.on ? 'error' : 'success'](ev.on ? t('你已被禁言') : t('你已被解除禁言'))
        if (ev?.kind === 'admin' && ev.target === me?.address) toast.success(ev.on ? t('你已被设为房管') : t('你已不是房管'))
      }
      if (d.type === 'roommsg_denied') toast.error(t(String(d.error || '你已被禁言')))
      if (d.type === 'roomkicked') { dropMedia(); setGone(d.reason === 'blocked' ? 'blocked' : 'kicked') }
      if (d.type === 'roomdissolved') { dropMedia(); setGone('dissolved'); if (typeof d.reason === 'string' && d.reason) toast.error(t('直播间已被平台关闭：{reason}', { reason: d.reason })) }
      if (d.type === 'roomjoin_denied') {
        const e = String(d.error || '')
        if (e.includes('移出')) { dropMedia(); setGone('kicked') } else if (e === '无法进入这个直播间') { dropMedia(); setGone('blocked') }
      }
    })
    return () => { off(); socket.send({ type: 'leave', groupId: `room:${id}` }) }
  }, [socket, wsStatus, id, needTicket, gone]) // eslint-disable-line react-hooks/exhaustive-deps
  useRoomGifts(gone ? null : id, (g) => {
    fx.current?.play(g)
    setChat((c) => [...c.slice(-59), { id: 'eg' + g.id, from: g.from, nickname: g.nickname, avatar: g.avatar, text: t('送出 {gift}', { gift: giftDisplayName(g.gift, lang) }), ts: g.ts, gift: true, giftIcon: g.gift.icon }])
    if (isHost && g.to === me?.address) setHostToday((h) => ({ gifts: (h?.gifts ?? 0) + 1, today: h?.today ?? '0' }))
  })
  // 主播：今天收到的礼物数（实时推送 energy_earnings 会顺带更新今日收益）
  useEffect(() => {
    if (!isHost || status !== 'ready') return
    let alive = true
    energyEarnings().then((e) => { if (alive && e.enabled) setHostToday({ gifts: e.todayGifts ?? 0, today: e.today }) }).catch(() => {})
    const off = socket?.on((d) => { if (d.type === 'energy_earnings') setHostToday((h) => ({ gifts: h?.gifts ?? 0, today: String(d.today) })) })
    return () => { alive = false; off?.() }
  }, [isHost, status, socket])
  // 换房间时清掉上一个房间的弹幕和人数
  useEffect(() => { setChat([]); setViewers(null); setLikes(null); setGone(null) }, [id])
  useEffect(() => { chatBox.current?.scrollTo({ top: chatBox.current.scrollHeight }) }, [chat.length])
  // 我在这个直播间的身份（房管名单、我是不是被禁言）
  useEffect(() => {
    if (status !== 'ready' || !connected) return
    let alive = true
    api<ModInfo>(`/api/rooms/${id}/mod`).then((m) => { if (alive) setMod(m) }).catch(() => {})
    return () => { alive = false }
  }, [id, status, connected, modGen])
  useEffect(() => { if (!enter) return; const x = setTimeout(() => setEnter(null), 3300); return () => clearTimeout(x) }, [enter])
  // PK：主播把自己的画面同时推进对面房间
  usePkPublish(isHost ? pk.link : null, isHost ? lkRoom : null, { mic, cam })
  useEffect(() => { if (pk.error && !pkOpen) toast.error(t(pk.error.text)) }, [pk.error]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (status !== 'ready') return
    let alive = true
    generation.current++
    setErr(null); setInfo(null); setNeedTicket(false); setConnected(false); setReconnecting(false); setTiles([]); setMic(false); setCam(false); setAudioBlocked(false); setMediaError(null); setLkRoom(null)
    const run = async () => {
      try {
        const r = await api<RoomInfo & { token: string; url: string }>(`/api/rooms/${id}/join`, { method: 'POST' })
        if (!alive) return
        setInfo(r)
        const host = r.host === useSocial.getState().me?.address
        // 电脑网页版的主播：先过开播前检查（选摄像头 / 麦克风 / 扬声器、看画面和音量），确认后才推流（2026-10-01，原 meet.420.meme 的流程）
        if (host && HOST_PRECHECK) { setPrecheck({ url: r.url, token: r.token, kind: r.kind }); return }
        await connect(r.url, r.token, r.kind, host)
      } catch (e) {
        const msg = errorText(e, '')
        if (!alive) return
        if (msg.includes('门票')) {
          try { const details = await api<RoomInfo>(`/api/rooms/${id}`); if (alive) { setNeedTicket(true); setInfo(details) } }
          catch { if (alive) setErr(t('暂时无法获取门票信息')) }
        } else if (msg === '你已被移出这场直播') setGone('kicked')
        else if (msg === '无法进入这个直播间') setGone('blocked')
        else if (msg === '房间已结束') setGone('ended')
        else setErr(msg || t('暂时无法进入房间'))
      }
    }
    run()
    const hb = setInterval(() => {
      api<{ ok: boolean; kicked?: boolean; ended?: boolean; reason?: string | null }>(`/api/rooms/${id}/heartbeat`, { method: 'POST' }).then((r) => {
        if (!alive || r.ok) return
        if (r.kicked) { dropMedia(); setGone('kicked') }
        else if (r.ended) { dropMedia(); setGone(r.reason === 'dissolve' ? 'dissolved' : 'ended') }
      }).catch(() => {})
    }, 20_000)
    return () => { alive = false; generation.current++; clearInterval(hb); const room = roomRef.current; roomRef.current = null; void room?.disconnect() }
  }, [id, status, retry]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setPendingTx(needTicket ? readPendingTx(id) : null) }, [needTicket, id])

  const sendChat = () => {
    const text = draft.trim(); if (!text || !socket || muted) return
    socket.send({ type: 'msg', groupId: `room:${id}`, text }); setDraft('')
    reportActivity('chat')
  }

  const buyTicket = async () => {
    if (buying || !info || !info.priceChainId || !info.priceToken) return
    setBuying(true)
    const room = id
    try {
      // EVM 门票：服务器只认签名证明过的付款地址，先证明再转钱（已付过、待提交的也要先证明才能提交）
      if (info.priceChainId !== SOLANA_CHAIN_ID && !(await proveEvmIfNeeded({ interactive: true }).catch(() => false))) throw new Error(t('EVM 地址验证失败，请稍后再试'))
      let tx = readPendingTx(room)
      if (!tx) {
        const to = info.priceChainId === SOLANA_CHAIN_ID ? info.host : info.hostEvm
        if (!to) throw new Error(t('房主没有对应链的收款地址'))
        const token = info.priceToken === 'native' ? (info.priceChainId === SOLANA_CHAIN_ID ? NATIVE_SOL : NATIVE_EVM) : info.priceToken
        tx = await transfer({ chainId: info.priceChainId, token, decimals: info.priceDecimals || 0, amount: info.price, to }, { solana: wallet, evm: evmAccount, solanaRpc: rpcUrl })
        writePendingTx(room, tx); setPendingTx(tx)
      }
      // 服务端要到链上核对，交易还没确认时回 409：每 3 秒重试，最多约 30 秒
      for (let i = 0; ; i++) {
        try { await api(`/api/rooms/${room}/tickets`, { method: 'POST', body: JSON.stringify({ tx }) }); break }
        catch (e) {
          if ((e as { status?: number }).status !== 409 || i >= 9) throw e
          await new Promise((r) => setTimeout(r, 3000))
        }
      }
      writePendingTx(room, null); setPendingTx(null)
      toast.success(t('门票已购买'))
      setNeedTicket(false)
      setRetry(n => n + 1)
    } catch (e) {
      // 服务端明确判定这笔不合格（金额不够、收款人不对等）：作废，下次重新付款
      if ((e as { status?: number }).status === 400) { writePendingTx(room, null); setPendingTx(null) }
      toast.error(errorText(e, t('购票失败')))
    } finally { setBuying(false) }
  }

  // 直播中改特效：挂到摄像头轨道上。虚拟形象开不起来时先把摄像头关掉——绝不退回露脸的画面
  const changeFx = async (s: FxSettings) => {
    setFxCat(s.avatar === 'cat')
    const room = roomRef.current
    const track = room?.localParticipant.getTrackPublication('camera' as Track.Source)?.videoTrack as LocalVideoTrack | undefined
    try { await applyFx(track, s) } catch {
      if (s.avatar === 'cat' && room) { await room.localParticipant.setCameraEnabled(false).catch(() => {}); if (roomRef.current === room) rebuild(room); toast.error(t('虚拟形象没能打开，已先关掉摄像头')) }
      else toast.error(t('特效没能打开'))
    }
  }

  const toggleMedia = async (kind: 'mic' | 'cam') => {
    const room = roomRef.current
    if (!room || !connected || reconnecting || mediaBusy) return
    setMediaBusy(kind)
    try {
      if (kind === 'mic') await room.localParticipant.setMicrophoneEnabled(!mic)
      else await room.localParticipant.setCameraEnabled(!cam, !cam ? { processor: await processorForCamera() } : undefined)
      if (roomRef.current === room) { rebuild(room); setMediaError(null) }
    } catch { toast.error(kind === 'mic' ? t('无法开启麦克风，请检查设备权限') : t('无法开启摄像头，请检查设备权限')) }
    finally { setMediaBusy(null) }
  }
  const leave = async (endRoom = false) => {
    if (buying || leaving) return
    // 返回列表始终可以离开本机通话；结束房间仍需主播确认和服务端成功。
    if (endRoom && info && info.host === me?.address) {
      if (!confirm(pkState?.phase === 'running' ? t('正在 PK，现在下播这一局算你输。结束直播？') : t('结束直播？'))) return
      setLeaving(true)
      try { await api(`/api/rooms/${id}/end`, { method: 'POST' }) }
      catch { setLeaving(false); toast.error(t('结束直播失败，请重试')); return }
    }
    generation.current++
    void roomRef.current?.disconnect()
    back()
  }
  const openUser = (line: ChatLine) => { if (line.from && line.from !== me?.address && !line.gift) setTarget({ address: line.from, nickname: line.nickname, avatar: line.avatar, level: line.lv }) }
  const hostName = info ? displayName({ address: info.host, nickname: info.hostNickname }) : ''
  // 送礼对象：本房间主播；PK 时加上对面主播（服务器会核对对面主播此刻在不在 PK 里）
  const giftTargets: GiftTarget[] = info ? [
    { address: info.host, nickname: info.hostNickname, avatar: info.hostAvatar, label: pkState ? t('本房主播') : undefined },
    ...(pkState && pkState.phase === 'running' ? [{ address: pkState.opp.host, nickname: pkState.opp.nickname, avatar: pkState.opp.avatar, label: t('对面主播') }] : []),
  ].filter((x) => x.address !== me?.address) : []

  if (precheck && info) {
    return <div className="meet-ui relative flex h-full flex-col overflow-y-auto" data-testid="live-precheck">
      <header className="relative z-10 flex items-center px-6 py-5 lg:px-10">
        <button onClick={() => void leave()} className="icon-button -ml-2" aria-label={t('返回')}><ArrowLeft size={21} /></button>
      </header>
      <div className="relative z-10 flex flex-1 items-center pb-12">
        <Precheck
          heading={<><p className="text-[13px] font-medium text-muted">{t('开播前检查')}</p><h1 className="mt-2 font-display text-[32px] font-semibold leading-tight">{info.title}</h1></>}
          sub={<span>{t('观众会看到你的摄像头画面，听到你的麦克风。')}</span>}
          joinLabel={t('开始直播')}
          joining={going}
          camDefault={precheck.kind === 'video'}
          screenCheck={false}
          tone="live"
          aside={<Suspense fallback={null}><CoverPicker roomId={id} initial={info.cover} /></Suspense>}
          onJoin={(p) => void goLiveWith(p)}
        />
      </div>
    </div>
  }

  return (
    <div className="safe-top relative flex h-full min-h-0 flex-col bg-bg text-fg">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-3">
        <button onClick={() => void leave()} disabled={buying || leaving} className="icon-button" aria-label={t('返回直播')} data-tooltip={t('返回直播')}><ArrowLeft size={20} /></button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">{info?.title || t('直播房间')}</h1>
          <div className={`mt-1 text-xs ${reconnecting ? 'text-warning' : 'text-muted'}`} role="status">{status !== 'ready' ? status === 'logging' ? t('正在连接身份') : t('社交服务未连接') : needTicket ? t('付费房间') : reconnecting ? t('音视频正在重连') : connected ? t('{n} 人在看', { n: viewers ?? tiles.length }) : err ? t('连接不可用') : t('正在连接房间')}</div>
        </div>
        {connected && !reconnecting && <LiveTag className="mr-1" />}
        {info && !gone && <button onClick={() => setSharing(true)} className="icon-button" aria-label={t('分享')} data-tooltip={t('分享')} data-testid="room-share"><Share2 size={19} /></button>}
        {/* 举报这场直播（观众；2026-10-02 上架要求） */}
        {info && !gone && me && info.host !== me.address && <button onClick={() => openReport({ kind: 'room', id: info.id, target: info.host, name: info.title })} className="icon-button" aria-label={t('举报')} data-tooltip={t('举报')}><Flag size={18} /></button>}
      </header>

      {gone ? <RoomGone kind={gone} onBack={back} /> : status !== 'ready' ? <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-8 text-center">
        {status === 'logging' ? <LoaderCircle size={28} className="mb-4 animate-spin text-muted" /> : <WifiOff size={28} className="mb-4 text-muted" />}
        <h2 className="text-lg font-semibold">{status === 'logging' ? t('正在连接') : t('社交服务未连接')}</h2>
        {status !== 'logging' && <Button variant="secondary" className="mt-5" onClick={login}><RefreshCw size={16} />{t('重新连接')}</Button>}
      </div> : needTicket && info ? (
        <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-y-auto px-6 py-8 text-center">
          <Avatar address={info.host} src={info.hostAvatar} name={info.hostNickname} size={72} />
          <h2 className="w-full break-words text-xl font-semibold">{info.title}</h2>
          <div className="flex w-full items-center justify-center gap-1 break-words text-sm text-muted"><XBadge address={info.host} size={12} /><UserName address={info.host} name={hostName} /></div>
          <div className="w-full border-y border-line py-5"><p className="text-xs text-muted">{t('单次门票')}</p><div className="number mt-2 break-words text-2xl font-semibold">{fmtAmount(info.price)} {info.priceSymbol}</div><p className="mt-2 text-xs text-muted">{chainName(info.priceChainId || 0)}</p></div>
          <Button size="lg" className="w-full shrink-0" loading={buying} onClick={buyTicket}><Ticket size={18} />{t('支付并进入')}</Button>
          <p className="text-xs text-muted">{pendingTx ? t('已付款，正在等链上确认') : t('门票直接支付到房主钱包')}</p>
        </div>
      ) : !connected ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-8 text-center" role="status">
          {err ? <WifiOff size={28} className="mb-4 text-muted" /> : <LoaderCircle size={28} className="mb-4 animate-spin text-muted" />}
          <h2 className="text-lg font-semibold">{err ? t('暂时无法进入房间') : t('正在连接房间')}</h2>
          {err && <><p className="mt-2 max-w-full break-words text-sm text-muted">{err}</p><Button className="mt-5" variant="secondary" onClick={() => setRetry(n => n + 1)}><RefreshCw size={16} />{t('重试连接')}</Button></>}
        </div>
      ) : (
        <div className={`relative flex min-h-0 flex-1 ${WEB_SURFACE ? '' : 'flex-col'}`}>
          {/* 直播画面：平时主播是唯一主画面；PK 时左右各一半，左边本房间主播、右边对面主播 */}
          <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-black">
            {pkState ? <div className="absolute inset-0 grid grid-cols-2 gap-0.5" data-testid="pk-split">
              <div className="relative overflow-hidden">{hostTile ? <VideoTile tile={hostTile} stage unmirror={fxCat} /> : <AwayTile address={info!.host} avatar={info!.hostAvatar} name={info!.hostNickname} />}</div>
              <div className="relative overflow-hidden">{oppTile ? <VideoTile tile={oppTile} stage /> : <AwayTile address={pkState.opp.host} avatar={pkState.opp.avatar} name={pkState.opp.nickname} connecting />}</div>
            </div> : hostTile ? <VideoTile tile={hostTile} stage unmirror={fxCat} /> : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                {info && <Avatar address={info.host} src={info.hostAvatar} name={info.hostNickname} size={84} />}
                <p className="text-sm text-white/70">{t('主播暂时离开，稍后回来')}</p>
              </div>
            )}
            {pkState && <div className="absolute inset-x-0 top-0 z-10"><PkBar pk={pkState} now={pk.serverNow} /></div>}
            {pkState && <PkResult pk={pkState} />}
            {info && !pkState && (
              <div className="absolute left-3 top-3 flex max-w-[75%] items-center gap-2 rounded-full bg-black/45 py-1 pl-1 pr-2 text-white backdrop-blur">
                <Avatar address={info.host} src={info.hostAvatar} name={info.hostNickname} size={30} />
                <UserName address={info.host} name={hostName} className="min-w-0 truncate text-sm font-semibold" />
                <LevelBadge level={info.hostLevel} role="streamer" size={18} />
                <StreakBadge n={info.streak} size={15} />
                {hostTile && !hostTile.mic && <MicOff size={13} className="shrink-0 text-white/70" aria-label={t('麦克风已关闭')} />}
                {!isHost && <FollowButton address={info.host} size="xs" />}
              </div>
            )}
            {isHost && <PkInviteDialog pk={pk} />}
            <GiftFxLayer ref={fx} />
            {/* 主播：今天收到的礼物（App 只显示个数；网页版加今日收益，点开收益页） */}
            {isHost && hostToday && (ENERGY_GIFTS
              ? <button type="button" onClick={() => navigate('/energy')} className="absolute right-3 top-3 z-20 rounded-full bg-black/50 px-3 py-1 text-xs text-white backdrop-blur" data-testid="host-today">{t('今日收益 {n} USDT', { n: Number(hostToday.today).toLocaleString(undefined, { maximumFractionDigits: 2 }) })}</button>
              : hostToday.gifts > 0 && <span className="absolute right-3 top-3 z-20 rounded-full bg-black/50 px-3 py-1 text-xs text-white backdrop-blur" data-testid="host-today">{t('今天收到 {n} 个礼物', { n: hostToday.gifts })}</span>)}
            <EnterBanner item={enter} />
            {/* 弹幕层只覆盖视频区，不会压到下面的输入框和按钮 */}
            {chat.length > 0 && (
              <div ref={chatBox} className="absolute inset-x-3 bottom-3 max-h-[42%] overflow-y-auto no-scrollbar space-y-1 [mask-image:linear-gradient(to_bottom,transparent,black_18%)]" aria-live="polite" aria-label={t('弹幕')}>
                {chat.filter((m) => !blockedSet.has(m.from)).map((m) => <button key={m.id} type="button" onClick={() => openUser(m)} className={`block w-fit max-w-[85%] break-words rounded-lg px-2.5 py-1.5 text-left text-xs leading-relaxed ${m.gift ? 'bg-accent/25 text-accent' : 'bg-bg/80 text-fg'}`}>
                  {m.gift && (m.giftIcon ? <img src={energyFileUrl(m.giftIcon)} alt="" className="mr-1 inline-block h-[22px] w-[22px] object-contain align-middle" /> : <GiftIcon id={m.giftId} size={22} className="mr-1 inline-block align-middle" />)}
                  {m.gift && m.giftIcon && <span className="mr-1 text-accent">{displayName({ address: m.from, nickname: m.nickname })}</span>}
                  {!m.gift && <><LevelBadge level={m.lv} size={16} className="mr-1" />{m.mod && <span className="mr-1 rounded bg-accent/20 px-1 text-[10px] text-accent">{t('房管')}</span>}{m.from === info?.host && <span className="mr-1 rounded bg-[#ff2d55]/20 px-1 text-[10px] text-[#ff2d55]">{t('主播')}</span>}<span className="mr-1.5 text-accent">{displayName({ address: m.from, nickname: m.nickname })}</span></>}
                  {m.text}
                </button>)}
              </div>
            )}
          </div>
          {/* 网页版送礼侧栏（2026-10-02 goat：弹窗挡住了视频）：贴在视频右边，视频让出位置但整个画面都看得到 */}
          {WEB_SURFACE && ENERGY_GIFTS && info && energyOpen && <GiftPanel open docked onClose={() => setEnergyOpen(false)} room={`live:${id}`} targets={giftTargets} />}
          {/* 直播特效：电脑贴在视频右边；手机在视频下方（视频让出下面一截，边调边看自己的画面） */}
          {isHost && fxOpen && <Suspense fallback={null}><EffectsPanel layout={WEB_SURFACE ? 'dock' : 'strip'} onClose={() => setFxOpen(false)} onChange={(s) => void changeFx(s)} /></Suspense>}
        </div>
      )}

      {connected && !gone && !(fxOpen && isHost && !WEB_SURFACE) && <footer className="shrink-0 border-t border-line px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {reconnecting && <p className="pb-2 text-center text-xs text-warning" role="status">{t('音视频连接中断，正在自动重连')}</p>}
        {mediaError && <p className="pb-2 text-center text-xs text-warning" role="status">{mediaError}</p>}
        {isHost && <div className="mb-3"><PkHostBar pk={pk} /></div>}
        <form className="mb-3 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); sendChat() }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={200} disabled={muted} placeholder={muted ? t('你已被禁言') : t('发个弹幕…')} aria-label={t('弹幕内容')} className="ui-field min-h-11 flex-1 text-base disabled:opacity-60" />
          <button type="submit" disabled={!draft.trim() || muted} className="icon-button bg-accent text-bg disabled:opacity-40" aria-label={t('发送弹幕')}><Send size={18} /></button>
        </form>
        {audioBlocked && <Button variant="secondary" size="sm" className="mb-3 w-full" onClick={() => roomRef.current?.startAudio().then(() => setAudioBlocked(false)).catch(() => toast.error(t('声音播放失败，请重试')))}><Volume2 size={16} />{t('播放房间声音')}</Button>}
        <div className="flex items-center justify-center gap-3">
          <LikeButton roomId={id} total={likes} disabled={reconnecting} />
          {ENERGY_GIFTS && info && info.host !== me?.address && <button onClick={() => setEnergyOpen((v) => WEB_SURFACE ? !v : true)} aria-pressed={WEB_SURFACE ? energyOpen : undefined} disabled={reconnecting} className="icon-button h-12 w-12 bg-card2 text-accent" aria-label={t('送礼物')} title={t('送礼物')} data-testid="room-gift"><Gift size={21} /></button>}
          {BALANCE_FEATURES && !ENERGY_GIFTS && info && info.host !== me?.address && <button onClick={() => setGifting(true)} disabled={reconnecting} className="icon-button h-12 w-12 bg-card2 text-accent" aria-label={t('送礼物')} title={t('送礼物')}><Gift size={21} /></button>}
          {canPk && <button onClick={() => setPkOpen(true)} disabled={reconnecting || pkState?.phase === 'running'} className="icon-button h-12 w-12 bg-card2 text-[#ff7a45] disabled:opacity-40" aria-label={t('主播 PK')} title={t('主播 PK')} data-testid="pk-open"><Swords size={21} /></button>}
          {isHost && <button onClick={() => void toggleMedia('mic')} disabled={reconnecting || !!mediaBusy} className={`icon-button h-12 w-12 ${mic ? 'bg-card2 text-fg' : 'bg-down/15 text-down'}`} aria-pressed={mic} aria-label={mic ? t('关闭麦克风') : t('开启麦克风')} title={mic ? t('关闭麦克风') : t('开启麦克风')}>{mediaBusy === 'mic' ? <LoaderCircle size={21} className="animate-spin" /> : mic ? <Mic size={21} /> : <MicOff size={21} />}</button>}
          {isHost && info?.kind !== 'voice' && <button onClick={() => void toggleMedia('cam')} disabled={reconnecting || !!mediaBusy} className={`icon-button h-12 w-12 ${cam ? 'bg-card2 text-fg' : 'bg-down/15 text-down'}`} aria-pressed={cam} aria-label={cam ? t('关闭摄像头') : t('开启摄像头')} title={cam ? t('关闭摄像头') : t('开启摄像头')}>{mediaBusy === 'cam' ? <LoaderCircle size={21} className="animate-spin" /> : cam ? <Video size={21} /> : <VideoOff size={21} />}</button>}
          {/* 直播特效（主播，2026-10-02）：换背景、美颜、虚拟形象 */}
          {isHost && info?.kind !== 'voice' && <button onClick={() => setFxOpen((v) => !v)} aria-pressed={fxOpen} disabled={reconnecting} className={`icon-button h-12 w-12 ${fxOpen ? 'bg-accent/20 text-accent' : 'bg-card2 text-fg'}`} aria-label={t('直播特效')} title={t('直播特效')} data-testid="fx-toggle"><Sparkles size={20} /></button>}
          <button onClick={() => void leave(isHost)} disabled={leaving} className="icon-button h-12 w-12 bg-down text-bg" aria-label={isHost ? t('结束直播') : t('离开房间')} title={isHost ? t('结束直播') : t('离开房间')}>{leaving ? <LoaderCircle size={21} className="animate-spin" /> : <PhoneOff size={21} />}</button>
        </div>
      </footer>}
      {!WEB_SURFACE && ENERGY_GIFTS && info && energyOpen && <GiftPanel open onClose={() => setEnergyOpen(false)} room={`live:${id}`} targets={giftTargets} />}
      {gifting && info && <GiftSheet open onClose={() => setGifting(false)} roomId={id} recipients={[{ address: info.host, nickname: info.hostNickname, avatar: info.hostAvatar }]} initial={{ address: info.host, nickname: info.hostNickname, avatar: info.hostAvatar }} />}
      {info && <ShareSheet open={sharing} onClose={() => setSharing(false)} kind="live" id={id} title={info.title} hostName={hostName} />}
      {canPk && <PkHostSheet open={pkOpen} onClose={() => setPkOpen(false)} pk={pk} />}
      <ViewerSheet open={!!target} onClose={() => setTarget(null)} roomId={id} user={target} mod={mod} onChanged={() => setModGen((n) => n + 1)} />
    </div>
  )
}

/** PK 时某一边还没有画面（对面刚连上 / 主播暂时离开） */
function AwayTile({ address, avatar, name, connecting }: { address: string; avatar: string | null; name: string | null; connecting?: boolean }) {
  return <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
    <Avatar address={address} src={avatar} name={name} size={64} />
    <p className="text-xs text-white/70">{connecting ? t('正在连接对方画面') : t('主播暂时离开，稍后回来')}</p>
  </div>
}

function VideoTile({ tile, stage = false, unmirror = false }: { tile: Tile; stage?: boolean; unmirror?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const v = videoRef.current, a = audioRef.current
    if (tile.video && v) tile.video.attach(v)
    if (tile.audio && a) tile.audio.attach(a)
    return () => { if (v) tile.video?.detach(v); if (a) tile.audio?.detach(a) }
  }, [tile.video, tile.audio])
  if (stage) return (
    <div className="absolute inset-0 flex items-center justify-center">
      {tile.video ? <video ref={videoRef} autoPlay playsInline muted={tile.isLocal} className={`absolute inset-0 h-full w-full object-cover ${tile.isLocal && !unmirror ? '-scale-x-100' : ''}`} /> : <Avatar address={tile.id.replace(/^pk:/, '')} name={tile.name} size={96} />}
      {tile.audio && <audio ref={audioRef} autoPlay />}
    </div>
  )
  return null
}
