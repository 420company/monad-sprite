// Web profile page (/u/:address wide screen; entered via the wallet menu's "My profile" or tapping avatars in rankings / community. 2026-09-29 goat: "I tapped personal center and got the phone-preview UI again").
// Layout: left 360 profile card (avatar, name, verification, address, bio, follow / DM) + four stat cells + PnL card (period, realized / unrealized, curve);
// Right tab bar: Posts · Trades · Positions. Same API as the phone profile (pages/Profile.tsx); unreadable data shows an empty state, never made-up numbers.
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeftRight, CalendarDays, Copy, Gift, MessageSquareLock, RefreshCw, Share2, Wallet } from 'lucide-react'
import Avatar from '@/components/Avatar'
import FollowButton from '@/components/FollowButton'
import UserMore from '@/components/UserMore'
import GiftSheet from '@/components/GiftSheet'
import TokenLogo from '@/components/TokenLogo'
import XBadge from '@/components/XBadge'
import { LevelBadge } from '@/live/Badges'
import StaffTag from '@/components/StaffTag'
import { PostList } from '@/components/Posts'
import { MoreText } from '@/components/ListState'
import { toast } from '@/components/Toast'
import { signedMoney } from '@/components/DayPnl'
import { api, type Profile as ProfileT } from '@/lib/social'
import { BALANCE_FEATURES } from '@/lib/features'
import { fmtAmount, fmtUsd, sideLabel, timeAgo, shortId } from '@/lib/format'
import { pnlSign } from '@/lib/dayPnl'
import { PROFILE_TABS, loadProfileTab, saveProfileTab, type ProfileTab } from '@/lib/profileTab'
import { usePaged } from '@/lib/usePaged'
import { copyText } from '@/lib/native'
import { oneOf, usePageState } from '@/lib/pageState'
import { errorText } from '@/lib/errors'
import { locale, t } from '@/lib/i18n'
import { useSocial, displayName } from '@/store/social'
import { needWallet } from '../walletGate'
import { Empty } from '../ui'

interface Social { handle: string | null; followers: number; following: number; isFollowing: boolean; trades: number; pnl: number; avgHoldMs: number | null; joinedAt: number | null; pnl24h: number; followsMe?: boolean; isFriend?: boolean; likes?: number; level?: { viewer: number; streamer: number } }
interface Pnl { series: { t: number; v: number }[]; realized: number; unrealized: number; total: number }
interface Position { chain: string; token: string; symbol: string; logo: string | null; qty: number; cost: number; realized: number; last_price: number; last_at: number; trades: number }
interface Trade { id: string; side: 'buy' | 'sell'; chain: string; token: string; symbol: string; logo: string | null; qty: number; usd: number; price: number; realized: number; created_at: number }
type Period = '24h' | '7d' | '30d' | 'all'
type Side = 'all' | 'buy' | 'sell' | 'closed'
/** Tabs: label is a function, translated only at render time */
const PERIODS: [Period, () => string][] = [['24h', () => t('24 小时')], ['7d', () => t('7 天')], ['30d', () => t('30 天')], ['all', () => t('全部')]]
const SIDES: [Side, () => string][] = [['all', () => t('全部')], ['buy', () => t('买入')], ['sell', () => t('卖出')], ['closed', () => t('已平仓')]]
const TAB_LABEL: Record<ProfileTab, () => string> = { posts: () => t('动态'), trades: () => t('交易||tab'), holdings: () => t('持仓') }
const tone = (v: number) => (pnlSign(v) > 0 ? 'wc-up' : pnlSign(v) < 0 ? 'wc-down' : 'wc-mute')
const TRADE_PAGE = 20

function holdText(ms: number | null) {
  if (!ms) return '--'
  const m = Math.round(ms / 60000)
  if (m < 60) return t('{m}分钟', { m })
  const h = Math.floor(m / 60)
  return h < 48 ? t('{h}小时{m}分钟', { h, m: m % 60 }) : t('{d}天', { d: Math.floor(h / 24) })
}

export default function ProfileDesk() {
  const { address = '' } = useParams()
  const nav = useNavigate()
  const { me, status } = useSocial()
  // Coming in from a list carries the existing profile (router state) — show it immediately without waiting for the API
  const seedRaw = (useLocation().state as { profile?: ProfileT } | null)?.profile
  const seed = seedRaw && seedRaw.address === address ? seedRaw : null
  const [p, setP] = useState<ProfileT | null>(seed)
  // The sprite's address: no profile for it here — go to the sprite page instead (2026-10-05 goat: coming in from a post showed a raw address)
  useEffect(() => { if (p?.sprite) nav(`/fly/${p.sprite.id}`, { replace: true }) }, [p?.sprite?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [pFailed, setPFailed] = useState(false)
  const [social, setSocial] = useState<Social | null>(null)
  const [gifting, setGifting] = useState(false)
  const [tab, setTab] = useState<ProfileTab>(loadProfileTab)
  const [retry, setRetry] = useState(0)
  const pickTab = (k: ProfileTab) => { setTab(k); saveProfileTab(k) }
  useEffect(() => {
    // Switched to a different person: clear the previous person's data first (use the carried-over profile if there is one), drop late results from old requests
    let alive = true
    setP((cur) => (cur && cur.address === address ? cur : seed)); setSocial(null); setPFailed(false)
    api<ProfileT>(`/api/users/${address}`).then((v) => { if (alive) setP(v) }).catch((e) => { if (alive) { setPFailed(true); toast.error(errorText(e, t('加载失败'))) } })
    api<Social>(`/api/users/${address}/social`).then((v) => { if (alive) setSocial(v) }).catch(() => {})
    return () => { alive = false }
  }, [address, status, retry]) // eslint-disable-line react-hooks/exhaustive-deps
  const mine = me?.address === address
  const share = () => copyText(`${location.origin}/u/${address}`).then(() => toast.success(t('主页链接已复制')), () => toast.error(t('复制失败')))
  const refreshSocial = () => api<Social>(`/api/users/${address}/social`).then(setSocial).catch(() => {})

  return (
    <div className="wc-page">
      <div className="wc-prof">
        {/* Left: profile + stats + PnL */}
        <aside className="wc-prof-side">
          <section className="wc-panel wc-prof-card" aria-label={t('个人资料')}>
            {!p ? (
              pFailed ? <Empty icon={RefreshCw} text={t('暂时无法加载这个主页')} action={<button type="button" className="wc-btn is-sm" onClick={() => setRetry((n) => n + 1)}>{t('重试')}</button>} />
                : <div className="flex flex-col gap-3" aria-busy="true" aria-label={t('正在读取中')}><span className="wc-sk" style={{ width: 72, height: 72, borderRadius: 36 }} /><span className="wc-sk" style={{ width: 160, height: 22 }} /><span className="wc-sk" style={{ width: 120, height: 14 }} /></div>
            ) : <>
              <div className="wc-prof-top">
                <Avatar address={address} src={p.avatar} name={p.nickname} size={72} chainId={p.avatarNft?.chainId} />
                <button type="button" className="wc-btn is-sm is-icon" onClick={() => void share()} aria-label={t('复制主页链接')} title={t('复制主页链接')}><Share2 size={14} /></button>
                <UserMore address={address} name={displayName(p)} className="wc-btn is-sm is-icon" size={14} />
              </div>
              <h1 className="wc-prof-name"><span className="wc-ell">{displayName(p)}</span><XBadge address={address} size={15} /><LevelBadge level={social?.level?.streamer} role="streamer" size={22} /><LevelBadge level={social?.level?.viewer} size={22} /></h1>
              <div className="wc-prof-tags">
                <StaffTag address={address} />
                {(p.handle || social?.handle) && <span className="wc-mute">@{p.handle || social?.handle}</span>}
                {p.xHandle && <a className="wc-chip" href={`https://x.com/${p.xHandle}`} target="_blank" rel="noreferrer">𝕏 @{p.xHandle}</a>}
              </div>
              <div className="wc-prof-meta">
                <button type="button" className="wc-addr" onClick={() => copyText(p.evmAddress || address).then(() => toast.success(t('已复制')))} title={p.evmAddress || address}><code>{shortId(p.evmAddress || address)}</code><Copy size={12} aria-hidden="true" /></button>
                {social?.joinedAt && <span className="flex items-center gap-1.5"><CalendarDays size={13} aria-hidden="true" />{t('{date} 加入', { date: new Date(social.joinedAt).toLocaleDateString(locale(), { year: 'numeric', month: 'long' }) })}</span>}
              </div>
              {p.bio && <div className="wc-prof-bio"><MoreText text={p.bio} /></div>}
              {/* Relationships & actions: mutual follow = friend + DM; I follow them = following; they follow me = follow back */}
              {!mine && (
                <div className="wc-prof-acts">
                  {social?.isFriend ? <span className="wc-chip is-accent">{t('好友')}</span> : social?.followsMe && <span className="wc-chip">{t('关注了你')}</span>}
                  <span className="wc-grow" />
                  {social?.isFriend
                    ? <button type="button" className="wc-btn is-primary is-sm" onClick={() => { if (!needWallet()) nav(`/dm/${address}`) }}><MessageSquareLock size={13} />{t('私聊')}</button>
                    : me ? <span className="wc-follow"><FollowButton address={address} initial={social?.isFollowing} label={social?.followsMe ? t('回关成为好友') : t('关注')} onChange={(f, n) => { setSocial((s) => (s ? { ...s, isFollowing: f, followers: n } : s)); void refreshSocial() }} /></span>
                      : <button type="button" className="wc-btn is-sm" onClick={() => { needWallet() }}>{t('关注')}</button>}
                  {BALANCE_FEATURES && me && <button type="button" className="wc-btn is-sm" onClick={() => setGifting(true)}><Gift size={13} />{t('送礼物')}</button>}
                </div>
              )}
              {mine && <div className="wc-prof-acts"><span className="wc-grow" /><button type="button" className="wc-btn is-sm" onClick={() => nav('/settings')}>{t('编辑资料')}</button></div>}
            </>}
            <dl className="wc-prof-stats">
              <div><dd>{social?.following ?? '--'}</dd><dt>{t('关注||count')}</dt></div>
              <div><dd>{social?.followers ?? '--'}</dd><dt>{t('粉丝')}</dt></div>
              <div><dd>{social?.likes ?? '--'}</dd><dt>{t('获赞')}</dt></div>
              <div><dd>{social?.trades ?? '--'}</dd><dt>{t('交易')}</dt></div>
              <div><dd>{social ? holdText(social.avgHoldMs) : '--'}</dd><dt>{t('平均持仓')}</dt></div>
            </dl>
          </section>
          <PnlCard address={address} />
        </aside>

        {/* Right: posts · trades · positions */}
        <section className="wc-panel is-clip wc-prof-main">
          <div className="wc-tabs" role="tablist" aria-label={t('主页内容')}>
            {PROFILE_TABS.map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => pickTab(k)}>{TAB_LABEL[k]()}</button>)}
          </div>
          <div role="tabpanel">
            {tab === 'posts' && <div className="wc-postlist"><PostList filter={{ author: address }} /></div>}
            {tab === 'trades' && <TradesTable address={address} />}
            {tab === 'holdings' && <HoldingsTable address={address} />}
          </div>
        </section>
      </div>
      {p && gifting && <GiftSheet open onClose={() => setGifting(false)} recipients={[p]} initial={p} />}
    </div>
  )
}

/** PnL card: period, total PnL, realized / unrealized, curve (same API as the phone profile /api/users/:address/pnl) */
function PnlCard({ address }: { address: string }) {
  const status = useSocial((s) => s.status)
  const [period, setPeriod] = usePageState<Period>('profile.period', '24h', oneOf('24h', '7d', '30d', 'all'))
  const [pnl, setPnl] = useState<Pnl | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    setFailed(false)
    api<Pnl>(`/api/users/${address}/pnl?period=${period}`).then((v) => { if (alive) setPnl(v) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [address, period, status])
  const chart = useMemo(() => {
    const pts = pnl?.series || []
    if (pts.length < 2) return null
    const w = 320, h = 90
    const min = Math.min(0, ...pts.map((x) => x.v)), max = Math.max(0, ...pts.map((x) => x.v))
    const span = max - min || 1
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1
    const d = pts.map((x) => `${((x.t - t0) / (t1 - t0 || 1)) * w},${h - ((x.v - min) / span) * (h - 8) - 4}`).join(' ')
    return { d, up: pts[pts.length - 1].v >= 0, w, h }
  }, [pnl])
  return (
    <section className="wc-panel" aria-labelledby="wc-pnl-t">
      <div className="wc-ph"><h2 id="wc-pnl-t" className="wc-ph-t">{t('盈亏')}</h2>
        <div className="wc-seg" role="group" aria-label={t('盈亏周期')}>{PERIODS.map(([k, l]) => <button key={k} type="button" aria-pressed={period === k} onClick={() => setPeriod(k)}>{l()}</button>)}</div>
      </div>
      {failed && !pnl ? <Empty icon={RefreshCw} text={t('暂时无法加载盈亏')} />
        : <div className="wc-prof-pnl">
          <div className={`wc-prof-pnl-v ${pnl ? tone(pnl.total) : ''}`}>{pnl ? signedMoney(pnl.total) : <span className="wc-sk" style={{ width: 140, height: 30 }} />}</div>
          <dl><div><dt>{t('已实现')}</dt><dd className={pnl ? tone(pnl.realized) : ''}>{pnl ? signedMoney(pnl.realized) : '--'}</dd></div><div><dt>{t('未实现')}</dt><dd className={pnl ? tone(pnl.unrealized) : ''}>{pnl ? signedMoney(pnl.unrealized) : '--'}</dd></div></dl>
          {chart ? <svg viewBox={`0 0 ${chart.w} ${chart.h}`} className="wc-prof-chart" preserveAspectRatio="none" aria-hidden="true"><polyline points={chart.d} fill="none" stroke={chart.up ? 'var(--w-up)' : 'var(--w-down)'} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg>
            : pnl && <p className="wc-faint text-[12px]">{t('这个周期内还没有卖出记录，曲线在第一笔卖出后出现')}</p>}
        </div>}
    </section>
  )
}

/** Trade history table: side, token, amount, PnL, time; filterable All / Buy / Sell / Closed, 20 per page, load more */
function TradesTable({ address }: { address: string }) {
  const nav = useNavigate()
  const status = useSocial((s) => s.status)
  const [side, setSide] = usePageState<Side>('profile.side', 'all', oneOf('all', 'buy', 'sell', 'closed'))
  const list = usePaged<Trade>(`${address}|${side}|${status}`, async (cursor, signal) => {
    const r = await api<{ trades: Trade[]; nextCursor?: string | null }>(`/api/users/${address}/trades?limit=${TRADE_PAGE}&side=${side}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { signal })
    return { items: r.trades, next: r.nextCursor ?? null }
  }, (x) => x.id, { cache: 'trades' })
  return (
    <div>
      <div className="wc-filter"><div className="wc-seg" role="group" aria-label={t('交易筛选')}>{SIDES.map(([k, l]) => <button key={k} type="button" aria-pressed={side === k} onClick={() => setSide(k)}>{l()}</button>)}</div></div>
      <div className="wc-trades" role="table" aria-label={t('交易记录')}>
        <div className="wc-tr is-th" role="row"><span role="columnheader">{t('方向')}</span><span role="columnheader">{t('代币')}</span><span role="columnheader" className="r">{t('金额')}</span><span role="columnheader" className="r">{t('已实现')}</span><span role="columnheader" className="r">{t('时间')}</span></div>
        {!list.items ? (list.failed ? <Empty tall icon={ArrowLeftRight} text={t('暂时无法加载交易记录')} action={<button type="button" className="wc-btn is-sm" onClick={list.retry}><RefreshCw size={13} />{t('重试')}</button>} />
          : Array.from({ length: 5 }, (_, i) => <div key={i} className="wc-tr" role="row"><span className="wc-sk" style={{ width: 36, height: 18 }} /><span className="wc-sk" style={{ width: '50%', height: 14 }} /><span /><span /><span /></div>))
          : !list.items.length ? <Empty tall icon={ArrowLeftRight} text={side === 'all' ? t('还没有交易记录') : t('没有符合条件的交易')} />
            : list.items.map((tr) => (
              <button key={tr.id} type="button" className="wc-tr" role="row" onClick={() => nav(`/token/${tr.chain}/${tr.token}`)}>
                <span role="cell"><span className={`wc-chip ${tr.side === 'buy' ? 'is-up' : 'is-down'}`}>{tr.side === 'buy' ? t('买入') : t('卖出')}</span></span>
                <span role="cell" className="wc-id"><TokenLogo src={tr.logo || undefined} symbol={tr.symbol} size={26} /><span><b><span>{sideLabel(tr.symbol)}</span></b><small>{fmtAmount(tr.qty)} · {fmtUsd(tr.price)}</small></span></span>
                <span role="cell" className="r num">{fmtUsd(tr.usd, { compact: true })}</span>
                <span role="cell" className={`r num ${tr.side === 'sell' ? tone(tr.realized) : 'wc-faint'}`}>{tr.side === 'sell' ? signedMoney(tr.realized) : '--'}</span>
                <span role="cell" className="r wc-mute">{timeAgo(tr.created_at)}</span>
              </button>
            ))}
      </div>
      {list.items && list.items.length > 0 && !list.done && (
        <div className="wc-pf" style={{ justifyContent: 'center' }}>
          {list.moreFailed ? <button type="button" className="wc-btn is-sm" onClick={list.retry}><RefreshCw size={13} />{t('加载失败，点这里重试')}</button>
            : <button type="button" className="wc-btn is-sm" onClick={list.loadMore} disabled={list.loading}>{list.loading ? t('加载中…') : t('加载更多')}</button>}
        </div>
      )}
    </div>
  )
}

/** Positions table: open / closed (same API as the phone profile /api/users/:address/positions) */
function HoldingsTable({ address }: { address: string }) {
  const nav = useNavigate()
  const status = useSocial((s) => s.status)
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
  return (
    <div>
      <div className="wc-filter"><div className="wc-seg" role="group" aria-label={t('持仓状态')}>
        {(['open', 'closed'] as const).map((k) => <button key={k} type="button" aria-pressed={posTab === k} onClick={() => setPosTab(k)}>{k === 'open' ? t('持仓中') : t('已平仓')}</button>)}
      </div></div>
      <div className="wc-holds" role="table" aria-label={t('持仓')}>
        <div className="wc-tr is-th" role="row"><span role="columnheader">{t('代币')}</span><span role="columnheader" className="r">{posTab === 'open' ? t('数量') : t('交易笔数')}</span><span role="columnheader" className="r">{posTab === 'open' ? t('成本') : t('最近交易')}</span><span role="columnheader" className="r">{posTab === 'open' ? t('未实现') : t('已实现')}</span></div>
        {!positions ? (failed ? <Empty tall icon={Wallet} text={t('暂时无法加载持仓')} action={<button type="button" className="wc-btn is-sm" onClick={() => setRetry((n) => n + 1)}><RefreshCw size={13} />{t('重试')}</button>} />
          : Array.from({ length: 4 }, (_, i) => <div key={i} className="wc-tr" role="row"><span className="wc-sk" style={{ width: '50%', height: 14 }} /><span /><span /><span /></div>))
          : !shown.length ? <Empty tall icon={Wallet} text={posTab === 'open' ? t('没有持仓中的代币') : t('还没有平仓记录')} />
            : shown.map((x) => {
              const unreal = x.qty * x.last_price - x.cost
              return (
                <button key={`${x.chain}:${x.token}`} type="button" className="wc-tr" role="row" onClick={() => nav(`/token/${x.chain}/${x.token}`)}>
                  <span role="cell" className="wc-id"><TokenLogo src={x.logo || undefined} symbol={x.symbol} size={28} /><span><b><span>{x.symbol}</span></b></span></span>
                  <span role="cell" className="r num">{posTab === 'open' ? fmtAmount(x.qty) : x.trades}</span>
                  <span role="cell" className="r num wc-mute">{posTab === 'open' ? fmtUsd(x.cost) : timeAgo(x.last_at)}</span>
                  <span role="cell" className={`r num ${tone(posTab === 'open' ? unreal : x.realized)}`}>{signedMoney(posTab === 'open' ? unreal : x.realized)}</span>
                </button>
              )
            })}
      </div>
    </div>
  )
}
