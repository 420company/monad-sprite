// Activity page: send/receive records from all chains merged into one timeline (redone 2026-09-26)
// · Top chain filter: All · BSC · ETH · Base resident, Solana / Bitcoin / Arbitrum / Polygon / Optimism tucked in "More" (fits one row, like Discover)
// · EVM records come from the server (BSC first); Solana, Bitcoin, and in-app flash swaps / cross-chain merge in reverse-chronological order; in-progress flash swaps / cross-chain pinned on top
// · Scroll to the bottom to load more; an unreadable chain only warns for its own part, the rest shows as usual
// Sources and merge logic: see lib/activitySources.ts, lib/activityTimeline.ts
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDownLeft, ArrowLeft, ArrowLeftRight, ArrowUpRight, Check, ChevronDown, Clock, Repeat, RefreshCw, XCircle } from 'lucide-react'
import { useBridge } from '@/store/bridge'
import { useWallet } from '@/store/wallet'
import { useSettings } from '@/store/settings'
import { useSocial } from '@/store/social'
import { BTC_CHAIN_ID, SOLANA_CHAIN_ID, chainById, chainName } from '@/lib/chains'
import { shortBtc } from '@/lib/btc'
import { fmtAmount, shortAddr, shortId, timeAgo } from '@/lib/format'
import { StatusPill } from '@/pages/Swap'
import { t } from '@/lib/i18n'
import { useBack } from '@/lib/useBack'
import { oneOf, usePageState } from '@/lib/pageState'
import { usePaged } from '@/lib/usePaged'
import { EmptyState, LoadMore } from '@/components/ListState'
import Sheet from '@/components/Sheet'
import { createMerger, groupTimeline, type TimelineEntry, type TimelineRow, type TimelineSource } from '@/lib/activityTimeline'
import { bridgeSource, btcSource, evmSource, solSource } from '@/lib/activitySources'

type Filter = 'all' | 'bsc' | 'ethereum' | 'base' | 'solana' | 'bitcoin' | 'arbitrum' | 'polygon' | 'optimism'
const FILTERS: { value: Filter; label: string; chainId?: number }[] = [
  { value: 'all', label: '全部' },
  { value: 'bsc', label: 'BSC', chainId: 56 },
  { value: 'ethereum', label: 'ETH', chainId: 1 },
  { value: 'base', label: 'Base', chainId: 8453 },
  { value: 'solana', label: 'Solana', chainId: SOLANA_CHAIN_ID },
  { value: 'bitcoin', label: 'Bitcoin', chainId: BTC_CHAIN_ID },
  { value: 'arbitrum', label: 'Arbitrum', chainId: 42161 },
  { value: 'polygon', label: 'Polygon', chainId: 137 },
  { value: 'optimism', label: 'Optimism', chainId: 10 },
]
/** Resident capsules (All + 3 chains + More — fits one row like Discover); picking another chain in "More" takes the last slot */
const ALWAYS = FILTERS.slice(0, 4)
const MORE = FILTERS.slice(4)
const PAGE = 25

/** Mergers are keyed by "filter + address" in the module: coming back reuses already-loaded pages via usePaged, and "load more" keeps paging */
const mergers = new Map<string, ReturnType<typeof createMerger>>()

/**
 * Activity timeline data (extracted 2026-09-29: the mobile activity page and the web "My assets → Activity" share the same fetching and merging — no duplicate copies).
 * filter: filter by chain; returns the paged list, merged rows, in-progress flash swaps / cross-chain, and unreadable chains.
 */
export function useActivityTimeline(filter: Filter) {
  const { address, evmAddress, btcAddress } = useWallet()
  const rpcUrl = useSettings((s) => s.rpcUrl)
  const socialReady = useSocial((s) => s.status === 'ready')
  const { transfers, pollAllPending } = useBridge()
  const [notice, setNotice] = useState<{ failed: string[]; unavailable: number[] }>({ failed: [], unavailable: [] })
  useEffect(() => { pollAllPending() }, [pollAllPending])

  const chainId = FILTERS.find((f) => f.value === filter)?.chainId ?? null
  const isEvm = chainId !== null && chainId !== SOLANA_CHAIN_ID && chainId !== BTC_CHAIN_ID
  // A flash swap / cross-chain counts if this chain is its source or destination
  const bridgeMatch = useCallback((b: { fromChain: number; toChain: number }) => chainId === null || b.fromChain === chainId || b.toChain === chainId, [chainId])

  // Re-pull when login state changes (social session just became ready): EVM records need the token
  const key = address ? `${filter}|${address}|${evmAddress || ''}|${btcAddress || ''}|${socialReady ? 1 : 0}` : null
  const fetchPage = useCallback(async (cursor: string | null, signal: AbortSignal) => {
    if (!key) return { items: [] as TimelineEntry[], next: null }
    let m = cursor ? mergers.get(key) : undefined
    if (!m) {
      const sources: TimelineSource[] = []
      if (evmAddress && (filter === 'all' || isEvm)) sources.push(evmSource(isEvm ? chainId : null))
      if (address && (filter === 'all' || filter === 'solana')) sources.push(solSource(rpcUrl, address))
      if (btcAddress && (filter === 'all' || filter === 'bitcoin')) sources.push(btcSource(btcAddress))
      // Finished flash swaps / cross-chain merge into the timeline; the on-chain EVM / Solana record with the same hash is no longer shown twice
      const done = useBridge.getState().transfers.filter((b) => b.status !== 'PENDING' && bridgeMatch(b))
      const own = new Set(useBridge.getState().transfers.map((b) => b.txHash.toLowerCase()))
      sources.unshift(bridgeSource(done))
      m = createMerger(sources, { pageSize: PAGE, skip: (e) => e.source !== 'bridge' && own.has(e.hash.toLowerCase()) })
      mergers.set(key, m)
      if (mergers.size > 20) mergers.delete(mergers.keys().next().value as string)
    }
    const p = await m.page(signal)
    setNotice({ failed: p.failed, unavailable: p.unavailable })
    return { items: p.items, next: p.done ? null : 'more' }
  }, [key, filter, isEvm, chainId, address, evmAddress, btcAddress, rpcUrl, bridgeMatch])
  const list = usePaged<TimelineEntry>(key, fetchPage, (e) => e.id, { cache: 'activity' })
  const rows = useMemo(() => groupTimeline(list.items || []), [list.items])
  const pending = transfers.filter((b) => b.status === 'PENDING' && bridgeMatch(b))
  const refresh = () => { pollAllPending(); list.reload() }
  const unavailableNames = notice.unavailable.filter((id) => chainId === null || id === chainId).map((id) => chainName(id))
  return { list, rows, pending, notice, unavailableNames, refresh }
}

/** The web activity record's chain filter uses the same list */
export const ACTIVITY_FILTERS = FILTERS
export type ActivityFilter = Filter

export default function Activity() {
  const back = useBack('/')
  const [filter, setFilter] = usePageState<Filter>('activity.chain', 'all', oneOf(...FILTERS.map((f) => f.value)))
  const [moreOpen, setMoreOpen] = useState(false)
  const { list, rows, pending, notice, unavailableNames, refresh } = useActivityTimeline(filter)
  const pick = (f: Filter) => { setFilter(f); setMoreOpen(false) }
  const visible = ALWAYS.some((c) => c.value === filter) ? ALWAYS : [...ALWAYS.slice(0, 3), FILTERS.find((c) => c.value === filter)!]

  return (
    <div className="safe-top">
      <header className="flex items-center justify-between px-4 pt-4">
        <div className="flex items-center gap-2"><button onClick={back} className="-ml-2 rounded-full p-2 text-muted" aria-label={t('返回')}><ArrowLeft size={22} /></button><h1 className="text-2xl font-bold">{t('活动')}</h1></div>
        <button onClick={refresh} className="rounded-full p-2 text-muted" aria-label={t('刷新')}><RefreshCw size={18} /></button>
      </header>

      <div className="page-gutter flex flex-wrap gap-2 py-2.5" role="group" aria-label={t('按链筛选')}>
        {visible.map((c) => (
          <button key={c.value} onClick={() => pick(c.value)} aria-pressed={filter === c.value}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${filter === c.value ? 'bg-accent text-bg' : 'glass-lite text-muted'}`}>{t(c.label)}</button>
        ))}
        <button onClick={() => setMoreOpen(true)} aria-haspopup="dialog"
          className="glass-lite inline-flex shrink-0 items-center gap-1 rounded-full py-1.5 pl-3.5 pr-2.5 text-[13px] font-semibold text-muted">{t('更多')}<ChevronDown size={14} aria-hidden="true" /></button>
      </div>

      {pending.length > 0 && (
        <section className="mt-1" aria-label={t('进行中')}>
          {pending.map((b) => (
            <a key={b.txHash} href={chainById(b.fromChain)?.explorerTx(b.txHash)} target="_blank" rel="noreferrer" className="glass-lite mx-4 mb-2 block rounded-[18px] px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold">{t(b.fromChain === b.toChain ? '兑换 {from} → {to}' : '跨链 {from} → {to}', { from: b.fromSymbol, to: b.toSymbol })}</span>
                <StatusPill status={b.status} />
              </div>
              <div className="mt-0.5 flex items-center justify-between text-xs text-muted">
                <span className="truncate">{fmtAmount(b.fromAmount)} {b.fromSymbol} · {chainName(b.fromChain)}{b.fromChain !== b.toChain ? ` → ${chainName(b.toChain)}` : ''}</span>
                <span className="shrink-0">{timeAgo(b.createdAt)}</span>
              </div>
            </a>
          ))}
        </section>
      )}

      {(notice.failed.length > 0 || unavailableNames.length > 0) && list.items && (
        <div className="page-gutter py-1 text-xs text-muted">
          {notice.failed.length > 0 && <button onClick={refresh} className="flex min-h-9 items-center gap-1.5 text-accent"><RefreshCw size={13} />{t('部分记录读取失败，点击重试')}</button>}
          {unavailableNames.length > 0 && <p className="py-1">{t('{chains} 的记录暂时查不到', { chains: unavailableNames.join('、') })}</p>}
        </div>
      )}

      <section aria-label={t('交易记录')} aria-busy={list.loading}>
        {list.items === null && list.loading && <div className="flex items-center justify-center gap-1.5 py-16 text-sm text-muted" role="status"><RefreshCw size={14} className="animate-spin" />{t('正在读取中')}</div>}
        {list.failed && !list.items?.length && <button onClick={list.retry} className="flex w-full items-center justify-center gap-1.5 py-16 text-sm text-accent"><RefreshCw size={14} />{t('读取失败，点击重试')}</button>}
        {rows.map((r) => <Row key={r.key} row={r} />)}
        {list.items && !rows.length && !list.loading && !list.failed && list.done && !pending.length && <EmptyState icon={Clock} title={t('还没有交易记录')} />}
        {list.items && <LoadMore onMore={list.loadMore} loading={list.loading} done={list.done} failed={list.moreFailed} onRetry={list.retry} count={list.items.length} />}
      </section>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title={t('更多链')} center>
        <div className="grid grid-cols-2 gap-2 pb-2">
          {MORE.map((c) => {
            const info = c.chainId ? chainById(c.chainId) : undefined
            const on = filter === c.value
            return (
              <button key={c.value} onClick={() => pick(c.value)} aria-pressed={on}
                className={`flex min-h-12 items-center gap-2.5 rounded-lg px-3 text-left text-sm font-semibold ${on ? 'bg-accent text-bg' : 'glass-lite shadow-none'}`}>
                {info && <img src={info.logo} alt="" className="h-6 w-6 shrink-0 rounded-full" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />}
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {on && <Check size={16} aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      </Sheet>
    </div>
  )
}

/** Address shortening: EVM first 5 + last 3, Bitcoin first 6 + last 4, Solana first 4 + last 4 */
function shortOf(chainId: number, addr: string) {
  if (chainId === BTC_CHAIN_ID) return shortBtc(addr)
  if (chainId === SOLANA_CHAIN_ID) return shortAddr(addr)
  return shortId(addr)
}
const amt = (s: string) => fmtAmount(Number(s))

export function titleOf(r: TimelineRow): string {
  const more = r.more > 0 ? ` ${t('等 {n} 项', { n: r.more + 1 })}` : ''
  switch (r.kind) {
    case 'receive': return t('收到 {amount} {symbol}', { amount: amt(r.in!.amount), symbol: r.in!.symbol }) + more
    case 'send': return t('发送 {amount} {symbol}', { amount: amt(r.out!.amount), symbol: r.out!.symbol }) + more
    case 'self': return t('转给自己 {amount} {symbol}', { amount: amt(r.out!.amount), symbol: r.out!.symbol })
    case 'swap': return r.bridge ? t('兑换 {from} → {to}', { from: r.bridge.fromSymbol, to: r.bridge.toSymbol }) : t('兑换 {from} → {to}', { from: r.out!.symbol, to: r.in!.symbol })
    case 'bridge': return t('跨链 {from} → {to}', { from: r.bridge!.fromSymbol, to: r.bridge!.toSymbol })
    default: return r.chainId === SOLANA_CHAIN_ID ? t('Solana 交易') : t('链上交易')
  }
}

export function subtitleOf(r: TimelineRow): string {
  if (r.bridge) {
    const b = r.bridge
    return `${fmtAmount(b.fromAmount)} ${b.fromSymbol} → ${b.toAmount ? `${fmtAmount(b.toAmount)} ` : ''}${b.toSymbol}${b.fromChain !== b.toChain ? ` · ${chainName(b.fromChain)} → ${chainName(b.toChain)}` : ''}`
  }
  if (r.kind === 'swap') return `${amt(r.out!.amount)} ${r.out!.symbol} → ${amt(r.in!.amount)} ${r.in!.symbol}`
  if (r.counterparty) return r.kind === 'receive' ? t('来自 {addr}', { addr: shortOf(r.chainId, r.counterparty) }) : t('发往 {addr}', { addr: shortOf(r.chainId, r.counterparty) })
  return shortAddr(r.hash, 6)
}

function Row({ row: r }: { row: TimelineRow }) {
  const chain = chainById(r.chainId)
  const Icon = r.status === 'failed' ? XCircle : r.kind === 'receive' ? ArrowDownLeft : r.kind === 'send' ? ArrowUpRight : r.kind === 'swap' || r.kind === 'bridge' ? ArrowLeftRight : Repeat
  const tone = r.status === 'failed' ? 'text-down' : r.kind === 'receive' ? 'text-up' : r.kind === 'send' ? 'text-fg' : 'text-accent'
  return (
    <a href={chain?.explorerTx(r.hash)} target="_blank" rel="noreferrer" className="list-row page-gutter !min-h-0 !py-3">
      <span className="relative shrink-0">
        <span className={`flex h-10 w-10 items-center justify-center rounded-full bg-card2 ${tone}`}><Icon size={20} /></span>
        {chain && <img src={chain.logo} alt="" className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full ring-2 ring-bg" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{titleOf(r)}</span>
        <span className="mt-0.5 block truncate text-xs text-muted">{subtitleOf(r)}</span>
      </span>
      <span className="shrink-0 text-right text-xs text-muted">
        <span className="block">{r.status === 'pending' && !r.bridge ? t('待确认') : timeAgo(r.time)}</span>
        {r.status === 'failed' && <span className="mt-0.5 block text-down">{t('失败')}</span>}
        {r.bridge && r.status !== 'failed' && <span className="mt-0.5 block"><StatusPill status={r.bridge.status} /></span>}
      </span>
    </a>
  )
}
