// Discover page: real market data, watchlist and search share the stable token row.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, Plus, RefreshCw, Search, Star, WifiOff, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import TokenRow from '@/components/TokenRow'
import { prefetchTokenChart } from '@/lib/candlePrefetch'
import Avatar from '@/components/Avatar'
import FollowButton from '@/components/FollowButton'
import AddTokenSheet from '@/components/AddTokenSheet'
import Sheet from '@/components/Sheet'
import BestTrades from '@/components/BestTrades'
import Button from '@/components/Button'
import { api } from '@/lib/social'
import { fmtUsd } from '@/lib/format'
import { displayName } from '@/store/social'
import { useMarket } from '@/store/market'
import { useFavorites } from '@/store/favorites'
import type { MarketToken } from '@/lib/types'
import { getTokens, marketKey, searchTokensGrouped } from '@/lib/market'
import { EMPTY_FEED, feedFailed, feedLoading, filterChain, listState, type FeedKind, type ListState } from '@/lib/marketFeed'
import { poolsFeedName, useDiscoverFeed } from '@/store/discoverFeed'
import { MARKET_MORE, MARKET_PRIMARY, chainByDexKey } from '@/lib/chains'
import { t } from '@/lib/i18n'
import UserName from '@/components/UserName'
import { isString, oneOf, posInt, usePageState } from '@/lib/pageState'
import LegalFooter from '@/components/LegalFooter'
import { WEB_SURFACE } from '@/lib/surface'

type Sort = 'volume' | 'gainers' | 'new' | 'mcap'
type View = 'market' | 'favorites' | 'hot' | 'new' | 'stocks'
/** List page size: show this many first, bottom "load more" adds this many each time */
const PAGE = 20

/** Chain filter (shared by market / hot / new): values are DexScreener chain ids, all = all. Order set by goat (2026-09-25, BSC first),
 *  remaining directly-tradable chains tucked in the "More" sheet; the list lives in chains.ts MARKET_PRIMARY / MARKET_MORE */
const CHAIN_FILTERS: { value: string; label: string }[] = [{ value: 'all', label: '全部' }, ...MARKET_PRIMARY.map((c) => ({ value: c.dexKey, label: c.label }))]
const MORE_KEYS = new Set(MARKET_MORE.map((c) => c.dexKey))
const moreLabel = (key: string) => MARKET_MORE.find((c) => c.dexKey === key)?.label ?? key
/** Two lists merged: same chain + same coin keeps only the first occurrence */
const mergeUniq = (a: MarketToken[], b: MarketToken[]) => {
  const seen = new Set(a.map((x) => marketKey(x.chain, x.address)))
  return [...a, ...b.filter((x) => !seen.has(marketKey(x.chain, x.address)))]
}

interface Trader { address: string; nickname: string | null; avatar: string | null; handle: string | null; followers: number; pnl: number }

export default function Discover() {
  const { refreshTrending, cache, put } = useMarket()
  const favorites = useFavorites((s) => s.items)
  // View / sort / search term / chain filter / shown count all kept in session (lib/pageState): opening a coin detail and coming back restores how it was left
  const [view, setView] = usePageState<View>('discover.view', () => (favorites.length ? 'favorites' : 'market'), oneOf('market', 'favorites', 'hot', 'new', 'stocks'))
  const [sort, setSort] = usePageState<Sort>('discover.sort', 'volume', oneOf('volume', 'gainers', 'new', 'mcap'))
  const [q, setQ] = usePageState('discover.q', '', isString)
  const query = q.trim()
  const [results, setResults] = useState<MarketToken[] | null>(null)
  const [traders, setTraders] = useState<Trader[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [traderError, setTraderError] = useState(false)
  const [favoritesError, setFavoritesError] = useState(false)
  const [favoritesLoading, setFavoritesLoading] = useState(false)
  const [retry, setRetry] = useState(0)
  const [adding, setAdding] = useState(false)

  // Market / Hot / New / Stocks (changed 2026-09-26): data lives in store/discoverFeed, memory + local snapshot.
  // Entering Discover fetches the current view first, the other lists shortly after; switching views/chains afterwards is local filtering — no more waiting on the network.
  const feeds = useDiscoverFeed((s) => s.feeds)
  const loadFeed = useDiscoverFeed((s) => s.load)
  const loadPools = useDiscoverFeed((s) => s.loadPools)
  const feedView: FeedKind | null = view === 'market' || view === 'hot' || view === 'new' || view === 'stocks' ? view : null
  useEffect(() => {
    if (!feedView || query) return
    void loadFeed(feedView)
    if (feedView === 'market') void refreshTrending() // Home etc. still use the SOL price in the store — refresh it while we're at it
    // Check every 5s; isFresh decides whether to actually request: normally every 30s, every 4s while the server says some chain's first round isn't done yet
    const timer = setInterval(() => void loadFeed(feedView), 5_000)
    return () => clearInterval(timer)
  }, [feedView, query, loadFeed, refreshTrending])
  useEffect(() => {
    // Prefetch: pull market / hot / new all (market and hot share the server's same hot pool, costing only a few extra DexScreener requests)
    const timer = setTimeout(() => { for (const k of ['market', 'hot', 'new'] as const) void loadFeed(k) }, 600)
    return () => clearTimeout(timer)
  }, [loadFeed])
  // Pagination: view / sort / search change resets to page one
  const [chainFilter, setChainFilter] = usePageState('discover.chain', 'all', isString)
  // Chains picked in "More": a temporary extra capsule on the filter bar, data pulled on demand by the server (primary filter chains are resident, no separate pull needed)
  const [moreOpen, setMoreOpen] = useState(false)
  const pickMore = (key: string) => { setChainFilter(key); setMoreOpen(false) }
  const ALWAYS = CHAIN_FILTERS.slice(0, 4) // All · BSC · Solana · Base
  const visibleChips = ALWAYS.some((c) => c.value === chainFilter)
    ? ALWAYS
    : [...ALWAYS.slice(0, 3), { value: chainFilter, label: CHAIN_FILTERS.find((c) => c.value === chainFilter)?.label ?? moreLabel(chainFilter) }]
  const isMore = MORE_KEYS.has(chainFilter)
  const poolKind = view === 'new' ? 'new' : 'trending'
  const poolView = !query && (view === 'market' || view === 'hot' || view === 'new')
  useEffect(() => {
    if (!isMore || !poolView) return
    void loadPools(poolKind, chainFilter)
    const timer = setInterval(() => void loadPools(poolKind, chainFilter), 15_000)   // The server caches for 60s — no real request for pulls within 60s
    return () => clearInterval(timer)
  }, [isMore, poolView, poolKind, chainFilter, loadPools])
  const pools = isMore && poolView ? (feeds[poolsFeedName(poolKind, chainFilter)] ?? EMPTY_FEED) : null
  /** Filter by chain (returns a new array, safe to sort afterwards); chains from "More" additionally merge their own list */
  const byChain = (l: MarketToken[]) => {
    const own = filterChain(l, chainFilter)
    return pools ? mergeUniq(own, pools.list) : [...own]
  }
  const [shown, setShown] = usePageState('discover.shown', PAGE, posInt())
  // View / sort / search / chain change resets to page one. The mount pass doesn't count (that value is restored from back-navigation — must not clear the "load more" count)
  const filterSig = `${view}|${sort}|${query}|${chainFilter}`
  const lastSig = useRef(filterSig)
  useEffect(() => { if (lastSig.current !== filterSig) { lastSig.current = filterSig; setShown(PAGE) } }, [filterSig, setShown])

  useEffect(() => {
    if (view !== 'favorites' || query || !favorites.length) {
      setFavoritesLoading(false)
      setFavoritesError(false)
      return
    }
    let alive = true
    const load = async () => {
      setFavoritesLoading(true)
      const byChain = new Map<string, string[]>()
      favorites.forEach((f) => byChain.set(f.chain, [...(byChain.get(f.chain) || []), f.address]))
      // Request results recorded independently — one chain failing won't overwrite quotes already obtained for other chains.
      const requests = await Promise.allSettled([...byChain].map(([chain, addresses]) => getTokens(addresses, chain)))
      if (!alive) return
      requests.forEach((r) => { if (r.status === 'fulfilled') put(r.value) })
      setFavoritesError(requests.some((r) => r.status === 'rejected'))
      setFavoritesLoading(false)
    }
    load()
    const timer = setInterval(load, 20_000)
    return () => { alive = false; clearInterval(timer) }
  }, [view, query, favorites, retry, put])

  useEffect(() => {
    setResults(null); setTraders([]); setSearchError(false); setTraderError(false)
    setSearching(!!query)
    if (!query) return
    let alive = true
    const timer = setTimeout(() => {
      // Uses the existing throwing API to distinguish no-results from request failure; old queries must not write back new results.
      searchTokensGrouped(query).then((r) => {
        if (!alive) return
        // Official pinned, impostors hidden (rules in lib/market.ts rankSearch, 2026-09-30)
        put(r.tokens); setResults(r.tokens)
      }).catch(() => { if (alive) setSearchError(true) }).finally(() => { if (alive) setSearching(false) })
      api<Trader[]>(`/api/users/search?q=${encodeURIComponent(query)}`).then((users) => {
        if (alive) setTraders(users)
      }).catch(() => { if (alive) setTraderError(true) })
    }, 250)
    return () => { alive = false; clearTimeout(timer) }
  }, [query, retry, put])

  const feed = feedView ? (feeds[feedView] ?? EMPTY_FEED) : EMPTY_FEED
  const list = useMemo(() => {
    if (view !== 'market') return []
    const tokens = byChain(feed.list)
    switch (sort) {
      case 'gainers': return tokens.sort((a, b) => (b.change24h ?? -Infinity) - (a.change24h ?? -Infinity))
      case 'new': return tokens.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      case 'mcap': return tokens.sort((a, b) => (b.marketCap ?? b.fdv ?? 0) - (a.marketCap ?? a.fdv ?? 0))
      default: return pools ? tokens.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0)) : tokens   // Merged chain lists get re-sorted by volume
    }
  }, [view, feed, sort, chainFilter, pools]) // eslint-disable-line react-hooks/exhaustive-deps
  // Hot / New lists after chain filtering; when merging "More" chains' lists, re-sort by each one's own rule (hot by 1h change, new by listing time). Stocks aren't chain-filtered
  const extraList = useMemo(() => {
    if (view === 'market' || !feedView) return []
    if (view === 'stocks') return feed.list
    const tokens = byChain(feed.list)
    if (!pools) return tokens
    return view === 'new' ? tokens.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)) : tokens.sort((a, b) => Math.abs(b.change1h ?? 0) - Math.abs(a.change1h ?? 0))
  }, [view, feedView, feed, chainFilter, pools]) // eslint-disable-line react-hooks/exhaustive-deps
  const shownList = view === 'market' ? list : extraList
  // Pausing on the list for a bit (1.2s) prefetches candles for the top 3 coins: most people tap those, and they'll already be in hand when opened.
  // Scrolling the list, switching chains or sort cancels a round that hasn't started; quota is managed in candles.ts — never crowds out requests the user opened themselves
  const topKeys = shownList.slice(0, 3).map((tk) => marketKey(tk.chain, tk.address)).join(',')
  useEffect(() => {
    if (!topKeys) return
    const top = shownList.slice(0, 3)
    const timer = setTimeout(() => { for (const tk of top) prefetchTokenChart(tk) }, 1200)
    return () => clearTimeout(timer)
  }, [topKeys]) // eslint-disable-line react-hooks/exhaustive-deps
  // List area states: show the list when there's data; without data "loading" → "load failed, tap to retry" → "no market data"
  const filterKey = view === 'stocks' ? 'all' : chainFilter
  const stateLoading = pools ? feedLoading(pools, 'all') : feedLoading(feed, filterKey)
  const stateError = pools ? pools.error : feedFailed(feed, filterKey)
  const state = listState({ count: shownList.length, loading: stateLoading, error: stateError })
  const retryLoad = () => {
    setRetry((value) => value + 1)
    if (feedView && !query) void loadFeed(feedView, true)
    if (pools) void loadPools(poolKind, chainFilter, true)
  }
  const busy = query ? searching : view === 'favorites' ? favoritesLoading : state === 'loading'
  /** List present but this refresh failed: small top banner, list shown as usual */
  const refreshNotice = state === 'list' && (pools?.error
    ? <LoadError text={t('{chain} 的榜单暂时拿不到', { chain: moreLabel(chainFilter) })} onRetry={retryLoad} compact />
    : feed.error ? <LoadError text={t('刷新失败，显示上次行情')} onRetry={retryLoad} compact /> : null)

  return (
    <div className="safe-top">
      <header className="bar-glass sticky top-0 z-30">
        <div className="page-header page-gutter">
          <h1 className="page-title">{t('发现')}</h1>
          <div className="flex">
            <button onClick={retryLoad} disabled={busy} className="icon-button" aria-label={t('刷新行情')} data-tooltip={t('刷新行情')}><RefreshCw size={18} className={busy ? 'animate-spin' : ''} /></button>
            <button onClick={() => setAdding(true)} className="icon-button text-fg" aria-label={t('添加代币')} data-tooltip={t('添加代币')}><Plus size={22} /></button>
          </div>
        </div>
        <div className="page-gutter pb-2">
          <div className="relative">
            <Search size={18} className="pointer-events-none absolute left-3.5 top-4 text-muted" aria-hidden="true" />
            <input aria-label={t('搜索代币或交易者')} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('搜索代币、地址或交易者')} autoComplete="off" spellCheck={false} className="h-12 w-full rounded-lg border border-line bg-card pl-10 pr-12 text-base placeholder:text-muted" />
            {q && <button onClick={() => setQ('')} className="icon-button absolute right-0.5 top-0.5" aria-label={t('清除搜索')} data-tooltip={t('清除搜索')}><X size={18} /></button>}
          </div>
        </div>
        {!query && <div className="page-gutter no-scrollbar flex gap-5 overflow-x-auto border-b border-line" role="group" aria-label={t('行情视图')}>
          <button className="view-tab shrink-0" aria-pressed={view === 'favorites'} onClick={() => setView('favorites')}>{t('自选')}{favorites.length > 0 && <span className="number ml-1.5 text-xs text-muted">{favorites.length}</span>}</button>
          <button className="view-tab shrink-0" aria-pressed={view === 'market'} onClick={() => setView('market')}>{t('市场')}</button>
          <button className="view-tab shrink-0" aria-pressed={view === 'hot'} onClick={() => setView('hot')}>{t('火热')}</button>
          <button className="view-tab shrink-0" aria-pressed={view === 'new'} onClick={() => setView('new')}>{t('最新')}</button>
          <button className="view-tab shrink-0" aria-pressed={view === 'stocks'} onClick={() => setView('stocks')}>{t('股票')}</button>
        </div>}
        {!query && (view === 'market' || view === 'hot' || view === 'new') && (
          // Fits in one row, no horizontal swipe (2026-09-25 goat): All + BSC / Solana / Base resident; picking another chain takes the last slot, the rest live in "More"
          <div className="page-gutter flex flex-wrap gap-2 py-2.5" role="group" aria-label={t('按链筛选')}>
            {visibleChips.map((c) => (
              <button key={c.value} onClick={() => setChainFilter(c.value)} aria-pressed={chainFilter === c.value}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${chainFilter === c.value ? 'bg-accent text-bg' : 'glass-lite text-muted'}`}>{t(c.label)}</button>
            ))}
            <button onClick={() => setMoreOpen(true)} aria-haspopup="dialog"
              className="glass-lite inline-flex shrink-0 items-center gap-1 rounded-full py-1.5 pl-3.5 pr-2.5 text-[13px] font-semibold text-muted">{t('更多')}<ChevronDown size={14} aria-hidden="true" /></button>
          </div>
        )}
      </header>

      {query ? (
        <section aria-label={t('搜索结果')} aria-busy={searching}>
          {traders.length > 0 && <div className="page-gutter pt-4">
            <h2 className="section-title mb-2">{t('交易者')}</h2>
            {traders.map((u) => <div key={u.address} className="list-row">
              <Link to={`/u/${u.address}`} className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar address={u.address} src={u.avatar} name={u.nickname} size={44} />
                <span className="min-w-0"><UserName address={u.address} name={displayName(u)} className="block truncate text-sm font-semibold" /><span className="mt-1 block text-xs text-muted">{t('{n} 关注者', { n: u.followers })} · <span className={u.pnl >= 0 ? 'text-up' : 'text-down'}>{u.pnl >= 0 ? '+' : '-'}{fmtUsd(Math.abs(u.pnl), { compact: true })}</span></span></span>
              </Link>
              <FollowButton address={u.address} size="sm" />
            </div>)}
          </div>}
          <div className="section-header page-gutter"><h2 className="section-title">{t('代币')}</h2>{searching && <span className="text-[13px] text-muted" role="status">{t('搜索中')}</span>}</div>
          {searching && <LoadingRows />}
          {searchError && <LoadError text={t('暂时无法搜索代币')} onRetry={retryLoad} />}
          {!searching && !searchError && results?.map((t) => <TokenRow key={marketKey(t.chain, t.address)} token={t} />)}
          {!searching && !searchError && results?.length === 0 && <div className="empty-state page-gutter"><Search size={28} strokeWidth={1.5} /><p className="text-sm text-muted">{t('没有找到相关代币')}</p><Button size="sm" variant="secondary" className="mt-4" onClick={() => setAdding(true)}><Plus size={16} />{t('添加代币')}</Button></div>}
          {traderError && <div className="page-gutter flex items-center justify-between gap-3 py-3 text-[13px] text-muted"><span>{t('交易者搜索暂不可用')}</span><button className="text-action" onClick={retryLoad}>{t('重试')}</button></div>}
        </section>
      ) : view === 'favorites' ? (
        <section aria-label={t('自选代币')} aria-busy={favoritesLoading}>
          <div className="section-header page-gutter text-xs text-muted"><span>{t('代币 / 网络')}</span><span>{t('价格 / 24h')}</span></div>
          {favoritesError && <LoadError text={t('部分自选未能更新，价格可能已过期')} onRetry={retryLoad} compact />}
          {favorites.map((f) => <TokenRow key={marketKey(f.chain, f.address)} token={{ ...(cache[marketKey(f.chain, f.address)] || f), symbol: f.symbol }} />)}
          {!favorites.length && <div className="empty-state page-gutter"><Star size={28} strokeWidth={1.5} /><p className="text-sm text-muted">{t('暂无自选代币')}</p><Button variant="secondary" size="sm" className="mt-4" onClick={() => setAdding(true)}><Plus size={16} />{t('添加代币')}</Button></div>}
        </section>
      ) : view !== 'market' ? (
        <section aria-label={view === 'hot' ? t('火热代币') : view === 'new' ? t('最新代币') : t('股票代币')} aria-busy={state === 'loading'}>
          <div className="section-header page-gutter"><span className="text-[13px] text-muted">{view === 'hot' ? t('正在被推上热榜的币（推广热度，不代表质量）') : view === 'new' ? t('最近上线、流动性 ≥ $5k 的新币') : t('代币化美股 / ETF（xStocks）')}</span></div>
          {refreshNotice}
          <ListStatus state={state} onRetry={retryLoad} />
          {extraList.slice(0, shown).map((tk, i) => <TokenRow key={marketKey(tk.chain, tk.address)} token={tk} rank={i + 1} metric={view === 'new' ? 'marketCap' : 'volume'} />)}
          <LoadMore total={extraList.length} shown={shown} onMore={() => setShown((n) => n + PAGE)} />
        </section>
      ) : (
        <section aria-label={t('市场行情')} aria-busy={state === 'loading'}>
          <div className="section-header page-gutter">
            <span className="text-[13px] text-muted">{t('多链热门')}</span>
            <div className="relative">
              <select aria-label={t('行情排序')} value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="min-h-11 appearance-none bg-transparent py-2 pl-3 pr-7 text-[13px] text-fg">
                <option value="volume">{t('成交额')}</option><option value="gainers">{t('涨幅')}</option><option value="new">{t('最新上线')}</option><option value="mcap">{t('市值')}</option>
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-1 top-4 text-muted" />
            </div>
          </div>
          {refreshNotice}
          <ListStatus state={state} onRetry={retryLoad} />
          {list.slice(0, shown).map((tk, i) => <TokenRow key={marketKey(tk.chain, tk.address)} token={tk} rank={i + 1} metric={sort === 'volume' ? 'volume' : 'marketCap'} />)}
          <LoadMore total={list.length} shown={shown} onMore={() => setShown((n) => n + PAGE)} />
          <BestTrades />
        </section>
      )}

      <AddTokenSheet open={adding} onClose={() => setAdding(false)} />
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title={t('更多链')} center>
        <p className="mb-3 text-[13px] text-muted">{t('这些链都能在 App 里直接买卖')}</p>
        {/* Buttons skip the glass-lite heavy blur shadow: dozens of blur shadows made the sheet's first on-screen frame render very slowly (2026-09-26 simulator test) */}
        <div className="grid grid-cols-2 gap-2 pb-2">
          {[...MARKET_PRIMARY.slice(3), ...MARKET_MORE].map((c) => {
            const info = chainByDexKey(c.dexKey)
            const on = chainFilter === c.dexKey
            return (
              <button key={c.dexKey} onClick={() => pickMore(c.dexKey)} aria-pressed={on}
                className={`flex min-h-12 items-center gap-2.5 rounded-lg px-3 text-left text-sm font-semibold ${on ? 'bg-accent text-bg' : 'glass-lite shadow-none'}`}>
                {info && <img src={info.logo} alt="" className="h-6 w-6 shrink-0 rounded-full" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />}
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {on && <Check size={16} aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      </Sheet>
      {/* Web opened in a phone browser: bottom status bar hidden, legal docs and download center sit at the bottom of the market page (2026-10-04 walkthrough). In the mobile app they're under "Me → About" */}
      {WEB_SURFACE && <LegalFooter className="page-gutter mt-6 mb-2" />}
    </div>
  )
}

/** Bottom "load more (N remaining)"; disappears once everything is shown */
function LoadMore({ total, shown, onMore }: { total: number; shown: number; onMore: () => void }) {
  if (total <= shown) return null
  return <div className="page-gutter pt-3 pb-2"><button onClick={onMore} className="glass-lite h-11 w-full rounded-full text-sm font-semibold">{t('加载更多（还有 {n} 个）', { n: total - shown })}</button></div>
}

/** What shows when a list has no data: loading (spinner + skeleton) / load failed, tap to retry / no market data; nothing shown when there's data */
function ListStatus({ state, onRetry }: { state: ListState; onRetry: () => void }) {
  if (state === 'loading') return (
    <div role="status">
      <div className="flex items-center justify-center gap-2 pt-4 text-[13px] text-muted"><Loader2 size={16} className="animate-spin" aria-hidden="true" />{t('正在读取中')}</div>
      <LoadingRows />
    </div>
  )
  if (state === 'error') return (
    <button type="button" onClick={onRetry} className="empty-state page-gutter w-full" role="status">
      <WifiOff size={28} strokeWidth={1.5} /><p className="text-sm text-muted">{t('读取失败，点击重试')}</p>
    </button>
  )
  if (state === 'empty') return <div className="empty-state text-sm text-muted">{t('暂无行情')}</div>
  return null
}

function LoadingRows() {
  return <div className="page-gutter space-y-3 py-3" aria-label={t('正在加载行情')}>{[1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-16" />)}</div>
}

function LoadError({ text, onRetry, compact = false }: { text: string; onRetry: () => void; compact?: boolean }) {
  return <div className={`page-gutter ${compact ? 'status-notice' : 'empty-state'}`} role="status"><WifiOff size={compact ? 17 : 28} className="shrink-0" strokeWidth={1.5} /><p className={compact ? 'flex-1' : 'text-sm text-muted'}>{text}</p><Button size="sm" variant="ghost" className={compact ? '' : 'mt-2'} onClick={onRetry}>{t('重试')}</Button></div>
}
