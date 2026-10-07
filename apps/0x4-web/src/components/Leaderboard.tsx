// Leaderboard: community records, PnL rankings (24h / 7d / 30d / all), my rank, follow button.
// Always shows only the top 50; if I'm in the top 50 my row is highlighted, otherwise a pinned row above the tab bar shows my rank (2026-09-25)
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Lock, Medal, Trophy, Users } from 'lucide-react'
import { EmptyState, Pager, usePager } from './ListState'
import Sheet from './Sheet'
import { toast } from './Toast'
import Avatar from './Avatar'
import OfficialBadge from './OfficialBadge'
import FollowButton from './FollowButton'
import { api } from '@/lib/social'
import { fmtUsd } from '@/lib/format'
import { useSocial, displayName } from '@/store/social'
import XBadge from '@/components/XBadge'
import { t } from '@/lib/i18n'
import { oneOf, usePageState } from '@/lib/pageState'
import UserName from './UserName'
import { errorText } from '@/lib/errors'

interface Row { address: string; nickname: string | null; avatar: string | null; handle: string | null; pnl: number; n: number; closed?: number; wins?: number }
const winRate = (r: { closed?: number; wins?: number }) => r.closed ? t('胜率 {n}%', { n: Math.round((r.wins || 0) / r.closed * 100) }) : null
interface Alliance { id: string; name: string; avatar: string | null; members: number; pnl: number; official?: number | boolean }
const periods = [['24h', '24小时'], ['7d', '7天'], ['30d', '30天'], ['all', '全部']] as const

// Top-3 medal colors: gold / silver / bronze (line icons tinted, readable in both light and dark themes)
const MEDAL = ['#e0a526', '#9aa3ad', '#c27a45']

export const pnlText = (v: number) => `${v >= 0 ? '+' : '-'}${fmtUsd(Math.abs(v))}`
export const pnlClass = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-muted')

export default function Leaderboard() {
  const { me, status } = useSocial()
  // The period is remembered in the session: tapping into someone's profile and back keeps the same period (lib/pageState)
  const [period, setPeriod] = usePageState<(typeof periods)[number][0]>('rank.period', '24h', oneOf(...periods.map((p) => p[0])))
  const [data, setData] = useState<{ list: Row[]; myRank: number | null; myPnl: number | null } | null>(null)
  const inTop = !!me && !!data?.list.some((r) => r.address === me.address)
  const [alliances, setAlliances] = useState<Alliance[]>([])
  const myGroups = useSocial((s) => s.myGroups)
  const [detail, setDetail] = useState<{ a: Alliance; rows: Row[] | null } | null>(null)
  // In-community member rankings are members-only; non-members get a join prompt
  const openDetail = (a: Alliance) => {
    if (!myGroups.some((g) => g.id === a.id)) return toast.info(t('加入这个社区后才能看成员排行'))
    setDetail({ a, rows: null })
    api<Row[]>(`/api/communities/${a.id}/members`).then((rows) => setDetail((d) => d && d.a.id === a.id ? { a, rows } : d)).catch((e) => { toast.error(errorText(e, t('加载失败'))); setDetail(null) })
  }

  // At most 30 per page; ranks follow the global sequence number
  const pager = usePager(data?.list, { reset: period })
  const detailPager = usePager(detail?.rows, { reset: detail?.a.id })
  useEffect(() => { api<typeof data>(`/api/leaderboard?period=${period}`).then(setData).catch(() => setData({ list: [], myRank: null, myPnl: null })) }, [period, status])
  useEffect(() => { api<Alliance[]>('/api/communities').then(setAlliances).catch(() => {}) }, [status])

  return (
    <div>
      <div className="flex items-center justify-between px-4 pt-4">
        <h2 className="flex items-center gap-2 text-lg font-bold">{t('社区')} <span className="rounded bg-social/30 px-1.5 text-[10px]">{t('新')}</span></h2>
        {/* "View all" = go to groups (2026-10-04 walkthrough: it used to point at /community, but rankings already live on the community page, so tapping did nothing). On phones /groups switches to the community's groups tab */}
        <Link to="/groups" className="flex items-center text-xs text-muted">{t('查看全部')} <ChevronRight size={14} /></Link>
      </div>
      <div className="no-scrollbar mt-2 flex gap-3 overflow-x-auto px-4 pb-1">
        {alliances.map((a) => (
          <button key={a.id} onClick={() => openDetail(a)} className="w-40 shrink-0 rounded-2xl bg-card p-3 text-center">
            <div className="mx-auto"><Avatar address={a.id} src={a.avatar} name={a.name} size={56} /></div>
            <div className="mt-2 flex items-center justify-center gap-1 text-sm font-semibold"><span className="truncate">{a.name}</span>{!!a.official && <OfficialBadge size={14} />}</div>
            <div className="flex items-center justify-center gap-1 text-[11px] text-muted"><Users size={11} />{t('{n} 位成员', { n: a.members })}</div>
            <div className={`mt-2 rounded-xl bg-card2 py-1 text-sm font-bold ${pnlClass(a.pnl)}`}>{pnlText(a.pnl)}</div>
            {!myGroups.some((g) => g.id === a.id) && <div className="mt-1 flex items-center justify-center gap-1 text-[10px] text-muted"><Lock size={10} />{t('成员可见详情')}</div>}
          </button>
        ))}
        {!alliances.length && <p className="py-4 text-xs text-muted">{t('还没有群上榜')}</p>}
      </div>

      <div className="mt-4 flex gap-1 px-4">
        {periods.map(([k, label]) => <button key={k} onClick={() => setPeriod(k)} className={`rounded-xl px-3 py-1.5 text-sm ${period === k ? 'bg-card2 font-semibold' : 'text-muted'}`}>{t(label)}</button>)}
      </div>

      <div ref={pager.anchor} className="page-gutter mt-2 divide-y divide-line/60">
        {pager.pageItems.map((r, j) => { const i = pager.page * 30 + j; return (
          <div key={r.address} className={`flex items-center gap-3 py-3 ${r.address === me?.address ? '-mx-3 rounded-xl bg-card px-3' : ''}`} aria-current={r.address === me?.address ? 'true' : undefined}>
            <span className="flex w-7 justify-center">{i < 3 ? <Medal size={20} style={{ color: MEDAL[i] }} aria-label={String(i + 1)} /> : <span className="text-sm text-muted">{i + 1}.</span>}</span>
            <Link to={`/u/${r.address}`}><Avatar address={r.address} src={r.avatar} name={r.nickname} size={44} /></Link>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1"><Link to={`/u/${r.address}`} className="min-w-0 truncate font-semibold"><UserName address={r.address} name={displayName(r)} /></Link><XBadge address={r.address} size={12} /></div>
              <div className="text-xs text-muted">{[r.handle ? `@${r.handle}` : t('{n} 笔交易', { n: r.n }), winRate(r)].filter(Boolean).join(' · ')}</div>
            </div>
            <div className={`text-right font-bold ${pnlClass(r.pnl)}`}>{pnlText(r.pnl)}</div>
            {r.address !== me?.address && <FollowButton address={r.address} size="xs" />}
          </div>
        )})}
        {data && !data.list.length && <EmptyState icon={Trophy} title={t('还没有人交易，第一笔就是榜一')} />}
      </div>
      <Pager p={pager} className="page-gutter" />
      {/* When I'm outside the top 50: a pinned row at the bottom shows my rank (stuck above the tab bar, always visible while scrolling) */}
      {me && data && !inTop && (
        <div className="sticky z-10 mx-4 mt-3" style={{ bottom: 'calc(4.25rem + max(8px, env(safe-area-inset-bottom)))' }}>
          <div className="glass flex items-center gap-3 rounded-2xl px-3 py-2.5">
            <span className="number min-w-7 text-center text-sm font-bold text-muted">{data.myRank ?? '--'}</span>
            <Avatar address={me.address} src={me.avatar} name={me.nickname} size={36} />
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold"><UserName address={me.address} name={displayName(me)} /></div><div className="text-xs text-muted">{data.myRank ? t('你的排名') : t('这个周期还没有交易')}</div></div>
            <div className={`number font-bold ${pnlClass(data.myPnl ?? 0)}`}>{data.myPnl != null ? pnlText(data.myPnl) : '--'}</div>
          </div>
        </div>
      )}
      <Sheet open={!!detail} onClose={() => setDetail(null)} title={detail ? t('{name} · 成员排行', { name: detail.a.name }) : t('成员排行')}>
        {detail?.rows === null && <div className="py-6 text-center text-sm text-muted">{t('加载中…')}</div>}
        <div ref={detailPager.anchor} />
        {detailPager.pageItems.map((r, j) => <div key={r.address} className="flex items-center gap-3 py-2.5">
          <span className="w-7 text-center text-sm text-muted">{detailPager.page * 30 + j + 1}.</span>
          <Link to={`/u/${r.address}`}><Avatar address={r.address} src={r.avatar} name={r.nickname} size={40} /></Link>
          <div className="min-w-0 flex-1"><div className="flex items-center gap-1"><Link to={`/u/${r.address}`} className="min-w-0 truncate font-semibold"><UserName address={r.address} name={displayName(r)} /></Link><XBadge address={r.address} size={12} /></div><div className="text-xs text-muted">{winRate(r) || t('还没有平仓记录')}</div></div>
          <div className={`font-bold ${pnlClass(r.pnl)}`}>{pnlText(r.pnl)}</div>
        </div>)}
        <Pager p={detailPager} />
        {detail?.rows && !detail.rows.length && <div className="py-6 text-center text-sm text-muted">{t('还没有成员交易')}</div>}
      </Sheet>
    </div>
  )
}
