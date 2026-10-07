// 网页版「行情」（2026-09-29 goat 第三轮：「说不出来哪不对，就是感觉特别奇怪」——上一版一张大卡片里画一个数据很稀的币的走势图 + 右边热门榜 + 下面卡片格子）。
// 参考 Polymarket 首页 + GMGN / Zora 列表，去掉大走势图：
//   2026-09-30 goat：顶部三块榜单卡（热门 / 涨幅榜 / 新币）和下面表格的页签重复，删掉，只留整宽代币表：
//   整宽代币表——排序页签（热门 / 涨幅 / 成交额 / 新币 / 股票 / 自选）+ 链筛选 + 搜索；列 # · 代币 · 价格 · 1h · 24h · 成交额 · 流动性 · 市值 · 走势 · 交易，
//       表头吸顶、数字列右对齐、可点表头排序，50 个一页往下加
// 走势线只画真实数据、只在代价小的地方画：服务器 K 线通道里已经缓存的前几名（desktop/trade/spark.tsx），拿不到就不画、整列不出现。
// 数据全部来自现有接口（发现页同一套 store/discoverFeed、自选 store/favorites、搜索 lib/market），接口失败显示空状态和重试，不放假数据。
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
/** 榜单里的涨跌：超过 1000% 的不带小数（+59,047% 比 +59046.69% 好读，也不挤掉价格） */
const pctShort = (n?: number) => n != null && Math.abs(n) >= 1000 ? `${n > 0 ? '+' : '-'}${Math.round(Math.abs(n)).toLocaleString('en-US')}%` : fmtPct(n)
/** 金额类统计：数据商给 0 表示没有这项数据，显示 -- 而不是 $0.00 */
const big = (n?: number) => (n && n > 0 ? fmtUsd(n, { compact: true }) : '--')
/** 涨幅榜只收够深的池子：流动性和 24h 成交额都不低于 5 万美元，免得几百美元的池子拉出几千倍霸榜 */
const deep = (x: MarketToken) => (x.liquidityUsd || 0) >= 50_000 && (x.volume24h || 0) >= 50_000 && !isStable(x.symbol)
const sortVal: Record<SortKey, (x: MarketToken) => number | undefined> = {
  price: (x) => x.priceUsd, h1: (x) => x.change1h, h24: (x) => x.change24h, vol: (x) => x.volume24h, liq: (x) => x.liquidityUsd, mcap: (x) => x.marketCap || x.fdv,
}

/** 上线多久：几分钟 / 几小时 / 几天 */
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
  // 点一个币：在行情页上弹出交易窗口（2026-10-05 goat），不再跳去现货页
  const [quick, setQuick] = useState<{ chain: string; address: string } | null>(null)
  const [tab, setTab] = usePageState<Tab>('desk.markets.tab2', 'hot', oneOf('hot', 'gain', 'volume', 'new', 'stocks', 'favorites'))
  const [chain, setChain] = usePageState<string>('desk.markets.chain', 'all')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean } | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const [query, setQuery] = useState('')
  // 搜索结果（2026-09-30：官方置顶、冒牌不显示，规则见 lib/market.ts rankSearch）
  const [found, setFound] = useState<SearchResult | null>(null)
  const results = found?.tokens ?? null
  const [searching, setSearching] = useState(false)
  const [favState, setFavState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [favRetry, setFavRetry] = useState(0)
  const [, tick] = useState(0)
  const listRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // 热门 / 涨幅 / 新币几个页签的数据：进页面拉一次，之后 20 秒刷新（页面在后台时不拉）
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
  // 键盘 / 聚焦搜索（和外框 ⌘K 不冲突：只在没有别的输入框聚焦时）
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

  // 自选：按链批量取最新报价，20 秒刷新
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

  // 搜索：名称、符号或合约地址，停手 350 毫秒再查
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
  // 自选：收藏了的一律显示（2026-10-02 goat：收藏两个新币后默认 5 个「消失」了、数字还是 7）。
  // 以前只显示拿到了报价的，某次报价没拉回来那几行就不见了；现在没报价的那行价格显示「--」，下次刷新拿到再补上。
  // 名字用收藏时存的叫法（BTC、BNB），不露出行情里的 BTCB / WBNB，和手机端一致。
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
  // 自选一个报价都还没拿到时才显示「加载中 / 加载失败」；拿到一部分就先显示，没拿到的那几行价格是「--」
  const favQuoted = favorites.some((f) => cache[marketKey(f.chain, f.address)])
  const loading = results ? searching : tab === 'favorites' ? favState === 'loading' && !favQuoted : !!feed && !feed.at && !feed.list.length && (feed.loading || !feed.error)
  const failed = !results && (tab === 'favorites' ? favState === 'error' && !favQuoted : !!feed?.error && !feed.list.length)
  const retry = () => {
    if (tab === 'favorites') { setFavState('loading'); setFavRetry((v) => v + 1); return }
    void load(tab === 'gain' || tab === 'volume' ? 'market' : tab, true)
  }
  const shown = list.slice(0, limit)

  // 走势线：只问表格前 12 行（服务器只查缓存）；一个都没拿到就整列不显示
  const sparkWant = useMemo(() => shown.slice(0, 12), [shown])
  const sparks = useSparks(sparkWant, 20)
  const tableSpark = shown.some((x) => sparks.has(sparkKey(x)))
  /** 表格一行（排名那一格传进来：正常结果写名次，折叠展开的写「·」） */
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
      {/* 2026-10-03 goat：原来左边那句「价格来自各链去中心化交易所的实时成交。」删掉，只留右边的链接 */}
      <p className="tx-mfoot"><Link to="/spot" className="tx-link">{t('去现货交易')}<ChevronRight size={13} /></Link></p>
      {quick && <TokenQuick key={`${quick.chain}:${quick.address}`} chain={quick.chain} address={quick.address} onClose={() => setQuick(null)} />}
    </div>
  )
}
