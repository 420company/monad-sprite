// Web "Spot" trading terminal (2026-09-29 goat 3rd round: overall layout felt off; coin names back to normal font; payment asset pops a full-height mobile sheet; buy button did nothing;
// BTCB showed "chart failed to load, retry" and "no historical candles" at the same time). Modeled on Backpack spot + Jupiter swap panel: everything on one screen, page doesn't scroll, each panel scrolls itself:
//   left: market list 260 (search, watchlist / hot, collapsible to an icon bar)
//   center: token header (icon, symbol, chain, price, 24h stats, favorite / copy address / block explorer) → chart (OHLC, only one status shown) → tab panel
//       (my positions / my fills / top-holder groups / related posts / token info)
//   right: buy/sell panel 340 (desktop/trade/SpotOrderForm: same logic as the mobile buy/sell sheet; payment asset is a dropdown panel; the button is always tappable and explains why when an order can't be placed)
// /token/:chain/:address and /spot are both this page. All data comes from existing APIs; failures show an empty state, never fake data.
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Copy, ExternalLink, Lock, Maximize2, MessageSquare, PanelLeftClose, PanelLeftOpen, PenLine, Plus, RefreshCw, Search, Star, Wallet, X } from 'lucide-react'
import TokenLogo from '@/components/TokenLogo'
import Avatar from '@/components/Avatar'
import OfficialBadge from '@/components/OfficialBadge'
import { PostComposer, type Post } from '@/components/Posts'
import { toast } from '@/components/Toast'
import type { Side } from '@/components/TradeSheet'
import { useMarket } from '@/store/market'
import { usePortfolio } from '@/store/portfolio'
import { useFavorites } from '@/store/favorites'
import { useDiscoverFeed } from '@/store/discoverFeed'
import { isWalletConnected, useWallet } from '@/store/wallet'
import { useSocial } from '@/store/social'
import { api, type TokenCommunities } from '@/lib/social'
import { API_BASE } from '@/lib/env'
import { absUrl, postImages, thumbOf } from '@/lib/postImage'
import { EMPTY_FEED } from '@/lib/marketFeed'
import { getTokens, marketKey, searchTokensGrouped, type SearchResult } from '@/lib/market'
import { SOLANA_CHAIN_ID, chainById, chainByDexKey, sameAddr } from '@/lib/chains'
import { explorerAddr } from '@/lib/rpc'
import { copyText } from '@/lib/native'
import { prefetchDexCandles, type DexInterval } from '@/lib/candles'
import { fmtAmount, fmtMoney, fmtPct, fmtUsd, shortAddr, timeAgo } from '@/lib/format'
import { locale, t } from '@/lib/i18n'
import { oneOf, usePageState } from '@/lib/pageState'
import type { MarketToken } from '@/lib/types'
import { getOx4Wallet, needWallet } from '../walletGate'
import { useCandles } from '../useCandles'
import ChartPanel, { type ChartStatus } from '../trade/ChartPanel'
import SpriteLook from '../trade/SpriteLook'
import { buildBrief } from '@/lib/chartBrief'
import SpotOrderForm from '../trade/SpotOrderForm'
import Modal from '../trade/Modal'
import './trade.css'

const IVALS: DexInterval[] = ['15m', '1h', '4h', '1d']
const dir = (n?: number) => (n ?? 0) >= 0 ? 'up' : 'down'
/** Money stats: the data provider's 0 means "no such data" — show -- instead of $0.00 */
const big = (n?: number) => (n && n > 0 ? fmtUsd(n, { compact: true }) : '--')
const tokenPath = (x: { chain: string; address: string }) => `/token/${x.chain}/${x.address}`
const pre = (x: MarketToken) => { if (x.pairAddress) prefetchDexCandles({ chain: x.chain, address: x.address, pairAddress: x.pairAddress, interval: '1h' }) }
const chainLabel = (chain: string) => chainByDexKey(chain)?.name || chain
const RAIL_KEY = '0x4.desk.spotRailFolded'

/** /spot: with no coin specified, open the last-viewed one, else the first watchlist coin */
export function DeskSpot() {
  const favorites = useFavorites((s) => s.items)
  let last = ''
  try { last = sessionStorage.getItem('0x4.desk.lastToken') || '' } catch { /* Privacy mode */ }
  const to = last || (favorites[0] ? tokenPath(favorites[0]) : '/token/bsc/0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c')
  return <Navigate to={to} replace />
}

/** One coin's market data: fetched once on entry, refreshed every 15s (same API as mobile coin details). Shared between the spot page and the market page's popup */
function useTokenQuote(chain: string, address: string) {
  const { cache, put } = useMarket()
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')
  const [retry, setRetry] = useState(0)
  const token = cache[marketKey(chain, address)]
  useEffect(() => {
    let alive = true
    setState('loading')
    const load = async () => {
      try {
        const list = await getTokens([address], chain)
        if (!alive) return
        put(list); setState(list.length ? 'ready' : 'empty')
      } catch { if (alive) setState('error') }
    }
    void load()
    const id = setInterval(() => { if (!document.hidden) void load() }, 15_000)
    return () => { alive = false; clearInterval(id) }
  }, [chain, address, retry, put])
  return { token, state, retry: () => setRetry((v) => v + 1) }
}

const QuoteState = ({ state, onRetry }: { state: 'loading' | 'ready' | 'empty' | 'error'; onRetry: () => void }) => (
  <div className="tx-panel tx-state">
    {state === 'loading' ? <div className="tx-empty"><span className="tx-spin" aria-hidden="true" /><span>{t('正在读取行情')}</span></div>
      : <div className="tx-empty"><span>{state === 'error' ? t('暂时无法加载行情') : t('没有找到该代币的行情')}</span><button type="button" className="tx-btn tx-btn-sm" onClick={onRetry}><RefreshCw size={13} />{t('重试')}</button></div>}
  </div>
)

export default function TokenTerminal() {
  const params = useParams()
  const chain = params.chain || 'solana'
  const address = params.address || params.mint || ''
  const { token, state, retry } = useTokenQuote(chain, address)
  // Left column collapse: remembered per browser (expanded every time if it can't persist)
  const [folded, setFolded] = useState(() => { try { return localStorage.getItem(RAIL_KEY) === '1' } catch { return false } })
  const fold = (v: boolean) => { setFolded(v); try { localStorage.setItem(RAIL_KEY, v ? '1' : '0') } catch { /* Incognito mode */ } }

  useEffect(() => { try { sessionStorage.setItem('0x4.desk.lastToken', `/token/${chain}/${address}`) } catch { /* Privacy mode */ } }, [chain, address])

  return (
    <div className={`tx-term tx-spot ${folded ? 'is-folded' : ''}`}>
      <Rail current={{ chain, address }} folded={folded} onFold={fold} />
      {token ? <Terminal key={`${chain}:${address}`} token={token} stale={state === 'error' || state === 'empty'} onRetry={retry} />
        : <QuoteState state={state} onRetry={retry} />}
    </div>
  )
}

/**
 * Clicking a coin on the market page: pop this coin's trading window over the market page (2026-10-05 goat: "put market and buying on one page").
 * Same three blocks as the spot page's right side (token header + chart + tabs + buy/sell panel), just without the left market list; closing returns to the original market list (filters and scroll intact).
 * Only covers the middle content area (goat: "don't block the left nav"): top bar, the space-look's left vertical nav, and the bottom status bar stay visible and clickable,
 * so no <dialog> modal (a modal covers the whole screen and blocks everything behind); the content area is computed from their actual positions and mounted on .desk (not inside .desk-main: fixed misplaces when it has a transform).
 * Windows popped by the buy/sell panel itself (confirm, pick asset) are modal <dialog>s and stack on top as usual
 */
function contentArea(): { top: number; left: number; right: number; bottom: number } {
  const vw = window.innerWidth, vh = window.innerHeight
  const bar = document.querySelector('.desk-bar')?.getBoundingClientRect()
  const status = document.querySelector('.desk-status')?.getBoundingClientRect()
  const nav = document.querySelector('.desk-nav')?.getBoundingClientRect()
  // Space look: the nav is a vertical bar on the left (taller than wide), content starts to its right; other looks keep nav in the top bar
  const sideNav = nav && nav.height > nav.width && nav.left < vw / 3 ? nav : null
  const top = bar && bar.height > 0 ? Math.max(0, bar.bottom) : 0
  const bottom = status && status.height > 0 && status.top > vh / 2 ? vh - status.top : 0
  return { top: top + 8, left: (sideNav ? sideNav.right : 0) + 12, right: 12, bottom: bottom + 8 }
}

export function TokenQuick({ chain, address, onClose }: { chain: string; address: string; onClose: () => void }) {
  const nav = useNavigate()
  const { token, state, retry } = useTokenQuote(chain, address)
  const [area, setArea] = useState(contentArea)
  useEffect(() => {
    const re = () => setArea(contentArea())
    window.addEventListener('resize', re)
    // Switching looks (space ↔ others) moves the nav
    window.addEventListener('theme-change', re)
    const t0 = window.setTimeout(re, 60)
    return () => { window.removeEventListener('resize', re); window.removeEventListener('theme-change', re); clearTimeout(t0) }
  }, [])
  // Esc closes; when the buy/sell panel's own confirmation window is open, Esc closes that first
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const box = { top: area.top, left: area.left, right: area.right, bottom: area.bottom }
  return createPortal(
    <>
      <div className="tx-tokpop-scrim" onClick={onClose} aria-hidden="true" />
      <section className="tx-tokpop" style={box} role="dialog" aria-label={token ? t('{symbol} 交易', { symbol: token.symbol }) : t('代币交易')}>
        <div className="tx-tokpop-bar">
          <button type="button" className="tx-icon-btn" title={t('在现货页打开')} aria-label={t('在现货页打开')} onClick={() => { onClose(); nav(tokenPath({ chain, address })) }}><Maximize2 size={15} /></button>
          <button type="button" className="tx-icon-btn" title={t('关闭')} aria-label={t('关闭')} onClick={onClose}><X size={17} /></button>
        </div>
        <div className="tx-term tx-spot is-tokpop">
          {token ? <Terminal key={`${chain}:${address}`} token={token} stale={state === 'error' || state === 'empty'} onRetry={retry} />
            : <QuoteState state={state} onRetry={retry} />}
        </div>
      </section>
    </>,
    // Mounted in .desk (same stacking context as top bar, vertical nav, status bar so z-index wins; mounted on body it would be crushed under outer stacking contexts, with the mask covering the nav)
    document.querySelector('.desk') || document.body,
  )
}

function Terminal({ token, stale, onRetry }: { token: MarketToken; stale: boolean; onRetry: () => void }) {
  const connected = useWallet(isWalletConnected)
  // Connected an external wallet, and it has no Solana (anything but Phantom)
  const noSolana = useWallet((w) => w.kind === 'external' && !w.wallet)
  const [interval, setIval] = usePageState<DexInterval>('token.interval', '1h', oneOf('15m', '1h', '4h', '1d'))
  const [chartRetry, setChartRetry] = useState(0)
  const chart = useCandles(token, interval, chartRetry)
  const [side, setSide] = useState<Side>('buy')
  const [orderKey, setOrderKey] = useState(0)
  const chainInfo = chainById(token.chainId)

  // Chart state, pick one of four: no pair / provider says unsupported → no chart; not started or loading → loading; failed → failed + retry; got data → draw
  const status: ChartStatus = !token.pairAddress || chart.data?.supported === false ? 'unsupported'
    : chart.status === 'idle' || chart.status === 'loading' ? 'loading'
      : chart.status === 'error' ? 'error' : 'ready'
  const price = (n: number) => fmtUsd(n).replace('$', '')

  return (
    <>
      <TokenHead token={token} stale={stale} onRetry={onRetry} />
      <ChartPanel intervals={IVALS} interval={interval} onInterval={setIval} candles={chart.data?.candles ?? []} chartKey={`${token.chain}:${token.address}:${interval}`}
        status={status} asOf={chart.data?.asOf} onRetry={() => setChartRetry((v) => v + 1)} formatPrice={price}>
        {/* Ask the sprite (2026-10-02): spot has only the chart itself (no buy/sell pressure, big orders, positions) */}
        <SpriteLook chartKey={`${token.chain}:${token.address}:${interval}`} getBrief={() => buildBrief({ market: 'spot', symbol: token.symbol, interval, candles: chart.data?.candles ?? [] })} />
      </ChartPanel>
      <aside className="tx-panel tx-order" aria-label={t('代币交易')}>
        <div className="tx-order-in">
          <div className="tx-side" role="group" aria-label={t('买入或卖出')}>
            {/* Switching buy/sell doesn't rebuild the panel (2026-09-29: previously each tap rebuilt the whole block — a visible "flash" — and lost the entered amount); the amount is kept, converted by value inside the panel */}
            <button type="button" aria-pressed={side === 'buy'} className={`is-up ${side === 'buy' ? 'on' : ''}`} onClick={() => setSide('buy')}>{t('买入')}</button>
            <button type="button" aria-pressed={side === 'sell'} className={`is-down ${side === 'sell' ? 'on' : ''}`} onClick={() => setSide('sell')}>{t('卖出')}</button>
          </div>
          {!chainInfo
            ? <div className="tx-empty is-tight"><span>{t('暂不支持在 {chain} 上交易', { chain: token.chain })}</span></div>
            // External wallets with EVM only (MetaMask etc.) can't trade Solana coins: one line + get 0x4 Wallet (2026-09-30)
            : noSolana && token.chainId === SOLANA_CHAIN_ID
              ? <div className="tx-empty is-tight tx-nosol"><span>{t('这个币在 Solana 上，用 0x4 Wallet 就能买卖')}</span><button type="button" className="tx-btn tx-btn-sm" onClick={getOx4Wallet}>{t('获取 0x4 Wallet')}</button></div>
              : <SpotOrderForm key={`${token.chain}:${token.address}:${orderKey}`} token={token} side={side} connected={connected} onDone={() => setOrderKey((k) => k + 1)} />}
        </div>
      </aside>
      <BottomTabs token={token} connected={connected} onBuy={() => setSide('buy')} />
    </>
  )
}

/** Token header: icon, symbol, chain, favorite | price + 24h | stats | copy address, block explorer */
function TokenHead({ token, stale, onRetry }: { token: MarketToken; stale: boolean; onRetry: () => void }) {
  const { items: favorites, add: addFav, remove: removeFav } = useFavorites()
  const holding = usePortfolio((s) => s.holdings.find((h) => h.chainId === token.chainId && sameAddr(h.mint, token.address) && h.amount > 0))
  const chainInfo = chainById(token.chainId)
  const isFav = favorites.some((f) => f.chain === token.chain && sameAddr(f.address, token.address))
  const hasPrice = token.priceUsd > 0 && Number.isFinite(token.priceUsd)
  const explorer = token.chainId === SOLANA_CHAIN_ID ? explorerAddr(token.address) : chainInfo?.viem?.blockExplorers?.default.url ? `${chainInfo.viem.blockExplorers.default.url}/token/${token.address}` : null
  const trades = (token.buys24h ?? 0) + (token.sells24h ?? 0)
  const toggleFav = () => {
    if (isFav) { removeFav(token.chain, token.address); toast.info(t('已取消收藏')) }
    else { addFav({ chain: token.chain, chainId: token.chainId, address: token.address, symbol: token.symbol, name: token.name, logo: token.logo, decimals: holding?.decimals ?? token.decimals }); toast.success(t('已收藏')) }
  }
  return (
    <header className="tx-panel tx-head">
      <div className="tx-head-id">
        <TokenLogo src={token.logo} symbol={token.symbol} size={28} chain={token.chain} address={token.address} />
        <span className="tx-head-sym">
          <b>{token.symbol}</b>
          <small className="tx-chainbadge">{chainInfo?.logo && <img src={chainInfo.logo} alt="" />}{chainInfo?.name || token.chain}{token.name && token.name !== token.symbol ? ` · ${token.name}` : ''}</small>
        </span>
        <button type="button" className={`tx-icon-btn ${isFav ? 'is-on' : ''}`} onClick={toggleFav} aria-pressed={isFav} aria-label={isFav ? t('取消收藏') : t('收藏代币')} title={isFav ? t('取消收藏') : t('收藏代币')}><Star size={15} fill={isFav ? 'currentColor' : 'none'} /></button>
      </div>
      <div className="tx-head-px">
        <b className={hasPrice ? dir(token.change24h) : ''}>{hasPrice ? fmtUsd(token.priceUsd) : '--'}</b>
        <small className={dir(token.change24h)}>{hasPrice ? fmtPct(token.change24h) : '--'}</small>
      </div>
      <dl className="tx-stats">
        <div><dt>{t('24h 成交额')}</dt><dd>{big(token.volume24h)}</dd></div>
        <div><dt>{t('流动性')}</dt><dd>{big(token.liquidityUsd)}</dd></div>
        <div><dt>{t('市值')}</dt><dd>{big(token.marketCap || token.fdv)}</dd></div>
        <div><dt>1h</dt><dd className={token.change1h == null ? '' : dir(token.change1h)}>{fmtPct(token.change1h)}</dd></div>
        <div><dt>6h</dt><dd className={token.change6h == null ? '' : dir(token.change6h)}>{fmtPct(token.change6h)}</dd></div>
        <div><dt>{t('24h 买入 / 卖出')}</dt><dd>{trades ? <><span className="up">{fmtAmount(token.buys24h, 0)}</span> / <span className="down">{fmtAmount(token.sells24h, 0)}</span></> : '--'}</dd></div>
        <div><dt>{t('创建时间')}</dt><dd>{token.createdAt ? timeAgo(token.createdAt) : '--'}</dd></div>
      </dl>
      <div className="tx-head-act">
        {stale && <button type="button" className="tx-link warn" onClick={onRetry} style={{ marginRight: 8 }}>{t('行情更新失败，显示上次价格')}<RefreshCw size={12} /></button>}
        <button type="button" className="tx-icon-btn" onClick={() => copyText(token.address).then(() => toast.success(t('合约地址已复制'))).catch(() => toast.error(t('复制失败')))} aria-label={t('复制合约地址')} title={`${t('复制合约地址')} ${shortAddr(token.address)}`}><Copy size={14} /></button>
        {explorer && <a className="tx-icon-btn" href={explorer} target="_blank" rel="noreferrer" aria-label={t('区块浏览器')} title={t('区块浏览器')}><ExternalLink size={14} /></a>}
      </div>
    </header>
  )
}

type TabKey = 'holding' | 'trades' | 'groups' | 'posts' | 'info'

/** Bottom tabs: my positions / my fills / top-holder groups / related posts / token info. Fixed height, content scrolls itself */
function BottomTabs({ token, connected, onBuy }: { token: MarketToken; connected: boolean; onBuy: () => void }) {
  const [tab, setTab] = usePageState<TabKey>('desk.token.bottom', () => connected ? 'holding' : 'info', oneOf('holding', 'trades', 'groups', 'posts', 'info'))
  const [composing, setComposing] = useState(false)
  const [postKey, setPostKey] = useState(0)
  const TABS: [TabKey, string][] = [['holding', t('我的持仓')], ['trades', t('我的成交')], ['groups', t('持币最多的群')], ['posts', t('相关动态')], ['info', t('代币信息')]]
  return (
    <section className="tx-panel tx-bottom" aria-label={t('代币视图')}>
      <div className="tx-tabs" role="tablist" aria-label={t('代币视图')}>
        {TABS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tx-tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{label}</button>)}
        {tab === 'posts' && <div className="tx-tabs-end"><button type="button" className="tx-btn tx-btn-sm" onClick={() => { if (!needWallet()) setComposing(true) }}><PenLine size={13} />{t('发动态')}</button></div>}
      </div>
      <div className="tx-bottom-body">
        {tab === 'holding' && <HoldingTab token={token} connected={connected} onBuy={onBuy} />}
        {tab === 'trades' && <TradesTab token={token} connected={connected} />}
        {tab === 'groups' && <GroupsTab token={token} />}
        {tab === 'posts' && <PostsTab token={token} refreshKey={postKey} />}
        {tab === 'info' && <InfoTab token={token} />}
      </div>
      <Modal open={composing} onClose={() => setComposing(false)} title={t('发一条关于 {symbol} 的动态', { symbol: token.symbol })} width={520}>
        {composing && <PostComposer token={{ chain: token.chain, address: token.address, symbol: token.symbol }} onPosted={() => { setComposing(false); setPostKey((k) => k + 1); setTab('posts') }} />}
      </Modal>
    </section>
  )
}

function ConnectEmpty({ text }: { text: string }) {
  return <div className="tx-empty"><Wallet size={20} aria-hidden="true" /><span>{text}</span><button type="button" className="tx-btn tx-btn-sm" onClick={() => { needWallet() }}>{t('连接 0x4 Wallet')}</button></div>
}

function HoldingTab({ token, connected, onBuy }: { token: MarketToken; connected: boolean; onBuy: () => void }) {
  const holding = usePortfolio((s) => s.holdings.find((h) => h.chainId === token.chainId && sameAddr(h.mint, token.address) && h.amount > 0))
  if (!connected) return <ConnectEmpty text={t('连接钱包后这里显示你持有的 {symbol}', { symbol: token.symbol })} />
  if (!holding) return <div className="tx-empty"><span>{t('还没有持有 {symbol}', { symbol: token.symbol })}</span><button type="button" className="tx-btn tx-btn-sm" onClick={onBuy}>{t('去买入')}</button></div>
  return (
    <div className="tx-table-wrap"><table className="tx-table">
      <thead><tr><th>{t('代币')}</th><th>{t('网络')}</th><th className="r">{t('持有数量')}</th><th className="r">{t('价格')}</th><th className="r">{t('价值')}</th><th className="r">24h</th></tr></thead>
      <tbody><tr>
        <td><span className="tx-cell-coin"><TokenLogo src={token.logo} symbol={token.symbol} size={18} chain={token.chain} address={token.address} />{holding.symbol}</span></td>
        <td className="mute">{chainById(token.chainId)?.name || token.chain}</td>
        <td className="r">{fmtAmount(holding.amount)}</td>
        <td className="r">{holding.priceUsd > 0 ? fmtUsd(holding.priceUsd) : '--'}</td>
        <td className="r">{holding.priceUsd > 0 ? fmtMoney(holding.valueUsd) : '--'}</td>
        <td className={`r ${holding.change24h == null ? '' : dir(holding.change24h)}`}>{fmtPct(holding.change24h)}</td>
      </tr></tbody>
    </table></div>
  )
}

interface TradeRow { id: string; side: 'buy' | 'sell'; chain: string; token: string; symbol: string; qty: number; usd: number; price: number; realized: number; created_at: number }

/** My fills: this coin's entries picked from the server's last 50 recorded trades (public API, read-only) */
function TradesTab({ token, connected }: { token: MarketToken; connected: boolean }) {
  const me = useSocial((s) => s.me)
  const address = useWallet((s) => s.address)
  const who = me?.address || address || ''
  const [rows, setRows] = useState<TradeRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!who) return
    let alive = true
    setFailed(false)
    api<{ trades: TradeRow[] }>(`/api/users/${encodeURIComponent(who)}/trades?limit=50`)
      .then((r) => { if (alive) setRows((r.trades || []).filter((x) => sameAddr(x.token, token.address))) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [who, token.address, retry])
  if (!connected || !who) return <ConnectEmpty text={t('连接钱包后这里显示你买卖 {symbol} 的记录', { symbol: token.symbol })} />
  if (failed && !rows) return <div className="tx-empty"><span>{t('成交记录暂时无法加载')}</span><button type="button" className="tx-btn tx-btn-sm" onClick={() => setRetry((v) => v + 1)}><RefreshCw size={13} />{t('重试')}</button></div>
  if (!rows) return <div className="tx-empty"><span className="tx-spin" aria-hidden="true" /></div>
  if (!rows.length) return <div className="tx-empty"><span>{t('最近 50 笔交易里没有 {symbol}', { symbol: token.symbol })}</span></div>
  const when = (ms: number) => new Date(ms).toLocaleString(locale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  return (
    <div className="tx-table-wrap"><table className="tx-table">
      <thead><tr><th>{t('时间')}</th><th>{t('方向')}</th><th className="r">{t('数量')}</th><th className="r">{t('成交价')}</th><th className="r">{t('金额')}</th><th className="r">{t('已实现盈亏')}</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}>
        <td className="mute">{when(r.created_at)}</td>
        <td><span className={`tx-dir ${r.side === 'buy' ? 'up' : 'down'}`}>{r.side === 'buy' ? t('买入') : t('卖出')}</span></td>
        <td className="r">{fmtAmount(r.qty)} {r.symbol}</td>
        <td className="r">{r.price > 0 ? fmtUsd(r.price) : '--'}</td>
        <td className="r">{fmtMoney(r.usd)}</td>
        <td className={`r ${r.side === 'sell' && r.realized ? dir(r.realized) : 'mute'}`}>{r.side === 'sell' && r.realized ? `${r.realized > 0 ? '+' : ''}${fmtMoney(r.realized)}` : '--'}</td>
      </tr>)}</tbody>
    </table></div>
  )
}

/** Top-holder groups (top 3, ranked by holdings on the server); "Create a group" if none */
function GroupsTab({ token }: { token: MarketToken }) {
  const nav = useNavigate()
  const [data, setData] = useState<TokenCommunities | null>(null)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let alive = true
    setFailed(false)
    api<TokenCommunities>(`/api/tokens/${encodeURIComponent(token.chain)}/${encodeURIComponent(token.address)}/communities`)
      .then((d) => { if (alive) setData(d) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [token.chain, token.address, retry])
  if (failed && !data) return <div className="tx-empty"><span>{t('社区加载失败')}</span><button type="button" className="tx-btn tx-btn-sm" onClick={() => setRetry((v) => v + 1)}><RefreshCw size={13} />{t('重试')}</button></div>
  if (!data) return <div className="tx-empty"><span className="tx-spin" aria-hidden="true" /></div>
  if (!data.top.length) return <div className="tx-empty"><span>{t('还没有 {symbol} 持有者聚集的群', { symbol: token.symbol })}</span><button type="button" className="tx-btn tx-btn-sm" onClick={() => nav('/groups', { state: { createFor: { chain: token.chain, address: token.address, symbol: token.symbol } } })}><Plus size={13} />{t('建一个群')}</button></div>
  return (
    <ul className="tx-grp-list">
      {data.top.slice(0, 3).map((g) => (
        <li key={g.id}><Link to={`/g/${g.id}`} className="tx-grp">
          <Avatar address={g.id} src={g.avatar} name={g.name} size={32} />
          <span className="tx-grp-name"><b>{g.name}{g.official === true && <OfficialBadge size={14} />}{g.gated && <Lock size={11} className="mute" />}</b>
            <small>{t('{n} 位成员', { n: g.memberCount })} · {t('{n} 位持有者', { n: g.holders })}</small></span>
          <span className="tx-num">{g.totalUsd > 0 ? fmtUsd(g.totalUsd, { compact: true }) : '--'}</span>
        </Link></li>
      ))}
    </ul>
  )
}

/** Related posts: public read-only API (viewable without a wallet), compact list on desktop, tap to open post details */
function PostsTab({ token, refreshKey }: { token: MarketToken; refreshKey: number }) {
  const [list, setList] = useState<Post[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let alive = true
    setFailed(false)
    api<Post[]>(`/api/posts?token=${encodeURIComponent(`${token.chain}:${token.address}`)}&limit=20`)
      .then((l) => { if (alive) setList(Array.isArray(l) ? l : []) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [token.chain, token.address, retry, refreshKey])
  if (failed && !list) return <div className="tx-empty"><span>{t('暂时无法加载动态')}</span><button type="button" className="tx-btn tx-btn-sm" onClick={() => setRetry((v) => v + 1)}><RefreshCw size={13} />{t('重试')}</button></div>
  if (!list) return <div className="tx-empty"><span className="tx-spin" aria-hidden="true" /></div>
  if (!list.length) return <div className="tx-empty"><MessageSquare size={20} aria-hidden="true" /><span>{t('还没有关于 {symbol} 的动态', { symbol: token.symbol })}</span></div>
  return (
    <ul className="tx-posts">
      {list.map((p) => {
        const img = postImages(p)[0]
        return (
          <li key={p.id}><Link to={`/post/${encodeURIComponent(p.id)}`} className="tx-post">
            <Avatar address={p.author} src={p.avatar} name={p.nickname} size={28} />
            <span className="tx-post-main">
              <span className="tx-post-meta"><b>{p.nickname || shortAddr(p.author)}</b><time dateTime={new Date(p.createdAt).toISOString()}>{timeAgo(p.createdAt)}</time></span>
              {p.text ? <span className="tx-post-text">{p.text}</span> : <span className="tx-post-text mute">{t('[图片]')}</span>}
              <span className="tx-post-foot">{t('{n} 赞', { n: p.likes })} · {t('{n} 评论', { n: p.comments || 0 })}</span>
            </span>
            {img && <img className="tx-post-img" src={absUrl(thumbOf(img), API_BASE)} alt="" loading="lazy" />}
          </Link></li>
        )
      })}
    </ul>
  )
}

function InfoTab({ token }: { token: MarketToken }) {
  const total = (token.buys24h ?? 0) + (token.sells24h ?? 0)
  const ratio = token.buys24h !== undefined && token.sells24h !== undefined && total > 0 ? token.buys24h / total * 100 : null
  const copy = (v: string) => copyText(v).then(() => toast.success(t('已复制'))).catch(() => toast.error(t('复制失败')))
  return (
    <div>
      <dl className="tx-info">
        <div><dt>{t('市值')}</dt><dd>{big(token.marketCap)}</dd></div>
        <div><dt>{t('完全稀释市值')}</dt><dd>{big(token.fdv)}</dd></div>
        <div><dt>{t('流动性')}</dt><dd>{big(token.liquidityUsd)}</dd></div>
        <div><dt>{t('24h 成交额')}</dt><dd>{big(token.volume24h)}</dd></div>
        {/* Change spans two columns (2026-09-30 goat: four numbers used to squeeze into one cell overlapping the trade count); trade count therefore moves to the next row */}
        <div className="tx-info-span2"><dt>{t('涨跌 5m / 1h / 6h / 24h')}</dt><dd>{[token.change5m, token.change1h, token.change6h, token.change24h].map((v, i) => <span key={i} className={v == null ? 'mute' : dir(v)}>{fmtPct(v)}</span>)}</dd></div>
        <div><dt>{t('24h 成交笔数（买 / 卖）')}</dt><dd>{total ? `${fmtAmount(token.buys24h, 0)} / ${fmtAmount(token.sells24h, 0)}` : '--'}</dd>
          {ratio !== null && <div className="tx-ratio" role="img" aria-label={t('24 小时成交笔数：买入 {buy}%，卖出 {sell}%', { buy: ratio.toFixed(0), sell: (100 - ratio).toFixed(0) })}><span style={{ width: `${ratio}%` }} /></div>}</div>
        <div><dt>{t('网络')}</dt><dd>{chainLabel(token.chain)}</dd></div>
        <div><dt>{t('合约地址')}</dt><dd><span className="tx-num tx-ca-red" title={token.address}>{shortAddr(token.address, 6)}</span><button type="button" className="tx-icon-btn" onClick={() => void copy(token.address)} aria-label={t('复制合约地址')}><Copy size={12} /></button></dd></div>
        {token.pairAddress && <div><dt>{t('交易对地址')}</dt><dd><span className="tx-num">{shortAddr(token.pairAddress, 6)}</span><button type="button" className="tx-icon-btn" onClick={() => void copy(token.pairAddress!)} aria-label={t('复制交易对地址')}><Copy size={12} /></button></dd></div>}
        <div><dt>{t('创建时间')}</dt><dd>{token.createdAt ? timeAgo(token.createdAt) : '--'}</dd></div>
      </dl>
      {token.description && <p className="tx-desc">{token.description}</p>}
    </div>
  )
}

/** Left column: watchlist / trending, searchable, collapsible into an icon rail. Tapping a row switches to that token */
function Rail({ current, folded, onFold }: { current: { chain: string; address: string }; folded: boolean; onFold: (v: boolean) => void }) {
  const favorites = useFavorites((s) => s.items)
  const { cache, put } = useMarket()
  const { feeds, load } = useDiscoverFeed()
  const [tab, setTab] = usePageState<'fav' | 'hot'>('desk.spot.rail', favorites.length ? 'fav' : 'hot', oneOf('fav', 'hot'))
  const [q, setQ] = useState('')
  // Search results (2026-09-30: official pinned, counterfeits hidden — see lib/market.ts rankSearch for rules)
  const [found, setFound] = useState<SearchResult | null>(null)
  const results = found?.tokens ?? null
  const [searching, setSearching] = useState(false)
  useEffect(() => { void load('market') }, [load])
  // Watchlist quotes: batched per chain, refreshed every 20 seconds
  useEffect(() => {
    if (!favorites.length) return
    let alive = true
    const run = async () => {
      const byChain = new Map<string, string[]>()
      favorites.forEach((f) => byChain.set(f.chain, [...(byChain.get(f.chain) || []), f.address]))
      const rs = await Promise.allSettled([...byChain].map(([c, a]) => getTokens(a, c)))
      if (alive) rs.forEach((r) => { if (r.status === 'fulfilled') put(r.value) })
    }
    void run()
    const id = setInterval(() => { if (!document.hidden) void run() }, 20_000)
    return () => { alive = false; clearInterval(id) }
  }, [favorites, put])
  useEffect(() => {
    const query = q.trim()
    if (!query) { setFound(null); setSearching(false); return }
    setSearching(true)
    let alive = true
    const id = setTimeout(() => { searchTokensGrouped(query).then((r) => { if (alive) { setFound(r); put(r.tokens) } }).catch(() => { if (alive) setFound({ tokens: [] }) }).finally(() => { if (alive) setSearching(false) }) }, 350)
    return () => { alive = false; clearTimeout(id) }
  }, [q, put])

  const market = feeds.market ?? EMPTY_FEED
  const list: MarketToken[] = useMemo(() => results ?? (tab === 'fav'
    ? favorites.map((f) => cache[marketKey(f.chain, f.address)] ?? { chain: f.chain, chainId: f.chainId, address: f.address, symbol: f.symbol, name: f.name, logo: f.logo || '', priceUsd: 0 } as MarketToken)
    : market.list.slice(0, 40)), [results, tab, favorites, cache, market.list])
  const isOn = (x: MarketToken) => x.chain === current.chain && sameAddr(x.address, current.address)
  const row = (x: MarketToken) => (
    <li key={`${x.chain}:${x.address}`}><Link to={tokenPath(x)} className={`tx-rail-row ${isOn(x) ? 'on' : ''}`} onPointerEnter={() => pre(x)} aria-current={isOn(x) ? 'page' : undefined}>
      <TokenLogo src={x.logo} symbol={x.symbol} size={22} chain={x.chain} address={x.address} />
      <span className="tx-rail-name"><b>{x.symbol}{x.official && <i className="tx-tag is-official">{t('官方')}</i>}{x.impostor && <i className="tx-tag is-fake">{t('非官方')}</i>}{x.fresh && <i className="tx-tag is-new" title={t('这个币的交易池 3 天内刚创建，风险较高')}>{t('新创建')}</i>}</b><small>{chainLabel(x.chain)}</small></span>
      {/* When 24h change is unavailable, show liquidity instead of a row of "--" */}
      <span className="tx-rail-px"><span>{x.priceUsd > 0 ? fmtUsd(x.priceUsd) : '--'}</span>{x.change24h == null
        ? <small className="mute">{x.liquidityUsd ? t('流动性 {v}', { v: fmtUsd(x.liquidityUsd, { compact: true }) }) : '--'}</small>
        : <small className={dir(x.change24h)}>{fmtPct(x.change24h)}</small>}</span>
    </Link></li>
  )

  if (folded) {
    return (
      <aside className="tx-panel tx-rail is-folded" aria-label={t('币种列表')}>
        <button type="button" className="tx-icon-btn" onClick={() => onFold(false)} aria-label={t('展开币种列表')} title={t('展开币种列表')}><PanelLeftOpen size={16} /></button>
        <div className="tx-rail-mini">
          {list.slice(0, 24).map((x) => <Link key={`${x.chain}:${x.address}`} to={tokenPath(x)} className={isOn(x) ? 'on' : ''} title={`${x.symbol} · ${chainLabel(x.chain)}`} aria-label={x.symbol} onPointerEnter={() => pre(x)}>
            <TokenLogo src={x.logo} symbol={x.symbol} size={20} chain={x.chain} address={x.address} />
          </Link>)}
        </div>
      </aside>
    )
  }
  return (
    <aside className="tx-panel tx-rail" aria-label={t('币种列表')}>
      <div className="tx-rail-top">
        <label className="tx-rail-search"><Search size={13} aria-hidden="true" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('搜索代币或合约地址')} aria-label={t('搜索代币')} spellCheck={false} /></label>
        <button type="button" className="tx-icon-btn" onClick={() => onFold(true)} aria-label={t('收起币种列表')} title={t('收起币种列表')}><PanelLeftClose size={16} /></button>
      </div>
      {!results && <div className="tx-tabs" role="tablist" aria-label={t('币种分类')}>
        <button type="button" role="tab" aria-selected={tab === 'fav'} className={`tx-tab ${tab === 'fav' ? 'on' : ''}`} onClick={() => setTab('fav')}>{t('自选')}{favorites.length > 0 && <small>{favorites.length}</small>}</button>
        <button type="button" role="tab" aria-selected={tab === 'hot'} className={`tx-tab ${tab === 'hot' ? 'on' : ''}`} onClick={() => setTab('hot')}>{t('热门')}</button>
      </div>}
      <div className="tx-rail-cols" aria-hidden="true"><span>{results ? t('搜索结果') : t('代币')}</span><span>{t('价格 / 24h')}</span></div>
      <ul className="tx-rail-list">
        {!list.length
          ? <li className="tx-rail-empty">{searching ? t('搜索中…') : results ? t('没有找到相关代币') : tab === 'fav' ? t('在代币头部点星标，就会出现在这里。') : market.error ? t('暂时无法加载行情') : t('加载中')}</li>
          : list.map(row)}
      </ul>
    </aside>
  )
}
