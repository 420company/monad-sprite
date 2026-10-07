// Web "Markets" (2026-09-29 goat 3rd round: "can't say what's wrong, just feels really off" — the previous version drew a sparse-data coin's chart in one big card + hot list on the right + card grid below).
// Modeled on the Polymarket homepage + GMGN / Zora lists, dropping the big chart:
//   2026-09-30 goat: the top three list cards (hot / gainers / new) duplicated the table's tabs below — removed, leaving only the full-width token table:
//   full-width token table — sort tabs (hot / gainers / volume / new / stocks / watchlist) + chain filter + search; columns # · token · price · 1h · 24h · volume · liquidity · mcap · spark · trade,
//       sticky header, numeric columns right-aligned, clickable headers to sort, 50 per page appending downward
// Sparklines draw only real data, only where it's cheap: the top rows already cached in the server candle channel (desktop/trade/spark.tsx) — if unavailable, skip drawing and hide the whole column.
// All data from existing APIs (Discover's store/discoverFeed, watchlist store/favorites, search lib/market); API failures show empty states and retry, never fake data.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, ChevronRight, CloudOff, RefreshCw, Search, Star } from 'lucide-react'
import TokenLogo from '@/components/TokenLogo'
import { useDiscoverFeed } from '@/store/discoverFeed'
import { useFavorites } from '@/store/favorites'
import { useMarket } from '@/store/market'
import { getTokens, marketKey, searchTokensGrouped, type SearchResult } from '@/lib/market'
import { EMPTY_FEED } from '@/lib/marketFeed'
import { MARKET_PRIMARY, chainByDexKey, isStable } from '@/lib/chains'
import { prefetchDexCandles } from '@/lib/candles'
import { fmtPct, fmtUsd, timeAgo } from '@/lib/format'
import { oneOf, usePageState } from '@/lib/pageState'
import { t } from '@/lib/i18n'
import type { MarketToken } from '@/lib/types'
import { Spark, sparkKey, useSparks } from '../trade/spark'
import { TokenQuick } from './TokenTerminal'
import './trade.css'

type Tab = 'hot' | 'gain' | 'volume' | 'new' | 'stocks' | 'favorites'
type SortKey = 'price' | 'h1' | 'h24' | 'vol' | 'liq' | 'mcap'
const PAGE = 50
const tabLabel = (k: Tab) => ({ hot: t('热门'), gain: t('涨幅'), volume: t('成交额'), new: t('新币'), stocks: t('股票'), favorites: t('自选') })[k]
const chainLabel = (dexKey: string) => MARKET_PRIMARY.find((c) => c.dexKey === dexKey)?.label || chainByDexKey(dexKey)?.name || dexKey
const tokenPath = (x: MarketToken) => `/token/${x.chain}/${x.address}`
const pre = (x: MarketToken) => { if (x.pairAddress) prefetchDexCandles({ chain: x.chain, address: x.address, pairAddress: x.pairAddress, interval: '1h' }) }
const dir = (n?: number) => n == null ? 'mute' : n >= 0 ? 'up' : 'down'
/** List change figures: over 1000% drops decimals (+59,047% reads better than +59046.69% and doesn't crowd out the price) */
const pctShort = (n?: number) => n != null && Math.abs(n) >= 1000 ? `${n > 0 ? '+' : '-'}${Math.round(Math.abs(n)).toLocaleString('en-US')}%` : fmtPct(n)
/** Money stats: the data provider's 0 means "no such data" — show -- instead of $0.00 */
const big = (n?: number) => (n && n > 0 ? fmtUsd(n, { compact: true }) : '--')
/** Gainers list only takes deep pools: liquidity and 24h volume both ≥ $50k, so a few-hundred-dollar pool can't print a thousand-x and dominate */
const deep = (x: MarketToken) => (x.liquidityUsd || 0) >= 50_000 && (x.volume24h || 0) >= 50_000 && !isStable(x.symbol)
const sortVal: Record<SortKey, (x: MarketToken) => number | undefined> = {
  price: (x) => x.priceUsd, h1: (x) => x.change1h, h24: (x) => x.change24h, vol: (x) => x.volume24h, liq: (x) => x.liquidityUsd, mcap: (x) => x.marketCap || x.fdv,
}

/** How long since listing: minutes / hours / days */
function age(ts?: number): string {
  if (!ts) return '--'
  const m = Math.max(0, Math.floor((Date.now() - ts) / 60000))
  if (m < 60) return t('{n} 分钟', { n: m })
  const h = Math.floor(m / 60)
  return h < 48 ? t('{n} 小时', { n: h }) : t('{n} 天', { n: Math.floor(h / 24) })
}

export default function Markets() {
  const { feeds, load } = useDiscoverFeed()
  const favorites = useFavorites((s) => s.items)
  const { cache, put } = useMarket()
  // Clicking a coin: pop the trade window over the market page (2026-10-05 goat) — no more jumping to the spot page
  const [quick, setQuick] = useState<{ chain: string; address: string } | null>(null)
  const [tab, setTab] = usePageState<Tab>('desk.markets.tab2', 'hot', oneOf('hot', 'gain', 'volume', 'new', 'stocks', 'favorites'))
  const [chain, setChain] = usePageState<string>('desk.markets.chain', 'all')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean } | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const [query, setQuery] = useState('')
  // Search results (2026-09-30: official pinned, impostors hidden — rules in lib/market.ts rankSearch)
  const [found, setFound] = useState<SearchResult | null>(null)
  const results = found?.tokens ?? null
  const [searching, setSearching] = useState(false)
  const [favState, setFavState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [favRetry, setFavRetry] = useState(0)
  const [, tick] = useState(0)
  const listRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Data for the hot / gainers / new tabs: fetched once on entry, refreshed every 20s (not while the page is in background)
  useEffect(() => {
    const all = (force: boolean) => { void load('market', force); void load('hot', force); void load('new', force) }
    all(false)
    const id = setInterval(() => { if (!document.hidden) all(true) }, 20_000)
    const clock = setInterval(() => tick((n) => n + 1), 10_000)
    return () => { clearInterval(id); clearInterval(clock) }
  }, [load])
  useEffect(() => { if (tab === 'stocks') void load('stocks') }, [tab, load])
  useEffect(() => { setLimit(PAGE) }, [tab, chain, query, sort])
  useEffect(() => { setSort(null) }, [tab])
  // Keyboard / focus search (no conflict with the shell ⌘K: only when no other input is focused)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.preventDefault(); searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Watchlist: latest quotes batched per chain, refreshed every 20s
  useEffect(() => {
    if (tab !== 'favorites' || !favorites.length) return
    let alive = true
    const run = async () => {
      setFavState((s) => s === 'idle' ? 'loading' : s)
      const byChain = new Map<string, string[]>()
      favorites.forEach((f) => byChain.set(f.chain, [...(byChain.get(f.chain) || []), f.address]))
      const rs = await Promise.allSettled([...byChain].map(([c, a]) => getTokens(a, c)))
      if (!alive) return
      rs.forEach((r) => { if (r.status === 'fulfilled') put(r.value) })
      setFavState(rs.some((r) => r.status === 'rejected') ? 'error' : 'idle')
    }
    void run()
    const id = setInterval(() => { if (!document.hidden) void run() }, 20_000)
    return () => { alive = false; clearInterval(id) }
  }, [tab, favorites, put, favRetry])

  // Search: name, symbol or contract address — query 350ms after the user stops typing
  useEffect(() => {
    const q = query.trim()
    if (!q) { setFound(null); setSearching(false); return }
    setSearching(true)
    let alive = true
    const id = setTimeout(() => {
      searchTokensGrouped(q).then((r) => { if (alive) { setFound(r); put(r.tokens) } }).catch(() => { if (alive) setFound({ tokens: [] }) }).finally(() => { if (alive) setSearching(false) })
    }, 350)
    return () => { alive = false; clearTimeout(id) }
  }, [query, put])

  const market = feeds.market ?? EMPTY_FEED
  const hot = feeds.hot ?? EMPTY_FEED
  const fresh = feeds.new ?? EMPTY_FEED
  const gainers = useMemo(() => {
    const seen = new Set<string>()
    return [...market.list, ...hot.list].filter((x) => { const k = marketKey(x.chain, x.address); if (seen.has(k) || !deep(x) || x.change24h == null) return false; seen.add(k); return true })
      .sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0))
  }, [market.list, hot.list])
  const newest = useMemo(() => [...fresh.list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)), [fresh.list])
  const byVolume = useMemo(() => [...market.list].filter((x) => !isStable(x.symbol)).sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0)), [market.list])
  // Watchlist: everything favorited is shown (2026-10-02 goat: after favoriting two new coins, 5 of the defaults "disappeared" while the count still said 7).
  // Previously only rows with quotes were shown — rows whose quotes failed to arrive vanished; now quote-less rows show "--" for price and get filled in on the next refresh.
  // Names use the favorited label (BTC, BNB), not the market feed's BTCB / WBNB — consistent with mobile.
  const favList = useMemo(() => favorites.map((f): MarketToken => {
    const q = cache[marketKey(f.chain, f.address)]
    return q ? { ...q, symbol: f.symbol } : { chain: f.chain, chainId: f.chainId, address: f.address, symbol: f.symbol, name: f.name, logo: f.logo || '', priceUsd: undefined as unknown as number }
  }), [favorites, cache])

  const feedOf = (k: Tab) => k === 'hot' ? hot : k === 'gain' || k === 'volume' ? market : k === 'new' ? fresh : k === 'stocks' ? (feeds.stocks ?? EMPTY_FEED) : null
  const feed = feedOf(tab)
  const base = results ?? (tab === 'hot' ? hot.list : tab === 'gain' ? gainers : tab === 'volume' ? byVolume : tab === 'new' ? newest : tab === 'stocks' ? (feeds.stocks ?? EMPTY_FEED).list : favList)
  const filtered = useMemo(() => (chain === 'all' || results || tab === 'stocks' ? base : base.filter((x) => x.chain === chain)), [base, chain, results, tab])
  const list = useMemo(() => {
    if (!sort) return filtered
    const f = sortVal[sort.key]
    return [...filtered].sort((a, b) => {
      const va = f(a), vb = f(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      return sort.desc ? vb - va : va - vb
    })
  }, [filtered, sort])
  // "Loading / load failed" only shows when no quotes have arrived at all; partial quotes display immediately, missing rows show "--"
  const favQuoted = favorites.some((f) => cache[marketKey(f.chain, f.address)])
  const loading = results ? searching : tab === 'favorites' ? favState === 'loading' && !favQuoted : !!feed && !feed.at && !feed.list.length && (feed.loading || !feed.error)
  const failed = !results && (tab === 'favorites' ? favState === 'error' && !favQuoted : !!feed?.error && !feed.list.length)
  const retry = () => {
    if (tab === 'favorites') { setFavState('loading'); setFavRetry((v) => v + 1); return }
    void load(tab === 'gain' || tab === 'volume' ? 'market' : tab, true)
  }
  const shown = list.slice(0, limit)

  // Sparklines: only asked for the table's first 12 rows (server checks cache only); if none arrive, the whole column hides
  const sparkWant = useMemo(() => shown.slice(0, 12), [shown])
  const sparks = useSparks(sparkWant, 20)
  const tableSpark = shown.some((x) => sparks.has(sparkKey(x)))
  /** One table row (rank cell passed in: normal results write the rank, expanded-collapse rows write "·") */
  const mrow = (x: MarketToken, rank: string) => {
    const pts = sparks.get(sparkKey(x))
    return (
      <Link key={`${x.chain}:${x.address}`} to={tokenPath(x)} className="tx-mrow" onPointerEnter={() => pre(x)}
        onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); setQuick({ chain: x.chain, address: x.address }) }}>
        <span className="tx-mrank">{rank}</span>
        <span className="tx-mtoken"><TokenLogo src={x.logo} symbol={x.symbol} size={28} chain={x.chain} address={x.address} />
          <span className="tx-mtoken-t"><b>{x.symbol}{x.official && <i className="tx-tag is-official">{t('官方')}</i>}{x.impostor && <i className="tx-tag is-fake">{t('非官方')}</i>}{x.fresh && <i className="tx-tag is-new" title={t('这个币的交易池 3 天内刚创建，风险较高')}>{t('新创建')}</i>}</b><small>{chainByDexKey(x.chain)?.logo && <img src={chainByDexKey(x.chain)!.logo} alt="" />}<span>{chainLabel(x.chain)}{x.name && x.name !== x.symbol ? ` · ${x.name}` : ''}</span></small></span></span>
        <span className="r">{fmtUsd(x.priceUsd)}</span>
        <span className={`r ${dir(x.change1h)}`}>{pctShort(x.change1h)}</span>
        <span className={`r ${dir(x.change24h)}`}>{pctShort(x.change24h)}</span>
        <span className="r">{big(x.volume24h)}</span>
        <span className="r">{big(x.liquidityUsd)}</span>
        <span className="r">{tab === 'new' && !results ? age(x.createdAt) : big(x.marketCap || x.fdv)}</span>
        <span className="r">{pts ? <Spark pts={pts} width={80} height={26} /> : null}</span>
        <span className="tx-trade" aria-hidden="true">{t('交易||action')}</span>
      </Link>
    )
  }

  const sortBy = (key: SortKey) => setSort((s) => !s || s.key !== key ? { key, desc: true } : s.desc ? { key, desc: false } : null)
  const head = (key: SortKey, label: string) => (
    <button type="button" className={`r ${sort?.key === key ? 'on' : ''}`} onClick={() => sortBy(key)} aria-pressed={sort?.key === key} title={t('点一下按它排序，再点一下反过来')}>
      {label}{sort?.key === key && (sort.desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
    </button>
  )
  const updated = Math.max(market.at, hot.at)

  return (
    <div className="tx-mkt">
      <header className="tx-mkt-head">
        <div>
          <h1>{t('行情||web-nav')}</h1>
          <p>{t('各链去中心化交易所的实时成交')}</p>
        </div>
        {updated > 0 && <span className="tx-live"><i />{Date.now() - updated < 60_000 ? t('刚刚更新') : t('更新于 {t}', { t: timeAgo(updated) })}</span>}
      </header>

      <section ref={listRef} className="tx-panel tx-list" aria-labelledby="tx-list-title">
        <h2 id="tx-list-title" className="sr-only">{t('全部代币')}</h2>
        <div className="tx-list-bar">
          <div className="tx-tabs" role="tablist" aria-label={t('排序方式')}>
            {(['favorites', 'hot', 'gain', 'volume', 'new', 'stocks'] as Tab[]).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k && !results} className={`tx-tab ${tab === k && !results ? 'on' : ''}`} onClick={() => { setTab(k); setQuery('') }}>
                {k === 'favorites' && <Star size={13} aria-hidden="true" />}{tabLabel(k)}{k === 'favorites' && favorites.length > 0 && <small>{favorites.length}</small>}
              </button>))}
          </div>
          <div className="tx-list-tools">
            <label className="tx-search">
              <Search size={15} aria-hidden="true" />
              <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('搜索名称、符号或合约地址')} aria-label={t('搜索代币')} spellCheck={false} />
              {!query && <kbd aria-hidden="true">/</kbd>}
            </label>
          </div>
        </div>
        {!results && tab !== 'stocks' && (
          <div className="tx-chains" role="group" aria-label={t('按链筛选')}>
            <button type="button" aria-pressed={chain === 'all'} className={chain === 'all' ? 'on' : ''} onClick={() => setChain('all')}>{t('全部链')}</button>
            {MARKET_PRIMARY.map((c) => { const logo = chainByDexKey(c.dexKey)?.logo; return <button key={c.dexKey} type="button" aria-pressed={chain === c.dexKey} className={chain === c.dexKey ? 'on' : ''} onClick={() => setChain(c.dexKey)}>{logo && <img src={logo} alt="" />}{c.label}</button> })}
          </div>
        )}

        <div className={`tx-mtable ${tableSpark ? 'has-spark' : ''}`} aria-label={results ? t('搜索结果') : tabLabel(tab)} role="region">
          <div className="tx-mrow tx-mhead">
            <span>#</span><span>{t('代币')}</span>{head('price', t('价格'))}{head('h1', '1h')}{head('h24', '24h')}{head('vol', t('24h 成交额'))}{head('liq', t('流动性'))}
            {tab === 'new' && !results ? <span className="r">{t('上线')}</span> : head('mcap', t('市值'))}
            <span className="r">{tableSpark ? t('走势 · 1h') : ''}</span><span />
          </div>
          {failed ? <div className="tx-empty is-tight"><CloudOff size={20} aria-hidden="true" /><span>{t('行情暂时无法加载，请检查网络后重试。')}</span><button type="button" className="tx-btn tx-btn-sm" onClick={retry}><RefreshCw size={13} />{t('重试')}</button></div>
            : loading ? Array.from({ length: 10 }, (_, i) => <div key={i} className="tx-mrow" aria-hidden="true"><span className="tx-sk" style={{ width: 14 }} /><span className="tx-mtoken"><span className="tx-sk" style={{ width: 28, height: 28, borderRadius: 14 }} /><span className="tx-sk" style={{ width: 120 }} /></span>{[70, 50, 50, 64, 64, 64].map((w, j) => <span key={j} className="tx-sk" style={{ width: w, justifySelf: 'end' }} />)}<span /><span /></div>)
              : !list.length ? <div className="tx-empty is-tight"><span>{results ? t('没有找到相关代币，换个名称或直接输入合约地址试试。') : tab === 'favorites' ? t('还没有自选。在币详情页点星标，就会出现在这里。') : feed?.pending.includes(chain) ? t('这条链的数据正在读取') : t('这条链暂时没有符合条件的币')}</span></div>
                : <>
                  {shown.map((x, i) => mrow(x, String(i + 1)))}
                  {list.length > limit && <div className="tx-mmore"><button type="button" className="tx-btn" onClick={() => setLimit((n) => n + PAGE)}>{t('查看更多||按钮')}</button></div>}
                </>}
        </div>
      </section>
      {/* 2026-10-03 goat: the old left-side line "Prices are live fills from DEXs on each chain." was removed, keeping only the right-side link */}
      <p className="tx-mfoot"><Link to="/spot" className="tx-link">{t('去现货交易')}<ChevronRight size={13} /></Link></p>
      {quick && <TokenQuick key={`${quick.chain}:${quick.address}`} chain={quick.chain} address={quick.address} onClose={() => setQuick(null)} />}
    </div>
  )
}
