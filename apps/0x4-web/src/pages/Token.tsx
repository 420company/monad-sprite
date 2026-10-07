// 现货详情：报价、真实历史数据空态、持仓与持币社区。
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Copy, ExternalLink, RefreshCw, Star } from 'lucide-react'
import Button from '@/components/Button'
import TokenLogo from '@/components/TokenLogo'
import PriceChange from '@/components/PriceChange'
import Sparkline from '@/components/Sparkline'
import TradeSheet, { type Side } from '@/components/TradeSheet'
import { toast } from '@/components/Toast'
import { loadDexCandles, loadFastCandles, peekDexCandles, type DexCandles, type DexInterval } from '@/lib/candles'
import { PostComposer, PostList } from '@/components/Posts'
import { useMarket } from '@/store/market'
import { usePortfolio } from '@/store/portfolio'
import { useFavorites } from '@/store/favorites'
import TokenCommunities from '@/components/TokenCommunities'
import { fmtAmount, fmtMoney, fmtUsd, shortAddr, timeAgo } from '@/lib/format'
import { explorerAddr } from '@/lib/rpc'
import { getTokens, marketKey, SOL_MINT } from '@/lib/market'
import { SOLANA_CHAIN_ID, chainById, sameAddr } from '@/lib/chains'
import { copyText } from '@/lib/native'
import { locale, t } from '@/lib/i18n'
import { oneOf, usePageState } from '@/lib/pageState'
import { useBack } from '@/lib/useBack'
import { WEB_SURFACE } from '@/lib/surface'
import { needWallet } from '@/desktop/walletGate'

export default function Token() {
  const params = useParams()
  const chain = params.chain || 'solana'
  const address = params.address || params.mint || ''
  const nav = useNavigate()
  // 返回：有上一页退回上一页（上一页的状态 / 滚动都会还原），推送 / 深链直接打开的去 /discover
  const goBack = useBack('/discover')
  const { cache, put } = useMarket()
  const { items: favorites, add: addFav, remove: removeFav } = useFavorites()
  const [trade, setTrade] = useState<Side | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')
  const [retry, setRetry] = useState(0)
  const [postKey, setPostKey] = useState(0)
  // 概览 / 动态标签按币记在会话里，K 线周期全局记住：点进帖子、个人主页再返回还是原样（lib/pageState）
  const [view, setView] = usePageState<'overview' | 'posts'>(`token.view:${chain}:${address}`, 'overview', oneOf('overview', 'posts'))
  const token = cache[marketKey(chain, address)]
  const holding = usePortfolio(s => s.holdings.find(h => token && h.chainId === token.chainId && sameAddr(h.mint, address) && h.amount > 0))
  const isFav = favorites.some(f => f.chain === chain && sameAddr(f.address, address))

  // 历史 K 线：GeckoTerminal 按「链 + 交易对」取，切周期或换币时旧请求作废
  const [interval, setInterval_] = usePageState<DexInterval>('token.interval', '1h', oneOf('15m', '1h', '4h', '1d'))
  const [chart, setChart] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; data: DexCandles | null }>({ status: 'idle', data: null })
  const [chartRetry, setChartRetry] = useState(0)
  const pairAddress = token?.pairAddress
  useEffect(() => {
    if (!pairAddress) { setChart({ status: 'idle', data: null }); return }
    const ctrl = new AbortController()
    // 手上有这个币这个周期的 K 线（刚才按下时预取的、或上次看过存在本机的）就先画出来，同时去拿最新的
    const known = peekDexCandles({ chain, address, pairAddress, interval })
    setChart((c) => known ? { status: 'ready', data: known } : { status: 'loading', data: c.data?.pairAddress === pairAddress && c.data.interval === interval ? c.data : null })
    let full = false
    loadDexCandles({ chain, address, pairAddress, interval }, ctrl.signal)
      .then((data) => { full = true; if (!ctrl.signal.aborted) setChart({ status: 'ready', data }) })
      // GeckoTerminal 失败时，手上已有这个交易对这个周期的快速 K 线就留着显示，不报错
      .catch(() => { if (!ctrl.signal.aborted) setChart((c) => ({ status: c.data?.pairAddress === pairAddress && c.data.interval === interval ? 'ready' : 'error', data: c.data })) })
    // 手上什么都没有时，同时要一份快速 K 线（服务器 DexPaprika 通道全部周期，没开通就免密钥直连 1 小时），先画出来；完整历史到了整张换掉，晚到的快速结果不再覆盖
    if (!known) loadFastCandles({ chain, address, pairAddress, interval }).then((q) => { if (q && !full && !ctrl.signal.aborted) setChart({ status: 'ready', data: q }) })
    return () => ctrl.abort()
  }, [chain, address, pairAddress, interval, chartRetry])

  useEffect(() => {
    let alive = true
    setState('loading'); setTrade(null)
    const load = async () => {
      try {
        const list = await getTokens([address], chain)
        if (!alive) return
        put(list); setState(list.length ? 'ready' : 'empty')
      } catch { if (alive) setState('error') }
    }
    load()
    const timer = setInterval(load, 15_000)
    return () => { alive = false; clearInterval(timer) }
  }, [chain, address, retry, put])

  const back = <button onClick={goBack} className="icon-button -ml-2" aria-label={t('返回')} title={t('返回')}><ArrowLeft size={21} /></button>
  if (!token) return (
    <div className="safe-top">
      <header className="page-header page-gutter">{back}<h1 className="section-title mr-auto">{t('代币')}</h1></header>
      {state === 'loading' ? <div className="page-gutter space-y-4" aria-label={t('正在加载行情')}><div className="skeleton h-16" /><div className="skeleton h-60" /></div> : <div className="empty-state page-gutter" role="status"><p className="text-sm text-muted">{state === 'error' ? t('暂时无法加载行情') : t('没有找到该代币的行情')}</p><Button variant="secondary" size="sm" className="mt-4" onClick={() => setRetry(value => value + 1)}><RefreshCw size={16} />{t('重试')}</Button></div>}
    </div>
  )

  const chainInfo = chainById(token.chainId)
  const isSol = token.chain === 'solana' && token.address === SOL_MINT
  const hasPrice = token.priceUsd > 0 && Number.isFinite(token.priceUsd)
  const totalTrades = (token.buys24h ?? 0) + (token.sells24h ?? 0)
  const buyRatio = token.buys24h !== undefined && token.sells24h !== undefined && totalTrades > 0 ? token.buys24h / totalTrades * 100 : null
  const explorer = token.chainId === SOLANA_CHAIN_ID ? explorerAddr(token.address) : chainInfo?.viem?.blockExplorers?.default.url ? `${chainInfo.viem.blockExplorers.default.url}/token/${token.address}` : null
  const stats = [
    [t('市值'), fmtUsd(token.marketCap ?? token.fdv, { compact: true })], [t('流动性'), fmtUsd(token.liquidityUsd, { compact: true })],
    [t('24h 成交额'), fmtUsd(token.volume24h, { compact: true })], [t('完全稀释市值'), fmtUsd(token.fdv, { compact: true })],
    [t('24h 买入 / 卖出'), `${fmtAmount(token.buys24h, 0)} / ${fmtAmount(token.sells24h, 0)}`], [t('创建时间'), token.createdAt ? timeAgo(token.createdAt) : '--'],
  ]
  const toggleFav = () => {
    if (isFav) { removeFav(chain, address); toast.info(t('已取消收藏')) }
    else { addFav({ chain, chainId: token.chainId, address: token.address, symbol: token.symbol, name: token.name, logo: token.logo, decimals: holding?.decimals ?? token.decimals }); toast.success(t('已收藏')) }
  }

  // 买卖入口：手机是贴底的一条胶囊；网页版放在右栏的交易面板里（左 K 线、右下单）
  const tradeButtons = isSol ? <Button className="w-full" onClick={() => nav('/swap')}>{t('兑换 SOL')}</Button> : <><Button variant="up" className="min-w-0 flex-1" onClick={() => { if (!needWallet()) setTrade('buy') }}>{t('买入')}</Button><Button variant="down" className="min-w-0 flex-1" disabled={!holding} onClick={() => { if (!needWallet()) setTrade('sell') }}>{t('卖出')}</Button></>
  return (
    <div className={WEB_SURFACE ? 'tok-desk' : 'safe-top pb-24'}>
     <div className={WEB_SURFACE ? 'tok-main' : 'contents'}>
      <header className="page-gutter flex min-h-20 items-center gap-2 py-3">
        {back}<TokenLogo src={token.logo} symbol={token.symbol} size={36} />
        <div className="min-w-0 flex-1"><h1 className="truncate text-lg font-semibold" title={token.symbol}>{token.symbol}</h1><p className="truncate text-xs text-muted">{chainInfo?.name || token.chain} · {token.name}</p></div>
        <button onClick={toggleFav} className={`icon-button ${isFav ? 'text-accent' : ''}`} aria-label={isFav ? t('取消收藏') : t('收藏代币')} aria-pressed={isFav} title={isFav ? t('取消收藏') : t('收藏代币')}><Star size={20} fill={isFav ? 'currentColor' : 'none'} /></button>
        <button onClick={() => copyText(token.address).then(() => toast.success(t('合约地址已复制'))).catch(() => toast.error(t('复制失败')))} className="icon-button" aria-label={t('复制合约地址')} title={shortAddr(token.address)}><Copy size={18} /></button>
      </header>
      {(state === 'error' || state === 'empty') && <div className="status-notice page-gutter" role="status"><span className="flex-1">{state === 'error' ? t('行情更新失败，显示上次价格') : t('暂无新报价，显示上次价格')}</span><button className="icon-button" onClick={() => setRetry(value => value + 1)} aria-label={t('刷新行情')}><RefreshCw size={18} /></button></div>}
      <section className="page-gutter py-3" aria-label={t('代币价格')}>
        <div className="number break-all text-[32px] leading-tight font-semibold">{fmtUsd(hasPrice ? token.priceUsd : undefined)}</div>
        <div className="mt-2 flex items-center gap-2 text-sm"><PriceChange value={hasPrice ? token.change24h : undefined} /><span className="text-muted">24h</span></div>
      </section>
      <div className="page-gutter mt-3 flex gap-6 border-b border-line" role="group" aria-label={t('代币视图')}>
        <button className="view-tab" aria-pressed={view === 'overview'} onClick={() => setView('overview')}>{t('概览')}</button>
        <button className="view-tab" aria-pressed={view === 'posts'} onClick={() => setView('posts')}>{t('动态')}</button>
      </div>
      {view === 'overview' ? <>
        <section className="mt-5" aria-label={t('历史行情')}>
          <div className="page-gutter flex items-center justify-between pb-2">
            <div className="flex gap-1" role="group" aria-label={t('K 线周期')}>
              {(['15m', '1h', '4h', '1d'] as const).map((k) => <button key={k} onClick={() => setInterval_(k)} aria-pressed={interval === k} className={`min-h-9 rounded-lg px-3 text-[13px] font-medium ${interval === k ? 'bg-card2 text-fg' : 'text-muted'}`}>{k}</button>)}
            </div>
            <span className="text-xs text-muted" role="status">
              {chart.status === 'loading' && !chart.data ? t('加载中') : chart.status === 'error' ? <button className="text-warning" onClick={() => setChartRetry((v) => v + 1)}>{t('K 线加载失败，重试')}</button> : chart.data?.supported === false ? t('该交易对暂无 K 线') : chart.data ? t('更新于 {time}', { time: new Date(chart.data.asOf).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) }) : ''}
            </span>
          </div>
          {/* 只画真实 OHLCV；没有数据时 Sparkline 自己显示「暂无历史 K 线」 */}
          <Sparkline height={WEB_SURFACE ? 380 : 200} candles={chart.data?.candles ?? []} label={t('{symbol} {interval} K 线', { symbol: token.symbol, interval })} />
          <dl className="page-gutter grid grid-cols-4 gap-2 py-3 text-center">{([['5m', token.change5m], ['1h', token.change1h], ['6h', token.change6h], ['24h', token.change24h]] as const).map(([key, value]) => <div key={key} className="min-w-0"><dt className="text-xs text-muted">{key}</dt><dd className="mt-1 break-all"><PriceChange value={value} className="text-[13px] font-medium" /></dd></div>)}</dl>
        </section>
        {holding && <section className="page-gutter mt-5" aria-label={t('我的持仓')}><div className="border-y border-line py-4"><h2 className="text-sm text-muted">{t('我的持仓')}</h2><div className="number mt-2 flex flex-wrap items-baseline justify-between gap-2"><span className="break-all text-base font-semibold">{fmtAmount(holding.amount)} {holding.symbol}</span><span className="text-sm">{holding.priceUsd > 0 ? fmtMoney(holding.valueUsd) : '--'}</span></div></div></section>}
        {/* 合约地址卡片（2026-09-30 goat：要让用户很明显地看到合约地址；和网页版代币信息同一设计）：完整地址 + 明显的复制按钮 */}
        <section className="page-gutter mt-5" aria-label={t('合约地址')}>
          <div className="flex items-center gap-3 rounded-2xl border border-accent/35 bg-accent/10 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-accent">{t('合约地址')}<span className="rounded-full bg-white/10 px-2 py-px font-medium text-muted">{chainInfo?.name || token.chain}</span></div>
              <div className="mt-1 break-all font-mono text-[13px] font-semibold leading-snug select-all" translate="no">{token.address}</div>
            </div>
            <button onClick={() => copyText(token.address).then(() => toast.success(t('合约地址已复制'))).catch(() => toast.error(t('复制失败')))} className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3 text-[13px] font-semibold text-bg" aria-label={t('复制合约地址')}><Copy size={14} />{t('复制')}</button>
          </div>
        </section>
        <section className="page-gutter mt-5" aria-labelledby="token-data"><h2 id="token-data" className="section-title">{t('市场数据')}</h2><dl className="mt-2 grid grid-cols-2 gap-x-5">{stats.map(([key, value]) => <div key={key} className="min-w-0 border-b border-line py-3"><dt className="text-xs text-muted">{key}</dt><dd className="number mt-1 break-words text-sm font-medium">{value}</dd></div>)}</dl>
          {buyRatio !== null && <div className="py-4"><div className="flex justify-between text-xs text-muted"><span>{t('买入 {pct}%', { pct: buyRatio.toFixed(0) })}</span><span>{t('卖出 {pct}%', { pct: (100 - buyRatio).toFixed(0) })}</span></div><div className="mt-2 flex h-1 overflow-hidden bg-down" role="img" aria-label={t('24 小时成交笔数：买入 {buy}%，卖出 {sell}%', { buy: buyRatio.toFixed(0), sell: (100 - buyRatio).toFixed(0) })}><div className="bg-up" style={{ width: `${buyRatio}%` }} /></div></div>}
          {token.description && <p className="mt-3 break-words text-sm leading-relaxed text-muted">{token.description}</p>}
          {explorer && <a href={explorer} target="_blank" rel="noreferrer" className="text-action mt-2">{t('区块浏览器')}<ExternalLink size={14} /></a>}
        </section>
      </> : <section className="page-gutter py-4" aria-label={t('代币动态')}><PostComposer token={{ chain: token.chain, address: token.address, symbol: token.symbol }} onPosted={() => setPostKey(key => key + 1)} /><PostList filter={{ token: `${token.chain}:${token.address}` }} refreshKey={postKey} /></section>}
      {/* 社区：官方社区 + 持币最多的社区（不再自动建群 / 自动加入） */}
      <TokenCommunities chain={token.chain} address={token.address} symbol={token.symbol} />
      {!chainInfo && <p className="page-gutter mt-4 text-sm text-muted">{t('暂不支持在 {chain} 上交易', { chain: token.chain })}</p>}
     </div>
      {/* 贴底买卖条：手机 App 一直有；网页版只在窄屏（手机浏览器）出现，宽屏用右栏面板（tok-bar 在 desktop.css 里按宽度隐藏） */}
      {chainInfo && <div className={`${WEB_SURFACE ? 'tok-bar ' : ''}glass fixed inset-x-3 bottom-[calc(max(14px,env(safe-area-inset-bottom))+4.75rem)] z-30 mx-auto flex max-w-[456px] gap-3 rounded-[26px] px-3 py-3`} aria-label={t('代币交易')}>
        {tradeButtons}
      </div>}
      {chainInfo && WEB_SURFACE && <aside className="tok-side" aria-label={t('代币交易')}>
        <div className="tok-side-head"><TokenLogo src={token.logo} symbol={token.symbol} size={28} /><span className="font-semibold">{t('交易 {symbol}', { symbol: token.symbol })}</span></div>
        <div className="number mt-3 text-[26px] font-semibold">{fmtUsd(hasPrice ? token.priceUsd : undefined)}</div>
        <div className="mt-1 text-sm"><PriceChange value={hasPrice ? token.change24h : undefined} /> <span className="text-muted">24h</span></div>
        <div className="mt-4 flex gap-3">{tradeButtons}</div>
        <div className="mt-4 border-t border-line pt-3 text-[13px]">
          <div className="flex justify-between"><span className="text-muted">{t('我的持仓')}</span><span className="number">{holding ? `${fmtAmount(holding.amount)} ${holding.symbol}` : '--'}</span></div>
          <div className="mt-2 flex justify-between"><span className="text-muted">{t('网络')}</span><span>{chainInfo.name}</span></div>
        </div>
      </aside>}
      {trade && <TradeSheet key={`${chain}:${address}:${trade}`} open side={trade} token={token} onClose={() => setTrade(null)} />}
    </div>
  )
}
