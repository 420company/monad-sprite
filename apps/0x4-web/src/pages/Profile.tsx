// 交易者主页：资料、关注、战绩；下面三个标签「动态 · 交易 · 持仓」（2026-09-25 重排）：
// 标签栏吸顶，只加载当前标签，切换时再加载；记住上次选的标签（0x4.profileTab）
import { useEffect, useMemo, useState } from 'react'
import { BALANCE_FEATURES } from '@/lib/features'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowLeftRight, CalendarDays, Copy, Gift, MessageSquareLock, Share2, Wallet } from 'lucide-react'
import UserMore from '@/components/UserMore'
import { GiftIcon, giftName } from '@/components/gifts'
import Avatar from '@/components/Avatar'
import Button from '@/components/Button'
import GiftSheet from '@/components/GiftSheet'
import FollowButton from '@/components/FollowButton'
import TokenLogo from '@/components/TokenLogo'
import { PostList } from '@/components/Posts'
import { pnlClass, pnlText } from '@/components/Leaderboard'
import { toast } from '@/components/Toast'
// 主页分享链接（2026-10-04 走查：以前是 网页版地址/#/u/…，在 420.meme 上会落到官网首页）
import { SHARE_BASE } from '@/live/share'
import { api, type Profile as ProfileT } from '@/lib/social'
import { fmtAmount, fmtUsd, sideLabel, timeAgo, shortId } from '@/lib/format'
import { useSocial, displayName } from '@/store/social'
import { copyText } from '@/lib/native'
import XBadge from '@/components/XBadge'
import { LevelBadge } from '@/live/Badges'
import StaffTag from '@/components/StaffTag'
import { locale, t } from '@/lib/i18n'
import { oneOf, usePageState } from '@/lib/pageState'
import { EmptyState, LoadMore, MoreText } from '@/components/ListState'
import { usePaged } from '@/lib/usePaged'
import { PROFILE_TABS, loadProfileTab, saveProfileTab, type ProfileTab } from '@/lib/profileTab'
import UserName from '@/components/UserName'
import { useBack } from '@/lib/useBack'
import { errorText } from '@/lib/errors'

interface Social { handle: string | null; followers: number; following: number; isFollowing: boolean; trades: number; pnl: number; avgHoldMs: number | null; joinedAt: number | null; pnl24h: number ; followsMe?: boolean; isFriend?: boolean
  /** 2026-09-30：获赞（帖子 + 评论 + 直播，全站通用）、观众 / 主播等级 */
  likes?: number; level?: { viewer: number; streamer: number } }
interface Pnl { series: { t: number; v: number }[]; realized: number; unrealized: number; total: number }
interface Position { chain: string; token: string; symbol: string; logo: string | null; qty: number; cost: number; realized: number; last_price: number; last_at: number; trades: number }
interface Trade { id: string; side: 'buy' | 'sell'; chain: string; token: string; symbol: string; logo: string | null; qty: number; usd: number; price: number; realized: number; created_at: number }
const periods = [['24h', '24h'], ['7d', '7天'], ['30d', '30天'], ['all', '全部']] as const
const TAB_LABEL: Record<ProfileTab, string> = { posts: '动态', trades: '交易', holdings: '持仓' }
const SIDES = [['all', '全部'], ['buy', '买入'], ['sell', '卖出'], ['closed', '已平仓']] as const
type Side = (typeof SIDES)[number][0]
const TRADE_PAGE = 20

function holdText(ms: number | null) {
  if (!ms) return '--'
  const m = Math.round(ms / 60000)
  if (m < 60) return t('{m}分钟', { m })
  const h = Math.floor(m / 60)
  return h < 48 ? t('{h}小时{m}分钟', { h, m: m % 60 }) : t('{d}天', { d: Math.floor(h / 24) })
}

export default function Profile() {
  const { address = '' } = useParams()
  const nav = useNavigate()
  // 返回：有上一页退回上一页（上一页的状态 / 滚动都会还原），推送 / 深链直接打开的去 /community
  const back = useBack('/community')
  const { me, status } = useSocial()
  // 从群成员、列表点进来时带着已有的资料（router state），先直接显示，不用等接口（2026-09-26 goat：先闪一个错的资料再跳成对的）
  const seedRaw = (useLocation().state as { profile?: ProfileT } | null)?.profile
  const seed = seedRaw && seedRaw.address === address ? seedRaw : null
  const [p, setP] = useState<ProfileT | null>(seed)
  // 小精灵的地址：这里没有它的资料，直接去小精灵页（2026-10-05 goat：从动态点进来看到的是一串地址）
  useEffect(() => { if (p?.sprite) nav(`/fly/${p.sprite.id}`, { replace: true }) }, [p?.sprite?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [social, setSocial] = useState<Social | null>(null)
  const [gifts, setGifts] = useState<{ totalReceived: number; byGift: { gift_id: string; qty: number }[] } | null>(null)
  const [gifting, setGifting] = useState(false)
  const [tab, setTab] = useState<ProfileTab>(loadProfileTab)
  const pickTab = (k: ProfileTab) => { setTab(k); saveProfileTab(k) }

  useEffect(() => {
    // 换了一个人：先清掉上一个人的数据（有带过来的资料就先用它），迟到的旧请求结果丢掉
    let alive = true
    setP((cur) => (cur && cur.address === address ? cur : seed)); setSocial(null); setGifts(null)
    api<ProfileT>(`/api/users/${address}`).then((v) => { if (alive) setP(v) }).catch((e) => { if (alive) toast.error(errorText(e, t('加载失败'))) })
    api<Social>(`/api/users/${address}/social`).then((v) => { if (alive) setSocial(v) }).catch(() => {})
    api<typeof gifts>(`/api/gifts/received/${address}`).then((v) => { if (alive) setGifts(v) }).catch(() => {})
    return () => { alive = false }
  }, [address, status]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="safe-top px-4 pt-4">
      <div className="flex items-center justify-between">
        <button onClick={back} className="-ml-2 rounded-full p-2 text-muted"><ArrowLeft size={22} /></button>
        <div className="flex items-center gap-2">
          <button onClick={() => copyText(`${SHARE_BASE}/u/${address}`).then(() => toast.success(t('主页链接已复制')))} className="rounded-full bg-card p-2 text-muted"><Share2 size={18} /></button>
          {/* 举报 / 拉黑（别人的主页、登录后才有） */}
          <UserMore address={address} name={p ? displayName(p) : undefined} className="rounded-full bg-card p-2 text-muted" size={18} />
        </div>
      </div>
      {/* 头部（2026-09-25 重排）：昵称 + X 标记 / @账号胶囊 / 地址 / 加入时间，各占一行留足间距；关注按钮靠右和昵称对齐 */}
      {/* 资料还没到：显示骨架，不拿地址拼一个假的名字和默认头像出来 */}
      {!p ? (
        <div className="mt-3 flex items-start gap-4" aria-busy="true" aria-label={t('正在读取中')}>
          <div className="size-[76px] shrink-0 animate-pulse rounded-full bg-card2" />
          <div className="min-w-0 flex-1 space-y-2.5 pt-2">
            <div className="h-5 w-36 animate-pulse rounded-md bg-card2" />
            <div className="h-3.5 w-24 animate-pulse rounded-md bg-card2" />
            <div className="h-3.5 w-40 animate-pulse rounded-md bg-card2" />
          </div>
        </div>
      ) : (
      <div className="mt-3 flex items-start gap-4">
        <Avatar address={address} src={p?.avatar} name={p?.nickname} size={76} chainId={p?.avatarNft?.chainId} />
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-center gap-2"><UserName size="lg" address={address} name={p ? displayName(p) : shortId(address)} className="truncate text-[22px] font-bold leading-tight" /><XBadge address={address} size={14} /><LevelBadge level={social?.level?.streamer} role="streamer" size={22} /><LevelBadge level={social?.level?.viewer} size={22} /></div>
          {/* 名字旁只放 X 认证；「官方 / 客服」身份标签放到下一行最前面，和 X 账号胶囊分开，两种认证不挤在一起（2026-09-25 goat）。
              这一行没有任何内容时 empty:hidden 自动收起 */}
          {(
            <div className="mt-2 flex flex-wrap items-center gap-2 empty:hidden">
              <StaffTag address={address} />
              {/* 自己设的用户名和绑定的 X 账号分开显示：以前绑了 X 就只显示 X，设的用户名看不到，像是没保存 */}
              {(p?.handle || social?.handle) && <span className="text-sm font-semibold text-muted">@{p?.handle || social?.handle}</span>}
              {p?.xHandle && <a href={`https://x.com/${p.xHandle}`} target="_blank" rel="noreferrer" className="glass-lite inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-fg">𝕏 @{p.xHandle}</a>}
            </div>
          )}
          {/* 地址和加入时间放一排（2026-09-25 goat） */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <button onClick={() => copyText(p?.evmAddress || address).then(() => toast.success(t('已复制')))} className="flex items-center gap-1.5 font-mono">{shortId(p?.evmAddress || address)} <Copy size={12} /></button>
            {social?.joinedAt && <span className="flex items-center gap-1.5"><CalendarDays size={13} />{t('{date} 加入', { date: new Date(social.joinedAt).toLocaleDateString(locale(), { year: 'numeric', month: 'long' }) })}</span>}
          </div>
        </div>
        {/* 关系标签放在按钮左边同一排（2026-09-25 goat）：互关=好友+私聊；我单方面关注=按钮显示「已关注」；对方关注我=「关注了你」+回关 */}
        {me?.address !== address && (
          <div className="flex shrink-0 items-center gap-2">
            {social?.isFriend
              ? <span className="rounded-full bg-social/20 px-2.5 py-0.5 text-xs text-fg">{t('好友')}</span>
              : social?.followsMe && <span className="glass-lite rounded-full px-2.5 py-0.5 text-xs text-muted">{t('关注了你')}</span>}
            {social?.isFriend ? (
              <button onClick={() => nav(`/dm/${address}`)} className="flex items-center gap-1 rounded-full bg-accent px-3.5 py-2 text-sm font-semibold text-bg"><MessageSquareLock size={14} /> {t('私聊')}</button>
            ) : <FollowButton address={address} initial={social?.isFollowing} label={social?.followsMe ? t('回关成为好友') : t('关注')} onChange={(f, n) => { setSocial((s) => (s ? { ...s, isFollowing: f, followers: n } : s)); api<Social>(`/api/users/${address}/social`).then(setSocial).catch(() => {}) }} />}
          </div>
        )}
      </div>
      )}
      {p?.bio && <div className="mt-4"><MoreText text={p.bio} className="text-[15px] leading-relaxed" /></div>}

      {/* 数据卡：一排四格，数字在上、说明在下，不用表情符号 */}
      <div className="glass-lite mt-4 grid grid-cols-5 rounded-[20px] py-3.5">
        {[
          [String(social?.following ?? 0), t('关注||count')],
          [String(social?.followers ?? 0), t('粉丝')],
          [String(social?.likes ?? 0), t('获赞')],
          [String(social?.trades ?? 0), t('交易')],
          [holdText(social?.avgHoldMs ?? null), t('平均持仓')],
        ].map(([v, l], i) => (
          <div key={i} className={`flex min-w-0 flex-col items-center gap-0.5 px-1 ${i ? 'border-l border-line' : ''}`}>
            <span className="number max-w-full truncate text-[17px] font-bold">{v}</span>
            <span className="text-[11px] text-muted">{l}</span>
          </div>
        ))}
      </div>

      {BALANCE_FEATURES && gifts && gifts.totalReceived > 0 && (
        <div className="mt-3 rounded-2xl bg-card p-3"><div className="text-xs text-muted">{t('收到的礼物 · 共 {amount}', { amount: fmtUsd(gifts.totalReceived) })}</div><div className="mt-1 flex flex-wrap gap-2">{gifts.byGift.map((g) => <span key={g.gift_id} className="flex items-center gap-1 rounded-full bg-card2 py-1 pl-1.5 pr-2.5 text-sm"><GiftIcon id={g.gift_id} size={22} title={t(giftName(g.gift_id))} />× {g.qty}</span>)}</div></div>
      )}
      {BALANCE_FEATURES && me && me.address !== address && p && <Button className="mt-3 w-full" variant="secondary" onClick={() => setGifting(true)}><Gift size={16} /> {t('送礼物')}</Button>}

      {/* 三个标签：吸顶（贴在状态栏毛玻璃下面），只渲染当前这个，切换时它自己再去拉数据 */}
      {/* 圆角胶囊分段切换（2026-09-25 goat：原来通栏直角的框不好看），吸顶时浮在内容上 */}
      <div className="sticky z-20 mt-6 py-2" style={{ top: 'env(safe-area-inset-top)' }}>
        <div className="glass grid grid-cols-3 gap-1 rounded-full p-1" role="tablist" aria-label={t('主页内容')}>
          {PROFILE_TABS.map((k) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => pickTab(k)}
            className={`h-9 rounded-full text-sm font-semibold transition-colors ${tab === k ? 'bg-accent text-bg shadow-sm' : 'text-muted'}`}>{t(TAB_LABEL[k])}</button>)}
        </div>
      </div>
      <div className="pb-4" role="tabpanel">
        {tab === 'posts' && <PostList filter={{ author: address }} />}
        {tab === 'trades' && <TradesTab address={address} />}
        {tab === 'holdings' && <HoldingsTab address={address} />}
      </div>
      {p && gifting && <GiftSheet open onClose={() => setGifting(false)} recipients={[p]} initial={p} />}
    </div>
  )
}

/** 交易标签：盈亏卡在最上面，下面交易记录分页（每页 20，滚到底加载更多），可筛选 全部 / 买入 / 卖出 / 已平仓 */
function TradesTab({ address }: { address: string }) {
  const { status } = useSocial()
  // 盈亏周期、交易筛选、持仓子标签记在会话里：点进币详情再返回还是原样（lib/pageState）
  const [period, setPeriod] = usePageState<(typeof periods)[number][0]>('profile.period', '24h', oneOf(...periods.map((p) => p[0])))
  const [pnl, setPnl] = useState<Pnl | null>(null)
  const [side, setSide] = usePageState<Side>('profile.side', 'all', oneOf(...SIDES.map((s) => s[0])))
  useEffect(() => { api<Pnl>(`/api/users/${address}/pnl?period=${period}`).then(setPnl).catch(() => {}) }, [address, period, status])
  const chart = useMemo(() => {
    const pts = pnl?.series || []
    if (pts.length < 2) return null
    const w = 360, h = 120
    const min = Math.min(0, ...pts.map((x) => x.v)), max = Math.max(0, ...pts.map((x) => x.v))
    const span = max - min || 1
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1
    const d = pts.map((x) => `${((x.t - t0) / (t1 - t0 || 1)) * w},${h - ((x.v - min) / span) * (h - 8) - 4}`).join(' ')
    const up = pts[pts.length - 1].v >= 0
    return { d, up, w, h }
  }, [pnl])
  const list = usePaged<Trade>(`${address}|${side}|${status}`, async (cursor, signal) => {
    const r = await api<{ trades: Trade[]; nextCursor?: string | null }>(`/api/users/${address}/trades?limit=${TRADE_PAGE}&side=${side}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { signal })
    return { items: r.trades, next: r.nextCursor ?? null }
  }, (x) => x.id, { cache: 'trades' })   // 后退回来保留已加载的几页

  return <>
    {/* 盈亏：周期切换单独一行（原来挤在数字旁边被压成竖排）；大数字下面已实现 / 未实现分两栏 */}
    <div className="glass mt-4 rounded-[24px] p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted">{t('盈亏')}</span>
        <div className="flex rounded-full bg-black/30 p-0.5">{periods.map(([k, l]) => <button key={k} onClick={() => setPeriod(k)} aria-pressed={period === k} className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${period === k ? 'bg-card2 text-fg' : 'text-muted'}`}>{t(l)}</button>)}</div>
      </div>
      <div className={`number mt-3 break-all text-[34px] font-bold leading-tight tracking-tight ${pnlClass(pnl?.total ?? 0)}`}>{pnlText(pnl?.total ?? 0)}</div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-black/30 px-3 py-2.5"><div className="text-[11px] text-muted">{t('已实现')}</div><div className={`number mt-0.5 text-sm font-semibold ${pnlClass(pnl?.realized ?? 0)}`}>{pnlText(pnl?.realized ?? 0)}</div></div>
        <div className="rounded-2xl bg-black/30 px-3 py-2.5"><div className="text-[11px] text-muted">{t('未实现')}</div><div className={`number mt-0.5 text-sm font-semibold ${pnlClass(pnl?.unrealized ?? 0)}`}>{pnlText(pnl?.unrealized ?? 0)}</div></div>
      </div>
      {chart ? (
        <svg viewBox={`0 0 ${chart.w} ${chart.h}`} className="mt-3 w-full"><polyline points={chart.d} fill="none" stroke={chart.up ? 'var(--color-up)' : 'var(--color-down)'} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" /></svg>
      ) : <div className="mt-3 py-4 text-center text-xs text-muted">{t('这个周期内还没有卖出记录，曲线在第一笔卖出后出现')}</div>}
    </div>
    <div className="mt-5 flex gap-1" role="group" aria-label={t('交易筛选')}>
      {SIDES.map(([k, l]) => <button key={k} onClick={() => setSide(k)} aria-pressed={side === k} className={`min-h-9 rounded-lg px-3 text-sm ${side === k ? 'bg-card2 font-semibold text-fg' : 'text-muted'}`}>{t(l)}</button>)}
    </div>
    {!list.items && (list.failed
      ? <EmptyState icon={ArrowLeftRight} title={t('暂时无法加载交易记录')} action={<Button size="sm" variant="secondary" onClick={list.retry}>{t('重试')}</Button>} />
      : <div className="space-y-3 py-4" role="status" aria-label={t('加载中…')}><div className="skeleton h-10" /><div className="skeleton h-10" /></div>)}
    {list.items && !list.items.length && <EmptyState icon={ArrowLeftRight} title={side === 'all' ? t('还没有交易记录') : t('没有符合条件的交易')} />}
    {list.items && <div className="mt-1 divide-y divide-line/60">
      {list.items.map((tr) => (
        <div key={tr.id} className="flex min-h-12 items-center gap-3 py-2.5 text-sm">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${tr.side === 'buy' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>{tr.side === 'buy' ? t('买入') : t('卖出')}</span>
          <span className="min-w-0 truncate font-semibold">{sideLabel(tr.symbol)}</span><span className="shrink-0 text-muted">{fmtUsd(tr.usd, { compact: true })}</span>
          <span className="ml-auto shrink-0 text-xs text-muted">{timeAgo(tr.created_at)}</span>
          {tr.side === 'sell' && <span className={`shrink-0 text-xs font-semibold ${pnlClass(tr.realized)}`}>{pnlText(tr.realized)}</span>}
        </div>
      ))}
    </div>}
    {list.items && <LoadMore onMore={list.loadMore} loading={list.loading} done={list.done} failed={list.moreFailed} onRetry={list.retry} count={list.items.length} />}
  </>
}

/** 持仓标签：持仓中 / 已平仓 切换；切到这个标签才去拉 */
function HoldingsTab({ address }: { address: string }) {
  const nav = useNavigate()
  const { status } = useSocial()
  const [positions, setPositions] = useState<Position[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [posTab, setPosTab] = usePageState<'open' | 'closed'>('profile.posTab', 'open', oneOf('open', 'closed'))
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let alive = true
    setFailed(false)
    api<Position[]>(`/api/users/${address}/positions`).then((r) => { if (alive) setPositions(Array.isArray(r) ? r : []) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [address, status, retry])
  const shown = (positions || []).filter((x) => (posTab === 'open' ? x.qty > 0 : x.qty <= 0))
  return <>
    <div className="mt-4 flex gap-1" role="group" aria-label={t('持仓状态')}>
      {(['open', 'closed'] as const).map((k) => <button key={k} onClick={() => setPosTab(k)} aria-pressed={posTab === k} className={`min-h-9 rounded-lg px-3 text-sm ${posTab === k ? 'bg-card2 font-semibold text-fg' : 'text-muted'}`}>{k === 'open' ? t('持仓中') : t('已平仓')}</button>)}
    </div>
    {!positions && (failed
      ? <EmptyState icon={Wallet} title={t('暂时无法加载持仓')} action={<Button size="sm" variant="secondary" onClick={() => setRetry((n) => n + 1)}>{t('重试')}</Button>} />
      : <div className="space-y-3 py-4" role="status" aria-label={t('加载中…')}><div className="skeleton h-12" /><div className="skeleton h-12" /></div>)}
    {positions && !shown.length && <EmptyState icon={Wallet} title={posTab === 'open' ? t('没有持仓中的代币') : t('还没有平仓记录')} />}
    <div className="mt-1 divide-y divide-line/60">
      {shown.map((x) => {
        const unreal = x.qty * x.last_price - x.cost
        return (
          <button key={`${x.chain}:${x.token}`} onClick={() => nav(`/token/${x.chain}/${x.token}`)} className="flex w-full items-center gap-3 py-3 text-left">
            <TokenLogo src={x.logo || undefined} symbol={x.symbol} size={36} />
            <div className="min-w-0 flex-1"><div className="truncate font-semibold">{x.symbol}</div><div className="truncate text-xs text-muted">{posTab === 'open' ? t('{qty} · 成本 {cost}', { qty: fmtAmount(x.qty), cost: fmtUsd(x.cost) }) : t('{n} 笔 · {time}', { n: x.trades, time: timeAgo(x.last_at) })}</div></div>
            <div className={`text-right text-sm font-semibold ${pnlClass(posTab === 'open' ? unreal : x.realized)}`}>{pnlText(posTab === 'open' ? unreal : x.realized)}</div>
          </button>
        )
      })}
    </div>
  </>
}
