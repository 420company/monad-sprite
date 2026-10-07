// 分享链接的观看页（2026-09-30 goat）：/watch/live/<直播间id>、/watch/meet/<会议码>。
// 已登录的人直接进直播间 / 会议；没登录的人看直播以游客身份（服务器签只看、隐身的令牌），
// 15 秒后弹登录框，画面在后面继续播，不登录弹框一直在、关不掉。
// ★会议不给游客看（2026-10-01 goat）：没登录只显示会议信息和登录按钮，不连音视频；开了等候室的写「需要主持人同意才能加入」。
// 付费直播要登录买票；有密码的会议显示「私人频道，您无法观看。」；已结束显示主播主页和关注。
import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import type { Room as LKRoom, RemoteTrack } from 'livekit-client'
import { LoaderCircle, LogIn, Ticket, Volume2, WifiOff } from 'lucide-react'
import Avatar from '@/components/Avatar'
import Button from '@/components/Button'
import { api } from '@/lib/social'
import { t } from '@/lib/i18n'
import { WEB_SURFACE } from '@/lib/surface'
import { needWallet } from '@/desktop/walletGate'
import { useSocial, displayName } from '@/store/social'
import { useWallet } from '@/store/wallet'
import type { RoomInfo } from './Live'
import { PkBar, PkResult } from '@/live/PkBar'
import type { PkState } from '@/live/pk'
import { GuestGate, ShareSheet } from '@/live/LiveSheets'
import { LevelBadge, LiveTag, LockMark, StreakBadge } from '@/live/Badges'

const AFTER_UNLOCK = '0x4.afterUnlock'
interface Tile { id: string; video?: RemoteTrack; audio?: RemoteTrack }
interface MeetPublic { id: string; ended: boolean; hasPassword: boolean; lobby?: boolean; title: string | null; host: string | null; hostNickname: string | null; hostAvatar: string | null }
type View =
  | { k: 'loading' } | { k: 'error'; text: string } | { k: 'paid'; room: RoomInfo } | { k: 'ended'; host: string | null; name: string | null; avatar: string | null; meeting: boolean }
  | { k: 'private' } | { k: 'meetLogin'; title: string; host: string | null; name: string | null; avatar: string | null; lobby: boolean } | { k: 'watch'; title: string; host: string | null; name: string | null; avatar: string | null; url: string; token: string; level?: number; streak?: number }

export default function Watch() {
  const { kind = '', id = '' } = useParams()
  const nav = useNavigate()
  const status = useSocial((s) => s.status)
  const loggedIn = status === 'ready'
  const [view, setView] = useState<View>({ k: 'loading' })
  const [tiles, setTiles] = useState<Tile[]>([])
  const [pk, setPk] = useState<PkState | null>(null)
  const [audioBlocked, setAudioBlocked] = useState(false)
  const [startedAt] = useState(() => Date.now())
  const [sharing, setSharing] = useState(false)
  const roomRef = useRef<LKRoom | null>(null)
  const skew = useRef(0)
  const isLive = kind === 'live', isMeet = kind === 'meet'

  // 已登录：直接去真正的直播间 / 会议（能聊天、点赞、送礼）
  const goReal = loggedIn

  useEffect(() => {
    if (goReal || (!isLive && !isMeet)) return
    let alive = true
    const connect = async (url: string, token: string) => {
      const sdk = await import('livekit-client').catch(() => null)
      if (!sdk || !alive) return
      const room = new sdk.Room({ adaptiveStream: true, dynacast: true })
      roomRef.current = room
      const refresh = () => {
        if (!alive) return
        const list: Tile[] = []
        room.remoteParticipants.forEach((p) => {
          const video = [...p.trackPublications.values()].find((x) => x.kind === 'video' && x.track && !x.isMuted)?.track as RemoteTrack | undefined
          const audio = [...p.trackPublications.values()].find((x) => x.kind === 'audio' && x.track)?.track as RemoteTrack | undefined
          if (video || audio) list.push({ id: p.identity, video, audio })
        })
        setTiles(list)
      }
      const E = sdk.RoomEvent
      room.on(E.TrackSubscribed, refresh).on(E.TrackUnsubscribed, refresh).on(E.ParticipantConnected, refresh).on(E.ParticipantDisconnected, refresh).on(E.TrackMuted, refresh).on(E.TrackUnmuted, refresh)
      room.on(E.AudioPlaybackStatusChanged, () => { if (alive) setAudioBlocked(!room.canPlaybackAudio) })
      room.on(E.Disconnected, () => { if (alive) setTiles([]) })
      try { await room.connect(url, token); if (!alive) { void room.disconnect(); return } setAudioBlocked(!room.canPlaybackAudio); refresh() }
      catch { if (alive) setView({ k: 'error', text: t('暂时无法连接音视频') }) }
    }
    const run = async () => {
      try {
        if (isLive) {
          const r = await api<RoomInfo>(`/api/rooms/${encodeURIComponent(id)}`)
          if (!alive) return
          if (r.status !== 'live') { setView({ k: 'ended', host: r.host, name: r.hostNickname, avatar: r.hostAvatar, meeting: false }); return }
          if (r.price > 0) { setView({ k: 'paid', room: r }); return }
          // 游客观看凭证本来就是给没登录的人的：标成匿名请求，不然网页版的「写请求先连钱包」拦截会先弹连接面板再报错（2026-10-04 走查：没登录的人打开直播分享链接显示「暂时无法打开」）
          const g = await api<{ url: string; token: string }>(`/api/rooms/${encodeURIComponent(id)}/guest`, { method: 'POST' }, { anonymous: true })
          if (!alive) return
          setView({ k: 'watch', title: r.title, host: r.host, name: r.hostNickname, avatar: r.hostAvatar, url: g.url, token: g.token, level: r.hostLevel, streak: r.streak })
          await connect(g.url, g.token)
        } else {
          const m = await api<MeetPublic>(`/api/meet/meetings/${encodeURIComponent(id)}/public`)
          if (!alive) return
          if (m.hasPassword) { setView({ k: 'private' }); return }
          if (m.ended) { setView({ k: 'ended', host: m.host, name: m.hostNickname, avatar: m.hostAvatar, meeting: true }); return }
          // 游客不能进会议：只给会议信息和登录入口
          setView({ k: 'meetLogin', title: m.title || '', host: m.host, name: m.hostNickname, avatar: m.hostAvatar, lobby: !!m.lobby })
        }
      } catch (e) {
        if (!alive) return
        const st = (e as { status?: number }).status
        setView(st === 404 ? { k: 'ended', host: null, name: null, avatar: null, meeting: isMeet } : { k: 'error', text: t('暂时无法打开') })
      }
    }
    void run()
    return () => { alive = false; void roomRef.current?.disconnect(); roomRef.current = null }
  }, [kind, id, goReal]) // eslint-disable-line react-hooks/exhaustive-deps

  // 游客没有实时连接：PK 状态每 3 秒拉一次
  useEffect(() => {
    if (!isLive || goReal || view.k !== 'watch') return
    let alive = true
    const load = () => api<{ pk: PkState | null }>(`/api/rooms/${encodeURIComponent(id)}/pk`).then((r) => { if (alive) { if (r.pk) skew.current = r.pk.serverNow - Date.now(); setPk(r.pk) } }).catch(() => {})
    void load()
    const x = setInterval(load, 3000)
    return () => { alive = false; clearInterval(x) }
  }, [isLive, id, goReal, view.k])

  if (!isLive && !isMeet) return <Navigate to="/" replace />
  if (goReal) return <Navigate to={isLive ? `/room/${id}` : `/meet/${id}`} replace />

  const login = () => {
    try { sessionStorage.setItem(AFTER_UNLOCK, `/watch/${kind}/${id}`) } catch { /* 隐私模式 */ }
    if (WEB_SURFACE) { needWallet(); return }
    nav(useWallet.getState().wallet || useWallet.getState().evmAccount ? '/unlock' : '/onboarding')
  }
  const hostTile = view.k === 'watch' && view.host ? tiles.find((x) => x.id === view.host) : undefined
  const oppTile = pk ? tiles.find((x) => x.id === pk.opp.identity) : undefined

  return <div className="safe-top relative flex h-full min-h-screen flex-col bg-black text-white" data-testid="watch-page">
    <header className="flex shrink-0 items-center gap-3 px-4 py-3">
      {view.k === 'watch' && <Avatar address={view.host || id} src={view.avatar} name={view.name} size={36} />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold">{view.k === 'watch' ? view.title : '0x4'}</div>
        {view.k === 'watch' && view.host && <div className="flex items-center gap-1 text-xs text-white/70"><span className="truncate">{displayName({ address: view.host, nickname: view.name })}</span><LevelBadge level={view.level} role="streamer" size={15} /><StreakBadge n={view.streak} size={13} /></div>}
      </div>
      {view.k === 'watch' && <LiveTag />}
      {view.k === 'watch' && <Button size="sm" variant="secondary" onClick={() => setSharing(true)}>{t('分享')}</Button>}
      <Button size="sm" onClick={login}><LogIn size={15} />{t('登录')}</Button>
    </header>

    <main className="relative flex min-h-0 flex-1 flex-col">
      {view.k === 'loading' && <Center><LoaderCircle size={28} className="animate-spin text-white/70" /></Center>}
      {view.k === 'error' && <Center><WifiOff size={28} className="text-white/70" /><p className="text-sm text-white/80">{view.text}</p></Center>}
      {view.k === 'private' && <Center><LockMark size={56} className="text-white" /><p className="text-lg font-semibold" data-testid="watch-private">{t('私人频道，您无法观看。')}</p></Center>}
      {view.k === 'meetLogin' && <Center>
        {view.host && <Avatar address={view.host} src={view.avatar} name={view.name} size={72} />}
        <p className="max-w-full break-words text-lg font-semibold" data-testid="watch-meet-login">{view.title}</p>
        {view.host && <p className="text-sm text-white/70">{t('主持人 {name}', { name: displayName({ address: view.host, nickname: view.name }) })}</p>}
        <p className="text-sm text-white/80">{view.lobby ? t('需要主持人同意才能加入') : t('登录后加入会议')}</p>
        <Button onClick={login}><LogIn size={16} />{t('登录后加入会议')}</Button>
      </Center>}
      {view.k === 'paid' && <Center>
        <Avatar address={view.room.host} src={view.room.hostAvatar} name={view.room.hostNickname} size={72} />
        <p className="max-w-full break-words text-lg font-semibold">{view.room.title}</p>
        <p className="text-sm text-white/70">{t('付费直播，登录后购票观看')}</p>
        <Button onClick={login}><Ticket size={16} />{t('登录购票')}</Button>
      </Center>}
      {view.k === 'ended' && <Center>
        {view.host && <Avatar address={view.host} src={view.avatar} name={view.name} size={72} />}
        <p className="text-lg font-semibold" data-testid="watch-ended">{view.meeting ? t('会议已结束') : t('直播已结束')}</p>
        {view.host && <div className="flex gap-2">
          <Button variant="secondary" onClick={() => nav(`/u/${view.host}`)}>{t('去主播主页')}</Button>
          <Button onClick={login}>{t('登录后关注')}</Button>
        </div>}
      </Center>}
      {view.k === 'watch' && <div className="relative min-h-0 flex-1 overflow-hidden">
        {isLive ? (pk ? <div className="absolute inset-0 grid grid-cols-2 gap-0.5">
          <div className="relative overflow-hidden">{hostTile ? <Stage tile={hostTile} /> : <Away address={view.host || ''} avatar={view.avatar} name={view.name} />}</div>
          <div className="relative overflow-hidden">{oppTile ? <Stage tile={oppTile} /> : <Away address={pk.opp.host} avatar={pk.opp.avatar} name={pk.opp.nickname} />}</div>
        </div> : hostTile ? <Stage tile={hostTile} /> : <Away address={view.host || ''} avatar={view.avatar} name={view.name} />)
          : <div className={`grid h-full gap-1 p-1 ${tiles.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>{tiles.length ? tiles.map((x) => <div key={x.id} className="relative overflow-hidden rounded-lg bg-white/5"><Stage tile={x} /></div>) : <Away address={view.host || id} avatar={view.avatar} name={view.name} />}</div>}
        {pk && <div className="absolute inset-x-0 top-0 z-10"><PkBar pk={pk} now={() => Date.now() + skew.current} /></div>}
        {pk && <PkResult pk={pk} />}
        {audioBlocked && <div className="absolute inset-x-0 bottom-6 z-20 flex justify-center"><Button variant="secondary" onClick={() => roomRef.current?.startAudio().then(() => setAudioBlocked(false)).catch(() => {})}><Volume2 size={16} />{t('播放声音')}</Button></div>}
      </div>}
      {view.k === 'watch' && <GuestGate loggedIn={loggedIn} onLogin={login} startedAt={startedAt} />}
    </main>
    {view.k === 'watch' && <ShareSheet open={sharing} onClose={() => setSharing(false)} kind={isLive ? 'live' : 'meet'} id={id} title={view.title} hostName={displayName({ address: view.host || '', nickname: view.name })} />}
  </div>
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">{children}</div>
}
function Away({ address, avatar, name }: { address: string; avatar: string | null; name: string | null }) {
  return <div className="flex h-full flex-col items-center justify-center gap-2"><Avatar address={address} src={avatar} name={name} size={72} /><p className="text-xs text-white/70">{t('正在连接画面')}</p></div>
}
function Stage({ tile }: { tile: Tile }) {
  const v = useRef<HTMLVideoElement>(null), a = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const vv = v.current, aa = a.current
    if (tile.video && vv) tile.video.attach(vv)
    if (tile.audio && aa) tile.audio.attach(aa)
    return () => { if (vv) tile.video?.detach(vv); if (aa) tile.audio?.detach(aa) }
  }, [tile.video, tile.audio])
  return <div className="absolute inset-0 flex items-center justify-center">
    {tile.video ? <video ref={v} autoPlay playsInline className="absolute inset-0 h-full w-full object-cover" /> : <Avatar address={tile.id.replace(/^pk:/, '')} size={72} />}
    {tile.audio && <audio ref={a} autoPlay />}
  </div>
}
