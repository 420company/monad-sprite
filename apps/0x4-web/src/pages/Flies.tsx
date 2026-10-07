// 果蝇实验室：养一只自己的果蝇（stonkfly 连接组模拟）观察真实账户变化
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Activity, ArrowLeft, ChevronRight, Gift, Info, Link2, Plus, Trophy } from 'lucide-react'
import Avatar from '@/components/Avatar'
import Button from '@/components/Button'
import FlySheet from '@/components/FlySheet'
import Sheet from '@/components/Sheet'
import { Pager, usePager } from '@/components/ListState'
import WalletLinkSheet from '@/components/WalletLinkSheet'
import { api, type Fly, type FlyPlan, type FlyPlanDef, type ZalienCard, type ZalienCards } from '@/lib/social'
import { ADOPT_IN_APP, BALANCE_FEATURES } from '@/lib/features'
import { fmtMoney, fmtUsd } from '@/lib/format'
import { useSocial } from '@/store/social'
import { needAccount } from '@/desktop/walletGate'
import { locale, t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'
import { WEB_SURFACE } from '@/lib/surface'

export const pnlText = (v: number) => `${v >= 0 ? '+' : '-'}${fmtMoney(Math.abs(v))}`
export default function Flies() {
  const nav = useNavigate()
  const { status, me } = useSocial()
  const [list, setList] = useState<Fly[]>([])
  const [loadErr, setLoadErr] = useState(false)
  // 我的果蝇（最多 10 只）+ 钱包里的 Zalien 卡（2026-09-27 起凭卡领养）
  const [mine, setMine] = useState<Fly[] | undefined>(undefined)
  const [cards, setCards] = useState<ZalienCards | null>(null)
  const [cardsErr, setCardsErr] = useState<string | null>(null)
  const [claim, setClaim] = useState<{ tokenId: number; free: boolean } | null>(null)
  const [linking, setLinking] = useState(false)
  const [lives, setLives] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [mineLoading, setMineLoading] = useState(true)
  const [mineErr, setMineErr] = useState(false)
  const [revision, setRevision] = useState(0)
  const [workerOk, setWorkerOk] = useState(true)
  const [cap, setCap] = useState<{ capacity: number; remaining: number; plans: Record<FlyPlan, FlyPlanDef> } | null>(null)
  // 运营赠送：名单里的地址免费领养
  const [grant, setGrant] = useState<{ plan: FlyPlan; months: number; note: string | null } | null>(null)
  const [creating, setCreating] = useState(false)
  const [rankOpen, setRankOpen] = useState(false)
  const ranked = useMemo(() => [...list].sort((a, b) => (b.pnl ?? -Infinity) - (a.pnl ?? -Infinity)), [list])
  const rankPager = usePager(ranked)
  const load = () => setRevision((n) => n + 1)
  // 读取状态独立于领养状态；切换登录身份时取消旧请求，失败不能当作没有果蝇。
  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal
    setLoading(true); setLoadErr(false); setMineErr(false); setMine(undefined)
    setList([]); setCap(null); setGrant(null)
    api<{ workerConfigured: boolean; capacity: number; remaining: number; plans: Record<FlyPlan, FlyPlanDef>; grant: { plan: FlyPlan; months: number; note: string | null } | null; list: Fly[] }>('/api/flies', { signal })
      .then((r) => { if (!signal.aborted) { setList(r.list); setWorkerOk(r.workerConfigured); setCap({ capacity: r.capacity, remaining: r.remaining, plans: r.plans }); setGrant(r.grant) } })
      .catch(() => { if (!signal.aborted) setLoadErr(true) })
      .finally(() => { if (!signal.aborted) setLoading(false) })
    if (status === 'ready') {
      setMineLoading(true)
      setCards(null); setCardsErr(null)
      Promise.all([
        api<{ list: Fly[] }>('/api/flies/mine/all', { signal }).then((r) => { if (!signal.aborted) setMine(r.list) }).catch(() => { if (!signal.aborted) setMineErr(true) }),
        // 查卡失败（链上节点暂时不通）不影响看自己的果蝇，只在卡片区提示
        !ADOPT_IN_APP ? Promise.resolve() : api<ZalienCards>('/api/zalien/cards', { signal }).then((r) => { if (!signal.aborted) setCards(r) }).catch((e) => { if (!signal.aborted) setCardsErr(errorText(e, t('加载失败，稍后再试'))) }),
      ]).finally(() => { if (!signal.aborted) setMineLoading(false) })
      // 生活状态（公开接口）：卡片上直接显示它此刻在做什么
      api<{ list: { id: string; life: { text: string; textEn: string } }[] }>('/api/life', { signal }).then((r) => { if (!signal.aborted) setLives(Object.fromEntries(r.list.map((x) => [x.id, locale() === 'en-US' ? x.life.textEn : x.life.text]))) }).catch(() => {})
    } else { setMine([]); setMineLoading(false) }
    return () => controller.abort()
  }, [status, me?.address, revision])

  return (
    <div className="px-4 pb-6" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1rem)' }}>
      <div className="flex items-center gap-2"><button onClick={() => nav(-1)} className="icon-button -ml-2" aria-label={t('返回')}><ArrowLeft size={22} /></button><div><div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.14em] text-accent"><Activity size={13} />Neural trading</div><h1 className="text-2xl font-bold leading-tight">{t('赛博伊甸园')}</h1></div></div>
      <p className="mt-2 max-w-[42rem] text-sm leading-relaxed text-muted">{t('你的小精灵全天候为你交易，它生活在赛博伊甸园中。')}</p>

      <section className="mt-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t('我的小精灵')}</h2>
        {loading || mineLoading ? (
          <div className="rounded-2xl border border-line/70 bg-card p-4 text-sm text-muted" aria-live="polite">{t('正在读取…')}</div>
        ) : mineErr ? <div className="rounded-xl bg-card p-4 text-sm" role="status">{t('暂时无法读取你的小精灵。')}<button onClick={load} className="text-action ml-2 text-accent">{t('重试')}</button></div>
        : status !== 'ready' ? <div className="rounded-xl bg-card p-4"><p className="text-sm text-muted">{ADOPT_IN_APP ? t('登录后即可领养小精灵。') : t('登录后查看你的小精灵。')}</p><Button variant="secondary" className="mt-3 w-full" onClick={() => { if (WEB_SURFACE) { needAccount(); return } nav('/community') }}>{t('去连接')}</Button></div>
        : !ADOPT_IN_APP ? <MySprites mine={mine || []} />
        : <MyZaliens lives={lives} mine={mine || []} cards={cards} cardsErr={cardsErr} grant={grant} price={cap?.plans.basic.price} onClaim={setClaim} onGrant={() => setCreating(true)} onLink={() => setLinking(true)} onRetry={load} />}
        {cap && !workerOk && <div className="mt-2 rounded-xl bg-down/10 px-3 py-2 text-xs text-down">{t('服务暂时不可用，请稍后再试。')}<button onClick={load} className="ml-2 font-semibold underline">{t('重试')}</button></div>}
      </section>

      {/* 小精灵排行：页面上只放一个入口按钮，点开再看（2026-09-27 goat：别整页往下铺） */}
      <button onClick={() => setRankOpen(true)} className="mt-6 flex w-full items-center gap-3 rounded-2xl border border-line/70 bg-card p-3 text-left active:scale-[.99]">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent"><Trophy size={18} aria-hidden="true" /></div>
        <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{t('小精灵排行')}</div><div className="text-xs text-muted">{loading ? t('加载中…') : loadErr ? t('加载失败，稍后再试') : t('共 {n} 只 · 按账户盈亏排序', { n: list.length })}</div></div>
        <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden="true" />
      </button>
      <Sheet open={rankOpen} onClose={() => setRankOpen(false)} title={t('小精灵排行')}>
        <p className="mb-3 text-xs text-muted">{t('按账户盈亏排序，账户中的手动交易与出入金也计入其中。')}</p>
        <div ref={rankPager.anchor} className="space-y-2">{rankPager.pageItems.map((f, j) => <FlyCard key={f.id} f={f} rank={rankPager.page * 30 + j + 1} />)}</div>
        <Pager p={rankPager} />
        {loadErr && <div className="py-4 text-center text-sm text-warning" role="status">{t('加载失败，稍后再试')}<button onClick={load} className="text-action ml-2 text-accent">{t('重试')}</button></div>}
        {!loading && !loadErr && !list.length && <div className="py-8 text-center text-sm text-muted">{ADOPT_IN_APP ? t('暂无领养记录') : t('暂无小精灵')}</div>}
      </Sheet>
      <FlySheet open={creating} onClose={() => setCreating(false)} onSaved={(f) => { setCreating(false); load(); nav(`/fly/${f.id}?tab=trade&start=1`) }} plans={cap?.plans} remaining={cap?.remaining} grant={grant} />
      <FlySheet open={!!claim} onClose={() => setClaim(null)} onSaved={(f) => { setClaim(null); load(); nav(`/fly/${f.id}?tab=trade&start=1`) }} plans={cap?.plans} remaining={cap?.remaining} card={claim} cards={cards?.cards} />
      <WalletLinkSheet open={linking} onClose={() => setLinking(false)} onLinked={() => { setLinking(false); load() }} />
    </div>
  )
}

function FlyCard({ f, rank, mine, to }: { f: Fly; rank?: number; mine?: boolean; to?: string }) {
  const side = f.ticks?.length ? f.ticks[f.ticks.length - 1].neural.side : null
  return (
    <Link to={to || `/fly/${f.id}`} className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 transition-transform active:scale-[.99] ${mine ? 'border-accent/50 bg-gradient-to-r from-card to-card2 shadow-sm' : 'border-line/60 bg-card'}`}>
      {rank && <span className="w-5 text-center text-sm font-bold text-muted">{rank}</span>}
      <div className="relative"><Avatar address={f.address} name={f.name} size={44} /><span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card ${f.online ? 'bg-up' : 'bg-line'}`} /></div>
      <div className="min-w-[120px] flex-1">
        <div className="flex flex-wrap items-center gap-1.5 font-semibold"><span className="break-all">{f.name}</span>{f.expired && <span className="rounded bg-card2 px-1 text-[10px] text-muted">{t('休眠')}</span>}{f.paused && !f.expired && <span className="rounded bg-card2 px-1 text-[10px] text-muted">{t('已暂停')}</span>}{f.halted && <span className="rounded bg-down/20 px-1 text-[10px] text-down">{t('停机')}</span>}{f.mode !== 'pending' && <span className="rounded bg-down/20 px-1 text-[10px] text-down">{f.mode === 'perp' ? t('合约 {n}x', { n: f.leverage }) : t('真金')}</span>}</div>
        <div className="truncate text-xs text-muted">{t('{owner} 的小精灵 · 关注 {tokens}', { owner: f.ownerNickname || f.owner.slice(0, 6), tokens: f.params.tokens.map((tk) => tk.symbol).join(' / ') })}{side ? ` · ${side}` : ''}</div>
      </div>
      <div className="ml-auto max-w-full text-right tabular-nums break-words">
        {f.activated && <div className="text-xs text-muted">{f.mode === 'perp' ? t('账户变化') : t('已实现盈亏')}</div>}
        {!f.activated ? <div className="text-xs text-muted">{t('尚未启用')}</div> : f.pnlHidden ? <div className="text-xs text-muted">{t('盈亏已隐藏')}</div> : f.pnl == null ? <div className="text-xs text-muted">{t('等数据')}</div> : <div className={`font-bold ${f.pnl > 0 ? 'text-up' : f.pnl < 0 ? 'text-down' : 'text-muted'}`}>{pnlText(f.pnl)}</div>}
        <div className="text-[11px] text-muted">{f.mode === 'perp' ? t('账户 {amount}', { amount: f.realEquity == null ? '--' : fmtUsd(f.realEquity) }) : f.mode === 'confirm' ? t('已成交 {n} 笔', { n: f.realizedTrades == null ? '--' : f.realizedTrades }) : ''}</div>
      </div>
    </Link>
  )
}

/** iOS 上架版（lib/features ADOPT_IN_APP 为假）：只列出已经有的小精灵。不查钱包里的 NFT，不出现领养入口，也不写去哪领养 */
function MySprites({ mine }: { mine: Fly[] }) {
  if (!mine.length) return <div className="rounded-2xl border border-line/70 bg-card p-4 text-sm text-muted">{t('你还没有小精灵')}</div>
  return <div className="space-y-2">{mine.map((f) => <FlyCard key={f.id} f={f} mine />)}</div>
}

// 日期跟随 App 语言，不跟浏览器语言
const day = (ms: number) => new Date(ms).toLocaleDateString(locale(), { month: 'short', day: 'numeric' })

/** 我的 Zalien 与果蝇。手机 App 里不出现价格、续费和铸造入口（苹果审核）；网页版空闲卡可以付费领养 */
export function MyZaliens({ lives, mine, cards, cardsErr, grant, price, onClaim, onGrant, onLink, onRetry }: { lives: Record<string, string>; mine: Fly[]; cards: ZalienCards | null; cardsErr: string | null; grant: { plan: FlyPlan; months: number; note: string | null } | null; price?: number; onClaim: (c: { tokenId: number; free: boolean }) => void; onGrant: () => void; onLink: () => void; onRetry: () => void }) {
  const list = cards?.cards || []
  const full = !!cards && cards.liveFlies >= cards.maxFlies
  const byId = new Map(mine.map((f) => [f.id, f]))
  // 不挂在「我钱包里的卡」上的果蝇：赠送领的、老的、卡已经卖掉还在跑到期的
  const shown = new Set(list.filter((c) => c.fly?.mine).map((c) => c.fly!.id))
  const others = mine.filter((f) => !shown.has(f.id))
  const empty = !!cards && !list.length && !mine.length
  // 卡多的时候分页，每页 5 张
  const PER = 5
  const pages = Math.max(1, Math.ceil(list.length / PER))
  const [page, setPage] = useState(0)
  const cur = Math.min(page, pages - 1)
  const shownCards = list.slice(cur * PER, cur * PER + PER)
  return (
    <div className="space-y-3">
      {cards && (list.length > 0 || mine.length > 0) && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-line/70 bg-card px-4 py-3"><div className="text-[11px] tracking-wide text-muted">{t('我的 Zalien')}</div><div className="mt-0.5 text-2xl font-bold tabular-nums">{list.length} <span className="text-sm font-medium text-muted">{t('张')}</span></div></div>
          <div className="rounded-2xl border border-line/70 bg-card px-4 py-3"><div className="text-[11px] tracking-wide text-muted">{t('我的小精灵')}</div><div className="mt-0.5 text-2xl font-bold tabular-nums">{cards.liveFlies} <span className="text-sm font-medium text-muted">/ {t('{n} 只', { n: cards.maxFlies })}</span></div></div>
        </div>
      )}
      {grant && (
        <div className="rounded-2xl border border-line/70 bg-card p-4">
          <div className="text-sm"><Gift size={15} className="mr-1 inline-block align-[-2px] text-accent" aria-hidden="true" /><b>{t('你有一只赠送的小精灵')}</b>{grant.note ? `（${grant.note}）` : ''}</div>
          <Button className="mt-3 w-full" disabled={full} onClick={onGrant}><Plus size={16} /> {t('免费领养')}</Button>
        </div>
      )}
      {cardsErr && <div className="rounded-xl bg-card p-3 text-sm" role="status">{cardsErr}<button onClick={onRetry} className="text-action ml-2 text-accent">{t('重试')}</button></div>}
      {list.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-line/70 bg-card">
          <div className="flex items-baseline justify-between px-4 pb-1 pt-3"><span className="text-[15px] font-semibold">{t('我的 Zalien')}</span><span className="text-[11px] text-muted">{t('根据钱包持有情况自动显示')}</span></div>
          {shownCards.map((c) => <CardRow key={c.tokenId} c={c} fly={c.fly ? byId.get(c.fly.id) : undefined} life={c.fly ? lives[c.fly.id] : undefined} full={full} price={price} onClaim={onClaim} />)}
          {pages > 1 && (
            <div className="flex items-center justify-between border-t border-line/70 px-4 py-2">
              <button onClick={() => setPage(cur - 1)} disabled={cur === 0} className="min-h-10 rounded-lg px-3 text-sm font-medium text-accent disabled:text-muted disabled:opacity-40">{t('上一页')}</button>
              <span className="text-xs tabular-nums text-muted">{cur + 1} / {pages}</span>
              <button onClick={() => setPage(cur + 1)} disabled={cur >= pages - 1} className="min-h-10 rounded-lg px-3 text-sm font-medium text-accent disabled:text-muted disabled:opacity-40">{t('下一页')}</button>
            </div>
          )}
        </div>
      )}
      {others.length > 0 && <div className="space-y-2">{others.map((f) => <FlyCard key={f.id} f={f} mine to={`/fly/${f.id}/live`} />)}</div>}
      {empty && !grant && (
        <div className="rounded-2xl border border-line/70 bg-card px-4 py-6 text-center">
          {/* 2026-09-27 goat 定稿文案，别改 */}
          <div className="text-lg font-semibold">{t('想要领养小精灵？')}</div>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{t('当前地址中未检测到持有Zalien.')}</p>
          <p className="mt-1 text-sm font-semibold tracking-wide text-accent">Zalien is the key.</p>
          <Button variant="secondary" className="mt-4 w-full" onClick={onLink}><Link2 size={16} /> {t('关联其他钱包')}</Button>
        </div>
      )}
      {list.length > 0 && <p className="flex gap-1.5 px-1 text-[11px] leading-relaxed text-muted"><Info size={13} className="mt-px shrink-0" aria-hidden="true" />{t('每张 NFT 同一时间可领养一只小精灵。NFT 转让后，已领养的小精灵将运行至到期日，届时不可续期。')}</p>}
      {list.length > 0 && <button onClick={onLink} className="mx-1 text-xs text-accent">{t('关联其他钱包')}</button>}
    </div>
  )
}

function CardRow({ c, fly, life, full, price, onClaim }: { c: ZalienCard; fly?: Fly; life?: string; full: boolean; price?: number; onClaim: (c: { tokenId: number; free: boolean }) => void }) {
  const img = <img src={c.image} alt="" className="size-12 shrink-0 rounded-xl bg-card2 object-cover" loading="lazy" />
  const title = <div className="text-[15px] font-medium">Zalien #{c.tokenId}</div>
  const row = 'flex min-h-16 items-center gap-3 border-t border-line/70 px-4 py-2.5'
  if (c.status === 'busy' && c.fly?.mine) {
    const sleeping = !!c.fly.paidUntil && c.fly.paidUntil <= Date.now()
    return (
      <Link to={`/fly/${c.fly.id}/live`} className={`${row} active:bg-card2`}>
        {img}<div className="min-w-0 flex-1">{title}<div className="truncate text-xs text-muted">{t('小精灵「{name}」', { name: c.fly.name })}{life ? ` · ${life}` : fly ? ` · ${fly.params.tokens.map((x) => x.symbol).join(' / ')}` : ''}</div></div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${sleeping ? 'bg-warning/15 text-warning' : fly && !fly.activated ? 'bg-card2 text-muted' : 'bg-up/15 text-up'}`}>{sleeping ? t('休眠中') : fly && !fly.activated ? t('尚未启用') : t('运行中')}</span><ChevronRight size={16} className="shrink-0 text-muted" aria-hidden="true" />
      </Link>
    )
  }
  if (c.status === 'busy') {
    const sleeping = !!c.fly?.paidUntil && c.fly.paidUntil <= Date.now()
    return <div className={row}>{img}<div className="min-w-0 flex-1">{title}<div className="text-xs text-muted">{sleeping && c.fly?.releaseAt ? t('此卡已被领养，{date} 后可重新领养', { date: day(c.fly.releaseAt) }) : c.fly?.paidUntil ? t('此卡已被领养，{date} 到期', { date: day(c.fly.paidUntil) }) : t('此卡已被领养')}</div></div><span className="shrink-0 rounded-full bg-warning/15 px-2.5 py-1 text-xs text-warning">{t('已被领养')}</span></div>
  }
  if (c.status === 'free') {
    return <div className={row}>{img}<div className="min-w-0 flex-1">{title}<div className="text-xs text-muted">{t('可免费领养 1 个月')}</div></div><Button size="sm" disabled={full} onClick={() => onClaim({ tokenId: c.tokenId, free: true })}>{full ? t('已达上限') : t('免费领养')}</Button></div>
  }
  // 未领养（免费月已用）：手机 App 里只写状态，不写价格也不给付费入口
  return <div className={row}>{img}<div className="min-w-0 flex-1">{title}<div className="text-xs text-muted">{t('此卡当前未被领养')}</div></div>{!BALANCE_FEATURES ? <span className="shrink-0 rounded-full bg-card2 px-2.5 py-1 text-xs text-muted">{t('未领养')}</span> : <Button size="sm" variant="secondary" disabled={full} onClick={() => onClaim({ tokenId: c.tokenId, free: false })}>{t('领养 · {price}/月', { price: fmtUsd(price ?? 10) })}</Button>}</div>
}
