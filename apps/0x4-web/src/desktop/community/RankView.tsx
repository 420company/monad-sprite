// Community → Rankings (/rank; 2026-10-01 community merge, design spec "4-Community-Rankings"):
//   Tabs: Trades / Sprites / Hot communities; the Trades tab adds two more switchers: Global / Following, 24h / 7d / 30d / All;
//   Top 3 get cards (medal, PnL, trade count, win rate, sparkline); 4th onward one row each; my row is highlighted if I'm ranked, otherwise a pinned row of mine at the end if I'm outside the top 50.
// Data: /api/leaderboard (scope=following ranks only people I follow), /api/users/:address/pnl (sparkline), /api/flies, /api/communities.
// Sprites and communities only have cumulative numbers — those two tabs show no period switcher; missing numbers show "--", never made up.
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { RefreshCw, Trophy } from 'lucide-react'
import Avatar from '@/components/Avatar'
import XBadge from '@/components/XBadge'
import OfficialBadge from '@/components/OfficialBadge'
import FollowButton from '@/components/FollowButton'
import { RankMedal } from '@/live/Badges'
import { signedMoney } from '@/components/DayPnl'
import { api, type Fly } from '@/lib/social'
import { t } from '@/lib/i18n'
import { oneOf, usePageState } from '@/lib/pageState'
import { useSocial, displayName } from '@/store/social'
import { needWallet } from '../walletGate'
import { SocialLogin } from '../ui'
import CommunityShell, { CmHead } from './CommunityShell'
import { toneOf, type Community } from './FeedView'

type Tab = 'trade' | 'sprite' | 'community'
type Period = '24h' | '7d' | '30d' | 'all'
const PERIODS: [Period, () => string][] = [['24h', () => t('24 小时')], ['7d', () => t('7 天')], ['30d', () => t('30 天')], ['all', () => t('全部')]]
interface Row { address: string; nickname: string | null; avatar: string | null; handle: string | null; pnl: number; n: number; closed?: number; wins?: number }
interface Board { list: Row[]; myRank: number | null; myPnl: number | null; me: { n: number; closed: number; wins: number } | null; total?: number }
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`
const winRate = (r: { closed?: number; wins?: number } | null | undefined) => (r?.closed ? `${Math.round(((r.wins || 0) / r.closed) * 100)}%` : '--')

export default function RankView() {
  return <CommunityShell><RankBody /></CommunityShell>
}

function RankBody() {
  const [params, setParams] = useSearchParams()
  // Old links /rank?focus=sprites (the sprite page's "view rankings") are also recognized
  // Tabs follow the URL directly: links to "Sprites / Hot communities" in the right sidebar switch over even when already on the rankings page
  const tab: Tab = params.get('tab') === 'sprite' || params.get('focus') === 'sprites' ? 'sprite' : params.get('tab') === 'community' ? 'community' : 'trade'
  const setTab = (v: Tab) => setParams(v === 'trade' ? {} : { tab: v }, { replace: true })
  return (
    <>
      <CmHead title={t('排行')} sub={t('看看谁最会交易，哪只小精灵最能赚，哪个社区最热闹')} />
      <div className="cm-utabs" role="tablist" aria-label={t('排行类型')}>
        <button type="button" role="tab" aria-selected={tab === 'trade'} onClick={() => setTab('trade')}>{t('交易')}</button>
        <button type="button" role="tab" aria-selected={tab === 'sprite'} onClick={() => setTab('sprite')}>{t('小精灵')}</button>
        <button type="button" role="tab" aria-selected={tab === 'community'} onClick={() => setTab('community')}>{t('热门社区')}</button>
      </div>
      {tab === 'trade' ? <TradeBoard /> : tab === 'sprite' ? <SpriteBoard /> : <CommunityBoard />}
    </>
  )
}

/** Trend line: cumulative realized PnL; the last point is current total PnL (incl. open positions), matching the big number on the card */
function Spark({ address, period, pnl }: { address: string; period: Period; pnl: number }) {
  const [pts, setPts] = useState<number[] | null>(null)
  useEffect(() => {
    let alive = true
    api<{ series: { t: number; v: number }[] }>(`/api/users/${address}/pnl?period=${period}`).then((r) => { if (alive) setPts([0, ...(Array.isArray(r?.series) ? r.series.map((p) => p.v) : []), pnl]) }).catch(() => { if (alive) setPts([0, pnl]) })
    return () => { alive = false }
  }, [address, period, pnl])
  if (!pts) return <svg aria-hidden="true" />
  const W = 300, H = 40
  const min = Math.min(...pts), max = Math.max(...pts)
  const y = (v: number) => (max === min ? H / 2 : H - 3 - ((v - min) / (max - min)) * (H - 6))
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${((i / Math.max(1, pts.length - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true"><path d={d} fill="none" stroke={pnl >= 0 ? '#2fd49a' : '#ff6b7a'} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" /></svg>
}

function TradeBoard() {
  const me = useSocial((s) => s.me)
  const status = useSocial((s) => s.status)
  const [period, setPeriod] = usePageState<Period>('rank.period', '24h', oneOf(...PERIODS.map((p) => p[0])))
  const [scope, setScope] = usePageState<'global' | 'following'>('rank.scope', 'global', oneOf('global', 'following'))
  const [board, setBoard] = useState<Board | null>(null)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const eff = scope === 'following' && status === 'ready' ? 'following' : 'global'
  useEffect(() => {
    let alive = true
    setBoard(null); setFailed(false)
    api<Board>(`/api/leaderboard?period=${period}&scope=${eff}`).then((b) => { if (alive) setBoard({ list: Array.isArray(b?.list) ? b.list : [], myRank: b?.myRank ?? null, myPnl: b?.myPnl ?? null, me: b?.me ?? null, total: b?.total }) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [period, eff, status, retry])
  const list = board?.list ?? []
  const inTop = !!me && list.some((r) => r.address === me.address)
  return (
    <>
      <div className="cm-filters">
        <div className="cm-seg" role="group" aria-label={t('排行范围')}>
          <button type="button" aria-pressed={eff === 'global'} onClick={() => setScope('global')}>{t('全球')}</button>
          <button type="button" aria-pressed={eff === 'following'} onClick={() => { if (!needWallet()) setScope('following') }}>{t('我关注的')}</button>
        </div>
        <div className="cm-seg" role="group" aria-label={t('排行周期')}>
          {PERIODS.map(([k, label]) => <button key={k} type="button" aria-pressed={period === k} onClick={() => setPeriod(k)}>{label()}</button>)}
        </div>
      </div>
      {failed && !board ? <Failed onRetry={() => setRetry((n) => n + 1)} />
        : !board ? <Loading />
          : !list.length ? <div className="cm-panel cm-empty"><Trophy size={26} aria-hidden="true" /><span>{eff === 'following' ? t('你关注的人这个周期还没有交易') : t('这个周期还没有人交易，第一笔就是榜一')}</span></div>
            : <>
              <div className="cm-podium">{list.slice(0, 3).map((r, i) => (
                <Link key={r.address} to={`/u/${r.address}`} className={`cm-pc is-${i + 1}`}>
                  <span className="cm-pc-medal"><RankMedal rank={i + 1} size={40} /></span>
                  <span className="cm-pc-who"><Avatar address={r.address} src={r.avatar} name={r.nickname} size={44} /><span><b>{displayName(r)}<XBadge address={r.address} size={12} /></b><small>{r.handle ? `@${r.handle}` : short(r.address)}</small></span></span>
                  <div className={`cm-pc-big ${toneOf(r.pnl)}`}>{signedMoney(r.pnl)}</div>
                  <div className="cm-pc-meta num">{t('{n} 笔成交', { n: r.n })}　{t('胜率 {r}', { r: winRate(r) })}</div>
                  <Spark address={r.address} period={period} pnl={r.pnl} />
                </Link>))}</div>
              {list.length > 3 && <div className="cm-rrow is-th" role="row"><span>{t('名次')}</span><span>{t('交易员')}</span><span className="r">{t('盈亏')}</span><span className="r">{t('交易笔数')}</span><span className="r">{t('胜率')}</span><span /></div>}
              {list.slice(3).map((r, j) => <TradeRow key={r.address} r={r} rank={j + 4} mine={r.address === me?.address} />)}
              {me && !inTop && board.myRank && <TradeRow r={{ ...me, handle: null, pnl: board.myPnl ?? 0, n: board.me?.n ?? 0, closed: board.me?.closed, wins: board.me?.wins }} rank={board.myRank} mine />}
              {!me && <div className="pt-4"><SocialLogin bar /></div>}
            </>}
    </>
  )
}

function TradeRow({ r, rank, mine }: { r: Row; rank: number; mine: boolean }) {
  return (
    <div className={`cm-rrow ${mine ? 'is-me' : ''}`} role="row" aria-current={mine ? 'true' : undefined}>
      <span className="cm-rrow-no">{rank}</span>
      <Link to={`/u/${r.address}`} className="cm-rrow-who"><Avatar address={r.address} src={r.avatar} name={r.nickname} size={40} /><span><b>{displayName(r)}{mine && <span className="text-[var(--w-mute)]"> · {t('我')}</span>}<XBadge address={r.address} size={12} /></b><small>{r.handle ? `@${r.handle}` : short(r.address)}</small></span></Link>
      <span className={`r ${toneOf(r.pnl)}`}>{signedMoney(r.pnl)}</span>
      <span className="r">{t('{n} 笔', { n: r.n })}</span>
      <span className="r">{winRate(r)}</span>
      <span className="r">{!mine && <FollowButton address={r.address} size="xs" />}</span>
    </div>
  )
}

function SpriteBoard() {
  const nav = useNavigate()
  const status = useSocial((s) => s.status)
  const [list, setList] = useState<Fly[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let alive = true
    setFailed(false)
    api<{ list: Fly[] }>('/api/flies').then((r) => { if (alive) setList(Array.isArray(r?.list) ? r.list : []) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [status, retry])
  // Those with public PnL rank by PnL; unenabled / owner-hidden / not-yet-data rank after, with the reason stated
  const ranked = useMemo(() => [...(list ?? [])].sort((a, b) => score(b) - score(a)), [list])
  const open = (f: Fly) => { if (!needWallet()) nav(`/fly/${f.id}`) }
  if (failed && !list) return <Failed onRetry={() => setRetry((n) => n + 1)} />
  if (!list) return <Loading />
  if (!ranked.length) return <div className="cm-panel cm-empty"><Trophy size={26} aria-hidden="true" /><span>{t('伊甸园里还没有小精灵')}</span></div>
  const top = ranked.filter(hasPnl).slice(0, 3)
  const rest = ranked.filter((f) => !top.includes(f))
  return (
    <>
      <p className="cm-sub" style={{ margin: '-4px 0 16px' }}>{t('按小精灵账户的累计盈亏排名')}</p>
      {top.length > 0 && <div className="cm-podium">{top.map((f, i) => (
        <button key={f.id} type="button" className={`cm-pc is-${i + 1}`} onClick={() => open(f)}>
          <span className="cm-pc-medal"><RankMedal rank={i + 1} size={40} /></span>
          <span className="cm-pc-who"><Avatar address={f.address} name={f.name} size={44} /><span><b>{f.name}</b><small>{t('{owner} 的小精灵', { owner: f.ownerNickname || short(f.owner) })}</small></span></span>
          <div className={`cm-pc-big ${toneOf(f.pnl ?? 0)}`}>{signedMoney(f.pnl ?? 0)}</div>
          <div className="cm-pc-meta num">{f.realizedTrades != null ? t('{n} 笔成交', { n: f.realizedTrades }) : t('合约账户')}　{t('{n} 人关注', { n: f.followers })}</div>
        </button>))}</div>}
      {rest.length > 0 && <div className="cm-rrow is-th" role="row"><span>{t('名次')}</span><span>{t('小精灵')}</span><span className="r">{t('盈亏')}</span><span className="r">{t('交易笔数')}</span><span className="r">{t('关注')}</span><span /></div>}
      {rest.map((f, j) => (
        <button key={f.id} type="button" className="cm-rrow w-full text-left" onClick={() => open(f)}>
          <span className="cm-rrow-no">{hasPnl(f) ? top.length + j + 1 : '--'}</span>
          <span className="cm-rrow-who"><Avatar address={f.address} name={f.name} size={40} /><span><b>{f.name}</b><small>{t('{owner} 的小精灵', { owner: f.ownerNickname || short(f.owner) })}</small></span></span>
          <span className="r">{!f.activated ? <span className="cm-flat">{t('尚未启用')}</span> : f.pnlHidden ? <span className="cm-flat">{t('盈亏已隐藏')}</span> : f.pnl == null ? <span className="cm-flat">{t('等数据')}</span> : <span className={toneOf(f.pnl)}>{signedMoney(f.pnl)}</span>}</span>
          <span className="r">{f.realizedTrades != null ? t('{n} 笔', { n: f.realizedTrades }) : '--'}</span>
          <span className="r">{f.followers}</span>
          <span />
        </button>))}
    </>
  )
}
const hasPnl = (f: Fly) => f.activated && !f.pnlHidden && f.pnl != null
const score = (f: Fly) => (hasPnl(f) ? f.pnl! : -Infinity)

function CommunityBoard() {
  const nav = useNavigate()
  const status = useSocial((s) => s.status)
  const [list, setList] = useState<Community[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let alive = true
    setFailed(false)
    api<Community[]>('/api/communities').then((l) => { if (alive) setList(Array.isArray(l) ? [...l].sort((a, b) => b.pnl - a.pnl) : []) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [status, retry])
  const open = (c: Community) => { if (!needWallet()) nav(`/g/${c.id}`) }
  if (failed && !list) return <Failed onRetry={() => setRetry((n) => n + 1)} />
  if (!list) return <Loading />
  if (!list.length) return <div className="cm-panel cm-empty"><Trophy size={26} aria-hidden="true" /><span>{t('还没有群上榜')}</span></div>
  return (
    <>
      <p className="cm-sub" style={{ margin: '-4px 0 16px' }}>{t('按群内全体成员的累计盈亏排名')}</p>
      <div className="cm-podium">{list.slice(0, 3).map((c, i) => (
        <button key={c.id} type="button" className={`cm-pc is-${i + 1}`} onClick={() => open(c)}>
          <span className="cm-pc-medal"><RankMedal rank={i + 1} size={40} /></span>
          <span className="cm-pc-who"><Avatar address={c.id} src={c.avatar} name={c.name} size={44} /><span><b>{c.name}{!!c.official && <OfficialBadge size={13} />}</b><small className="num">{t('{n} 成员', { n: c.members })}</small></span></span>
          <div className={`cm-pc-big ${toneOf(c.pnl)}`}>{signedMoney(c.pnl)}</div>
          <div className="cm-pc-meta">{t('成员盈亏合计')}</div>
        </button>))}</div>
      {list.length > 3 && <div className="cm-rrow is-th" role="row"><span>{t('名次')}</span><span>{t('社区')}</span><span className="r">{t('盈亏合计')}</span><span className="r">{t('成员')}</span><span /><span /></div>}
      {list.slice(3).map((c, j) => (
        <button key={c.id} type="button" className="cm-rrow w-full text-left" onClick={() => open(c)}>
          <span className="cm-rrow-no">{j + 4}</span>
          <span className="cm-rrow-who"><Avatar address={c.id} src={c.avatar} name={c.name} size={40} /><span><b>{c.name}{!!c.official && <OfficialBadge size={13} />}</b></span></span>
          <span className={`r ${toneOf(c.pnl)}`}>{signedMoney(c.pnl)}</span>
          <span className="r">{c.members}</span>
          <span /><span />
        </button>))}
    </>
  )
}

function Loading() {
  return <><div className="cm-podium">{[0, 1, 2].map((i) => <span key={i} className="cm-sk" style={{ height: 180, borderRadius: 20 }} />)}</div>{[0, 1, 2].map((i) => <span key={i} className="cm-sk" style={{ height: 52, marginTop: 10 }} />)}</>
}
function Failed({ onRetry }: { onRetry: () => void }) {
  return <div className="cm-panel cm-empty"><span>{t('暂时无法加载排行')}</span><button type="button" className="cm-btn is-quiet is-sm" onClick={onRetry}><RefreshCw size={13} />{t('重试')}</button></div>
}
