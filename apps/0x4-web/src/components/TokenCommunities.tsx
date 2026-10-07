// Token detail page bottom: communities holding the most (top 3).
// This used to be auto-created "XX communities" that you joined by tapping in — no owner, no moderation; retired 2026-09-25.
// Official communities can only be created by the platform in the admin console and no longer get their own section: they rank by holdings like regular groups, with a gold verified badge next to the group name when listed.
// Tapping in opens a normal group page; join / apply per the group's own rules. Rankings are computed server-side — only aggregates are fetched.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, Lock, Plus, RefreshCw } from 'lucide-react'
import Avatar from '@/components/Avatar'
import OfficialBadge from '@/components/OfficialBadge'
import { api, type CommunityCard, type TokenCommunities as Data } from '@/lib/social'
import { fmtUsd } from '@/lib/format'
import { t } from '@/lib/i18n'

export default function TokenCommunities({ chain, address, symbol }: { chain: string; address: string; symbol: string }) {
  const nav = useNavigate()
  const [data, setData] = useState<Data | null>(null)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let alive = true
    setFailed(false)
    api<Data>(`/api/tokens/${encodeURIComponent(chain)}/${encodeURIComponent(address)}/communities`)
      .then((d) => { if (alive) setData(d) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [chain, address, retry])

  return (
    <section className="page-gutter mt-6" aria-labelledby="token-communities">
      <h2 id="token-communities" className="section-title">{t('持币最多的社区')}</h2>
      {failed && !data && <div className="status-notice mt-2" role="status"><span className="flex-1">{t('社区加载失败')}</span><button className="icon-button" onClick={() => setRetry((v) => v + 1)} aria-label={t('重试')}><RefreshCw size={18} /></button></div>}
      {!data && !failed && <div className="skeleton mt-2 h-16" aria-label={t('加载中')} />}
      {data && <CommunityList top={data.top} symbol={symbol} onCreate={() => nav('/community', { state: { createFor: { chain, address, symbol } } })} />}
    </section>
  )
}

/** The list itself (pure display, exported separately for tests): at most 3 rows; "create a group" when empty */
export function CommunityList({ top, symbol, onCreate }: { top: CommunityCard[]; symbol: string; onCreate: () => void }) {
  if (!top.length) {
    return (
      <div className="mt-2 border-y border-line/60 py-5 text-center">
        <p className="text-sm text-muted">{t('还没有 {symbol} 持有者聚集的群', { symbol })}</p>
        <button onClick={onCreate} className="text-action mx-auto mt-3"><Plus size={15} />{t('建一个群')}</button>
      </div>
    )
  }
  return <div className="mt-2 divide-y divide-line/60 border-y border-line/60">{top.slice(0, 3).map((g) => <Row key={g.id} g={g} />)}</div>
}

function Row({ g }: { g: CommunityCard }) {
  return (
    <Link to={`/g/${g.id}`} className="flex min-h-16 items-center gap-3 py-3">
      <Avatar address={g.id} src={g.avatar} name={g.name} size={40} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-sm font-medium">
          <span className="truncate">{g.name}</span>
          {g.official === true && <OfficialBadge size={15} />}
          {g.gated && <Lock size={11} className="ml-0.5 shrink-0 text-muted" />}
        </span>
        <span className="number mt-0.5 block truncate text-xs text-muted">
          {g.holders > 0 ? t('{n} 位持有者 · 共持有 {usd}', { n: g.holders, usd: fmtUsd(g.totalUsd, { compact: true }) }) : t('{n} 人', { n: g.memberCount })}
        </span>
      </span>
      <ChevronRight size={16} className="shrink-0 text-muted" />
    </Link>
  )
}
