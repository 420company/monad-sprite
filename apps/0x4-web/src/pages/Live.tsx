// 直播以真实房间为主。2026-09-30 goat：随机视频取消，换成主播 PK（开播后在直播间里匹配 / 邀请），列表标出 PK 中和连胜。
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ChevronRight, Copy, Keyboard, LoaderCircle, Mic, Plus, Radio, RefreshCw, Swords, Ticket, Trophy, Users, Video, WifiOff } from 'lucide-react'
import Button from '@/components/Button'
import Sheet from '@/components/Sheet'
import Avatar from '@/components/Avatar'
import TokenPicker, { type PickedToken } from '@/components/TokenPicker'
import { Input, Label } from '@/components/Field'
import { toast } from '@/components/Toast'
import { api } from '@/lib/social'
import { fmtAmount, timeAgo } from '@/lib/format'
import { isNative } from '@/lib/chains'
import { useSocial, displayName } from '@/store/social'
import { locale, t } from '@/lib/i18n'
import UserName from '@/components/UserName'
import { errorText } from '@/lib/errors'
import { copyText } from '@/lib/native'
import { WEB_SURFACE } from '@/lib/surface'
import { MEET_CODE, meetLink, type Meeting } from '@/meet/links'
import { accessBody, accessOk, DEFAULT_ACCESS, LockBadge, MeetAccessFields, useActiveMeetings, type MeetAccess } from '@/meet/access'
import { needAccount } from '@/desktop/walletGate'
import { SocialLogin } from '@/desktop/ui'
import { LevelBadge, StreakBadge } from '@/live/Badges'
import RankSheet from '@/live/RankSheet'
import CommunityTabs from '@/components/CommunityTabs'
import { useCommunityUnread } from '@/store/announcements'

export interface RoomInfo { id: string; host: string; hostNickname: string | null; hostAvatar: string | null; hostEvm: string | null; title: string; kind: 'voice' | 'video'; price: number; priceSymbol: string | null; priceChainId: number | null; priceToken: string | null; priceDecimals: number | null; status: string; createdAt: number; viewers: number
  /** 2026-09-30 直播改造：主播等级、这次开播的连胜、正在 PK 的对手 */
  hostLevel?: number; streak?: number; pk?: { id: string; phase: string; oppHost: string; oppNickname: string } | null; endReason?: string | null
  /** 直播卡片封面（主播选的；null = 自动） */
  cover?: string | null }

export default function Live() {
  const nav = useNavigate()
  const { status, login } = useSocial()
  // 网页版没连钱包（2026-09-29 goat）：房间列表是公开接口，照样能看；开播 / 匹配 / 进房间 / 会议点了就弹「连接 0x4 Wallet」
  // 网页版：房间列表是公开接口，社区登没登录上都照样拉（2026-10-07 goat 截图：TokenPocket 里第一次用、还没同意条款，
  // 整页写「暂时无法连接直播」，其实只是社区没登录）。没登录的原因在列表上面一行说（SocialLogin），点开播 / 进房间时再去同意条款或登录
  const listOk = status === 'ready' || WEB_SURFACE
  const [data, setData] = useState<{ livekit: boolean; rooms: RoomInfo[]; updated: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [creating, setCreating] = useState(false)
  const [ranking, setRanking] = useState(false)

  useEffect(() => {
    if (!listOk) { setData(null); return }
    let alive = true
    let poll: ReturnType<typeof setTimeout>
    let timeout: ReturnType<typeof setTimeout>
    let controller: AbortController
    const load = async () => {
      controller = new AbortController()
      setLoading(true)
      timeout = setTimeout(() => controller.abort(), 15_000)
      try {
        const result = await api<{ livekit: boolean; rooms: RoomInfo[] }>('/api/rooms', { signal: controller.signal })
        if (!Array.isArray(result.rooms) || typeof result.livekit !== 'boolean') throw new Error(t('加载失败'))
        if (alive) { setData({ ...result, updated: Date.now() }); setFailed(false) }
      } catch { if (alive) setFailed(true) }
      finally {
        clearTimeout(timeout)
        if (alive) { setLoading(false); poll = setTimeout(load, 10_000) }
      }
    }
    void load()
    return () => { alive = false; clearTimeout(poll); clearTimeout(timeout); controller?.abort() }
  }, [status, retry, listOk])


  const available = status === 'ready' && data?.livekit === true
  const communityUnread = useCommunityUnread()
  return <div className="safe-top">
    <header className="page-header page-gutter">
      <div><h1 className="page-title">{WEB_SURFACE ? t('流媒体') : t('直播')}</h1><p className="mt-1 text-xs text-muted">{!listOk ? status === 'logging' ? t('正在连接') : t('未连接') : failed ? t('房间列表暂未更新') : data ? t('{n} 个房间正在直播', { n: data.rooms.length }) : t('正在获取房间')}</p></div>
      {/* 扫码登录电脑端只留首页一个入口（2026-09-28 goat），直播页不再放「电脑端登录」 */}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={WEB_SURFACE ? !!data && !data.livekit : !available || failed} onClick={() => { if (!needAccount()) setCreating(true) }}><Radio size={17} />{t('开播')}</Button>
      </div>
    </header>
    {/* 网页版（手机浏览器窄屏）：流媒体算社区的一个标签，顶上放和社区页一样的一排（CommunityTabs.tsx） */}
    {WEB_SURFACE && <CommunityTabs active="live" unread={communityUnread} />}
    {WEB_SURFACE && <div className="page-gutter"><SocialLogin bar /></div>}

    <section className="page-gutter" aria-label={t('正在直播')}>
      <div className="section-header border-b border-line"><h2 className="section-title">{t('正在直播')}</h2><button onClick={() => setRetry(n => n + 1)} disabled={loading || !listOk} className="icon-button" aria-label={t('刷新房间')} data-tooltip={t('刷新房间')}><RefreshCw size={18} /></button></div>
      {!listOk ? <div className="empty-state" role="status">
        {status === 'logging' ? <LoaderCircle size={24} className="animate-spin" /> : <WifiOff size={24} strokeWidth={1.5} />}
        <h3 className="text-base font-semibold">{status === 'logging' ? t('正在连接直播服务') : t('暂时无法连接直播')}</h3>
        <p className="mt-2 text-sm text-muted">{t('暂时无法获取房间列表')}</p>
        {status !== 'logging' && <Button size="sm" variant="secondary" className="mt-5" onClick={login}><RefreshCw size={16} />{t('重新连接')}</Button>}
      </div> : <>
        {failed && <div className={data?.rooms.length ? 'status-notice' : 'empty-state'} role="status">
          <WifiOff size={20} className="shrink-0" />
          <div className="min-w-0 flex-1"><p className="text-sm">{data?.rooms.length ? t('房间列表更新失败') : t('暂时无法加载直播房间')}</p>{data?.rooms.length ? <p className="mt-1 text-xs text-muted">{t('显示 {time} 的房间状态', { time: new Date(data.updated).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) })}</p> : null}</div>
          <Button size="sm" variant="secondary" className={data?.rooms.length ? '' : 'mt-4'} loading={loading} onClick={() => setRetry(n => n + 1)}><RefreshCw size={15} />{t('重试')}</Button>
        </div>}
        {loading && !data && !failed && <div className="space-y-4 py-5" role="status" aria-label={t('正在加载房间')}><div className="skeleton h-28" /><div className="skeleton h-28" /></div>}
        {data && !data.livekit && <div className="status-notice" role="status"><WifiOff size={18} className="shrink-0" /><span>{t('音视频服务暂不可用')}</span></div>}
        {data && !failed && data.livekit && !data.rooms.length && <div className="empty-state" role="status"><Radio size={28} strokeWidth={1.5} /><h3 className="text-base font-semibold">{t('暂无正在直播的房间')}</h3><Button size="sm" variant="secondary" className="mt-5" onClick={() => { if (!needAccount()) setCreating(true) }}><Radio size={16} />{t('创建房间')}</Button></div>}
        <div className="divide-y divide-line/60">{data?.rooms.map(room => <button key={room.id} disabled={!data.livekit} onClick={() => { if (!needAccount()) nav(`/room/${room.id}`) }} className="group flex w-full items-start gap-3 py-5 text-left active:bg-card disabled:opacity-50">
          <Avatar address={room.host} src={room.hostAvatar} name={room.hostNickname} size={48} />
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted"><span className={`flex items-center gap-1.5 ${failed ? 'text-warning' : 'text-up'}`}>{room.kind === 'voice' ? <Mic size={13} /> : <Video size={13} />}{room.kind === 'voice' ? t('语音') : t('视频')}{failed ? ` · ${t('待更新')}` : ` · ${t('直播中')}`}</span><span className="number flex items-center gap-1"><Users size={13} />{room.viewers}</span>{room.pk && <span className="flex items-center gap-1 font-semibold text-[#ff7a45]"><Swords size={13} />{t('PK 中')}</span>}<StreakBadge n={room.streak} size={14} /></div>
            <h3 className="break-words text-base font-semibold leading-snug">{room.title}</h3>
            <p className="mt-1 flex min-w-0 items-center gap-1 text-[13px] text-muted"><UserName address={room.host} name={displayName({ address: room.host, nickname: room.hostNickname })} className="truncate" /><LevelBadge level={room.hostLevel} role="streamer" size={16} /></p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><span>{t('{time}开播', { time: timeAgo(room.createdAt) })}</span><span className="number flex items-center gap-1.5 text-fg">{room.price > 0 ? <><Ticket size={13} />{fmtAmount(room.price)} {room.priceSymbol}</> : t('免费')}<ChevronRight size={14} /></span></div>
          </div>
        </button>)}</div>
      </>}
    </section>

    {/* 主播 PK（2026-09-30 goat：取代随机视频）：开播后在直播间里随机匹配或邀请正在直播的主播 */}
    <section className="page-gutter mt-6 border-t border-line pt-4" aria-label={t('主播 PK')}>
      <div className="flex items-center gap-3">
        <Swords size={21} className="shrink-0 text-[#ff7a45]" />
        <div className="min-w-0 flex-1"><h2 className="text-[15px] font-medium">{t('主播 PK')}</h2><p className="mt-1 text-xs text-muted">{t('开播后在直播间里随机匹配，或者邀请正在直播的主播。一局 4 分 20 秒，收礼多的赢。')}</p></div>
        <Button size="sm" variant="secondary" onClick={() => setRanking(true)} data-testid="live-rank"><Trophy size={16} />{t('排行')}</Button>
      </div>
    </section>
    {/* 会议（原 meet.420.meme，2026-09-29 goat：直播、会议放在一起） */}
    <MeetingsSection ready={status === 'ready'} guest={WEB_SURFACE} />
    <CreateRoomSheet open={creating} onClose={() => setCreating(false)} />
    <RankSheet open={ranking} onClose={() => setRanking(false)} />
  </div>
}

/** 会议：新建、输入会议码加入、我最近的会议。进会后是整屏会议室（pages/MeetingRoom） */
function MeetingsSection({ ready, guest }: { ready: boolean; guest: boolean }) {
  const nav = useNavigate()
  const me = useSocial((s) => s.me)
  const [code, setCode] = useState('')
  const [list, setList] = useState<Meeting[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [access, setAccess] = useState<MeetAccess>(DEFAULT_ACCESS)
  const [busy, setBusy] = useState(false)
  const active = useActiveMeetings()
  useEffect(() => {
    if (!ready) return
    let alive = true
    api<Meeting[]>('/api/meet/meetings/mine').then((l) => { if (alive) { setList(l); setFailed(false) } }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [ready])
  const parsed = MEET_CODE.exec(code.trim())?.[1]?.toLowerCase()
  const myName = me ? displayName(me) : ''
  const create = async () => {
    if (busy || !accessOk(access)) return
    setBusy(true)
    try {
      const m = await api<Meeting>('/api/meet/meetings', { method: 'POST', body: JSON.stringify({ title: title.trim() || t('{name} 的会议', { name: myName }), ...accessBody(access) }) })
      setCreating(false); setTitle(''); setAccess(DEFAULT_ACCESS)
      nav(`/meet/${m.id}`)
    } catch (e) { toast.error(errorText(e, t('创建失败'))) } finally { setBusy(false) }
  }
  return <section className="page-gutter mt-6 border-t border-line pt-4" aria-label={t('会议')}>
    <div className="flex items-center gap-3">
      <Video size={21} className="shrink-0 text-muted" />
      <div className="min-w-0 flex-1"><h2 className="text-[15px] font-medium">{t('会议')}</h2><p className="mt-1 text-xs text-muted">{t('发起会议，或者输入会议码加入。')}</p></div>
      <Button size="sm" disabled={!ready && !guest} onClick={() => { if (!needAccount()) setCreating(true) }}><Plus size={16} />{t('新建会议')}</Button>
    </div>
    <form className="mt-4 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (parsed && !needAccount()) nav(`/meet/${parsed}`) }}>
      <div className="relative min-w-0 flex-1">
        <Keyboard size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <Input className="!pl-10" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('输入会议码或链接')} spellCheck={false} aria-label={t('会议码')} />
      </div>
      <Button type="submit" size="sm" disabled={!parsed || (!ready && !guest)}>{t('加入')}</Button>
    </form>
    {/* 正在进行的会议（2026-09-30 goat）：公开的会议，有密码的带锁，点进去在进会前输密码 */}
    {!!active.list?.length && <div className="mt-4">
      <h3 className="text-xs text-muted">{t('正在进行的会议')}</h3>
      <div className="mt-2 divide-y divide-line/60">{active.list.slice(0, 10).map((m) => <button key={m.id} className="flex w-full items-center gap-3 py-3 text-left" onClick={() => { if (!needAccount()) nav(`/meet/${m.id}`) }} data-testid="active-meeting">
        <Avatar address={m.host} src={m.hostAvatar} name={m.hostNickname} size={40} />
        <div className="min-w-0 flex-1"><div className="truncate text-[15px] font-medium">{m.title}</div><div className="mt-0.5 flex items-center gap-2 text-xs text-muted"><span className="truncate">{displayName({ address: m.host, nickname: m.hostNickname })}</span><span>·</span><span className="flex items-center gap-1"><Users size={12} />{m.participants}</span></div></div>
        {m.hasPassword && <LockBadge />}
        <ChevronRight size={16} className="text-muted" />
      </button>)}</div>
    </div>}
    {ready && <div className="mt-4">
      <h3 className="text-xs text-muted">{t('最近的会议')}</h3>
      {failed ? <p className="py-4 text-sm text-muted">{t('暂时无法加载会议记录')}</p>
        : !list ? <div className="skeleton mt-3 h-14" />
        : !list.length ? <p className="py-4 text-sm text-muted">{t('新建一个会议，把链接发给要参加的人。')}</p>
        : <div className="mt-2 divide-y divide-line/60">{list.slice(0, 8).map((m) => <div key={m.id} className="flex items-center gap-3 py-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card2 text-muted"><Video size={18} /></span>
          <div className="min-w-0 flex-1"><div className="truncate text-[15px] font-medium">{m.title}</div><div className="mt-0.5 flex items-center gap-2 text-xs text-muted"><span className="font-mono">{m.id}</span><span>·</span><span>{m.endedAt ? t('已结束') : timeAgo(m.lastAt || m.createdAt)}</span></div></div>
          <button className="icon-button" onClick={() => copyText(meetLink(m.id)).then(() => toast.success(t('邀请链接已复制')), () => toast.error(t('复制失败')))} aria-label={t('复制邀请链接')}><Copy size={16} /></button>
          {!m.endedAt && <Button size="sm" onClick={() => nav(`/meet/${m.id}`)}>{t('加入')}<ArrowRight size={14} /></Button>}
        </div>)}</div>}
    </div>}
    <Sheet open={creating} onClose={() => setCreating(false)} title={t('新建会议')} dismissible={!busy}>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void create() }}>
        <div><Label htmlFor="mt-title">{t('会议名称')}</Label><Input id="mt-title" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('{name} 的会议', { name: myName })} /></div>
        <MeetAccessFields value={access} onChange={setAccess} inputWrap={(input) => <div className="[&>input]:h-12 [&>input]:w-full [&>input]:rounded-xl [&>input]:border [&>input]:border-line [&>input]:bg-card2 [&>input]:px-4 [&>input]:text-[15px] [&>input]:outline-none">{input}</div>} />
        <p className="text-xs text-muted">{t('创建后会生成会议码和邀请链接，有链接的 0x4 用户都能加入。')}</p>
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!accessOk(access)}><Video size={18} />{t('创建并进入')}</Button>
      </form>
    </Sheet>
  </section>
}

// 2026-10-02 goat：去掉「视频房 / 语音房」选择——不想露脸就在直播里关掉摄像头，就是语音直播。一律按视频房创建；以前建的语音房照常能进。
export function CreateRoomSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate()
  const [title, setTitle] = useState('')
  const [paid, setPaid] = useState(false)
  const [asset, setAsset] = useState<PickedToken | null>(null)
  const [price, setPrice] = useState('')
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const validPrice = Number.isFinite(Number(price)) && Number(price) > 0
  const submit = async () => {
    if (busy || !title.trim() || (paid && (!asset || !validPrice))) return
    setBusy(true)
    try {
      const r = await api<RoomInfo & { token: string; url: string }>('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), kind: 'video', price: paid ? Number(price) : 0, priceSymbol: asset?.symbol, priceChainId: asset?.chainId, priceToken: asset ? (isNative(asset.address) ? 'native' : asset.address) : undefined, priceDecimals: asset?.decimals }),
      })
      onClose()
      nav(`/room/${r.id}`, { state: { token: r.token, url: r.url } })
    } catch (e) { toast.error(errorText(e, t('开播失败'))) } finally { setBusy(false) }
  }
  return <Sheet open={open} onClose={onClose} title={t('创建直播房间')} dismissible={!busy}>
    <div className="space-y-5">
      <div><Label htmlFor="room-title">{t('房间标题')}</Label><Input id="room-title" disabled={busy} value={title} onChange={e => setTitle(e.target.value)} placeholder={t('今天聊什么')} maxLength={60} /></div>
      <label className="flex items-center justify-between gap-4 border-b border-line py-3"><span className="text-sm"><span className="font-medium">{t('收取门票')}</span><span className="mt-1 block text-xs text-muted">{t('门票直接支付到你的钱包')}</span></span><input type="checkbox" disabled={busy} checked={paid} onChange={e => setPaid(e.target.checked)} className="h-5 w-5 shrink-0 accent-accent" /></label>
      {paid && <div className="grid grid-cols-2 gap-3"><div><Label>{t('门票币种')}</Label><button disabled={busy} onClick={() => setPicking(true)} aria-label={t('选择门票币种')} className="flex min-h-12 w-full items-center justify-between gap-2 rounded-lg border border-line px-3 py-3 text-left text-sm"><span className="truncate">{asset ? asset.symbol : t('选择资产')}</span><ChevronRight size={16} className="shrink-0 text-muted" /></button></div><div><Label htmlFor="room-price">{t('门票价格')}</Label><Input id="room-price" disabled={busy} type="number" min="0" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" /></div></div>}
      <Button size="lg" className="w-full" disabled={!title.trim() || (paid && (!asset || !validPrice))} loading={busy} onClick={submit}><Radio size={18} />{t('开始直播')}</Button>
    </div>
    <TokenPicker open={picking} onClose={() => setPicking(false)} title={t('门票币种')} onSelect={setAsset} />
  </Sheet>
}
