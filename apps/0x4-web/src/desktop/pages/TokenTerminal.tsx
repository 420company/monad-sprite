// 网页版「现货」交易终端（2026-09-29 goat 第三轮：整体排版很奇怪；币名改正常字体；支付资产弹出手机全高弹层；点买入没反应；
// BTCB 那里「K 线加载失败，重试」和「暂无历史 K 线」同时出现）。参考 Backpack 现货 + Jupiter 兑换面板，一屏放下、整页不滚、各面板自己滚：
//   左：市场列表 260（搜索、自选 / 热门，可收起成一条图标栏）
//   中：代币头（图标、符号、链、价格、24h 统计、收藏 / 复制地址 / 区块浏览器）→ K 线（开高低收，状态只显示一个）→ 页签面板
//       （我的持仓 / 我的成交 / 持币最多的群 / 相关动态 / 代币信息）
//   右：买卖面板 340（desktop/trade/SpotOrderForm：和手机买卖弹层同一份逻辑，支付资产是下拉面板，按钮永远能点、不能下单时说原因）
// /token/:chain/:address 与 /spot 都是这一页。数据全部来自现有接口，失败显示空状态，不放假数据。
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
/** 金额类统计：数据商给 0 表示没有这项数据，显示 -- 而不是 $0.00 */
const big = (n?: number) => (n && n > 0 ? fmtUsd(n, { compact: true }) : '--')
const tokenPath = (x: { chain: string; address: string }) => `/token/${x.chain}/${x.address}`
const pre = (x: MarketToken) => { if (x.pairAddress) prefetchDexCandles({ chain: x.chain, address: x.address, pairAddress: x.pairAddress, interval: '1h' }) }
const chainLabel = (chain: string) => chainByDexKey(chain)?.name || chain
const RAIL_KEY = '0x4.desk.spotRailFolded'

/** /spot：没指定币时打开上次看的，没有就打开第一个自选 */
export function DeskSpot() {
  const favorites = useFavorites((s) => s.items)
  let last = ''
  try { last = sessionStorage.getItem('0x4.desk.lastToken') || '' } catch { /* 隐私模式 */ }
  const to = last || (favorites[0] ? tokenPath(favorites[0]) : '/token/bsc/0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c')
  return <Navigate to={to} replace />
}

/** 一个币的行情：进来拉一次，之后 15 秒刷新（和手机币详情同一个接口）。现货页和行情页的弹窗共用 */
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
  // 左栏收起：每个浏览器自己记（存不了就每次展开）
  const [folded, setFolded] = useState(() => { try { return localStorage.getItem(RAIL_KEY) === '1' } catch { return false } })
  const fold = (v: boolean) => { setFolded(v); try { localStorage.setItem(RAIL_KEY, v ? '1' : '0') } catch { /* 无痕模式 */ } }

  useEffect(() => { try { sessionStorage.setItem('0x4.desk.lastToken', `/token/${chain}/${address}`) } catch { /* 隐私模式 */ } }, [chain, address])

  return (
    <div className={`tx-term tx-spot ${folded ? 'is-folded' : ''}`}>
      <Rail current={{ chain, address }} folded={folded} onFold={fold} />
      {token ? <Terminal key={`${chain}:${address}`} token={token} stale={state === 'error' || state === 'empty'} onRetry={retry} />
        : <QuoteState state={state} onRetry={retry} />}
    </div>
  )
}

/**
 * 行情页点一个币：在行情页上弹出这个币的交易窗口（2026-10-05 goat：「把行情和购买整理到一个页面里」）。
 * 内容和现货页右边三块一样（代币头 + K 线 + 页签 + 买卖面板），只是没有左边的市场列表；关掉回到原来的行情列表（筛选、滚动都还在）。
 * 只盖住中间的内容区（goat：「不要挡住左边的导航条」）：顶栏、空间外观左边的竖导航、底部状态栏都露在外面也能点，
 * 所以不用 <dialog> 的模态（模态会盖满整屏、背后全部不能点），按这几样的实际位置算出内容区，挂到 .desk 上（不挂在 .desk-main 里：它有 transform 时 fixed 会错位）。
 * 买卖面板自己再弹的窗口（确认、选资产）是模态 <dialog>，照样叠在最上面
 */
function contentArea(): { top: number; left: number; right: number; bottom: number } {
  const vw = window.innerWidth, vh = window.innerHeight
  const bar = document.querySelector('.desk-bar')?.getBoundingClientRect()
  const status = document.querySelector('.desk-status')?.getBoundingClientRect()
  const nav = document.querySelector('.desk-nav')?.getBoundingClientRect()
  // 空间外观：导航是左边竖着的一根（高比宽大），内容区从它右边开始；其它外观导航在顶栏里
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
    // 外观切换（空间 ↔ 其它）导航位置会变
    window.addEventListener('theme-change', re)
    const t0 = window.setTimeout(re, 60)
    return () => { window.removeEventListener('resize', re); window.removeEventListener('theme-change', re); clearTimeout(t0) }
  }, [])
  // Esc 关闭；买卖面板自己的确认窗口开着时，Esc 先关那个
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
    // 挂在 .desk 里（和顶栏、竖导航、状态栏同一层叠上下文，z-index 才比得过；挂 body 上会被外层的层叠上下文压在下面，遮罩挡住导航）
    document.querySelector('.desk') || document.body,
  )
}

function Terminal({ token, stale, onRetry }: { token: MarketToken; stale: boolean; onRetry: () => void }) {
  const connected = useWallet(isWalletConnected)
  // 连的是外部钱包、而且它没有 Solana（Phantom 以外的）
  const noSolana = useWallet((w) => w.kind === 'external' && !w.wallet)
  const [interval, setIval] = usePageState<DexInterval>('token.interval', '1h', oneOf('15m', '1h', '4h', '1d'))
  const [chartRetry, setChartRetry] = useState(0)
  const chart = useCandles(token, interval, chartRetry)
  const [side, setSide] = useState<Side>('buy')
  const [orderKey, setOrderKey] = useState(0)
  const chainInfo = chainById(token.chainId)

  // K 线状态四选一：没有交易对 / 数据商说不支持 → 无 K 线；还没开始或加载中 → 加载中；失败 → 失败 + 重试；拿到了 → 画图
  const status: ChartStatus = !token.pairAddress || chart.data?.supported === false ? 'unsupported'
    : chart.status === 'idle' || chart.status === 'loading' ? 'loading'
      : chart.status === 'error' ? 'error' : 'ready'
  const price = (n: number) => fmtUsd(n).replace('$', '')

  return (
    <>
      <TokenHead token={token} stale={stale} onRetry={onRetry} />
      <ChartPanel intervals={IVALS} interval={interval} onInterval={setIval} candles={chart.data?.candles ?? []} chartKey={`${token.chain}:${token.address}:${interval}`}
        status={status} asOf={chart.data?.asOf} onRetry={() => setChartRetry((v) => v + 1)} formatPrice={price}>
        {/* 问小精灵（2026-10-02）：现货只有 K 线本身（没有买卖力量、大单、仓位） */}
        <SpriteLook chartKey={`${token.chain}:${token.address}:${interval}`} getBrief={() => buildBrief({ market: 'spot', symbol: token.symbol, interval, candles: chart.data?.candles ?? [] })} />
      </ChartPanel>
      <aside className="tx-panel tx-order" aria-label={t('代币交易')}>
        <div className="tx-order-in">
          <div className="tx-side" role="group" aria-label={t('买入或卖出')}>
            {/* 切换买卖不重建面板（2026-09-29：原来每点一次整块重建，看着「闪一下」，填的数量也丢了）；数量在面板里按价值换算保留 */}
            <button type="button" aria-pressed={side === 'buy'} className={`is-up ${side === 'buy' ? 'on' : ''}`} onClick={() => setSide('buy')}>{t('买入')}</button>
            <button type="button" aria-pressed={side === 'sell'} className={`is-down ${side === 'sell' ? 'on' : ''}`} onClick={() => setSide('sell')}>{t('卖出')}</button>
          </div>
          {!chainInfo
            ? <div className="tx-empty is-tight"><span>{t('暂不支持在 {chain} 上交易', { chain: token.chain })}</span></div>
            // 外部钱包只有 EVM（MetaMask 等）买卖不了 Solana 上的币：一句话 + 获取 0x4 Wallet（2026-09-30）
            : noSolana && token.chainId === SOLANA_CHAIN_ID
              ? <div className="tx-empty is-tight tx-nosol"><span>{t('这个币在 Solana 上，用 0x4 Wallet 就能买卖')}</span><button type="button" className="tx-btn tx-btn-sm" onClick={getOx4Wallet}>{t('获取 0x4 Wallet')}</button></div>
              : <SpotOrderForm key={`${token.chain}:${token.address}:${orderKey}`} token={token} side={side} connected={connected} onDone={() => setOrderKey((k) => k + 1)} />}
        </div>
      </aside>
      <BottomTabs token={token} connected={connected} onBuy={() => setSide('buy')} />
    </>
  )
}

/** 代币头：图标、符号、链、收藏｜价格 + 24h｜统计｜复制地址、区块浏览器 */
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

/** 底部页签：我的持仓 / 我的成交 / 持币最多的群 / 相关动态 / 代币信息。固定高度，内容自己滚 */
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

/** 我的成交：服务器记的最近 50 笔交易里挑出这个币的（公开接口，只读） */
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

/** 持币最多的群（前 3，服务器按持仓排名）；没有就给「建一个群」 */
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

/** 相关动态：公开接口只读（没连钱包也能看），电脑端紧凑列表，点开进动态详情 */
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
        {/* 涨跌占两列（2026-09-30 goat：原来四个数挤在一格和成交笔数重叠）；成交笔数因此排到下一排 */}
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

/** 左栏：自选 / 热门，可搜，可收起成一条图标栏。点一行就切到那个币 */
function Rail({ current, folded, onFold }: { current: { chain: string; address: string }; folded: boolean; onFold: (v: boolean) => void }) {
  const favorites = useFavorites((s) => s.items)
  const { cache, put } = useMarket()
  const { feeds, load } = useDiscoverFeed()
  const [tab, setTab] = usePageState<'fav' | 'hot'>('desk.spot.rail', favorites.length ? 'fav' : 'hot', oneOf('fav', 'hot'))
  const [q, setQ] = useState('')
  // 搜索结果（2026-09-30：官方置顶、冒牌不显示，规则见 lib/market.ts rankSearch）
  const [found, setFound] = useState<SearchResult | null>(null)
  const results = found?.tokens ?? null
  const [searching, setSearching] = useState(false)
  useEffect(() => { void load('market') }, [load])
  // 自选报价：按链批量取，20 秒刷新
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
      {/* 24 小时涨跌拿不到时写流动性，不放一排「--」 */}
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
