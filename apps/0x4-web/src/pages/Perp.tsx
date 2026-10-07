// Perps trading page: BSC-native perps (Aster), gas all in BNB; orders signed by a locally-derived agent key, non-custodial
// Two layers (redone per design 2026-09-24):
//   /perp           Perps home: account card → my positions / open orders → coin list (with 24h mini sparklines)
//   /perp?coin=BTC  Trade page: price → chart → order form (side / cross-isolated / leverage / price / margin) → this coin's position
// Order, close, cancel, deposit/withdraw logic is identical to before the redo — only the UI changed.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowLeftRight, ChevronDown, ChevronRight, Search, SlidersHorizontal, Star } from 'lucide-react'
import Button from '@/components/Button'
import Sheet from '@/components/Sheet'
import { Input, Label } from '@/components/Field'
import { toast } from '@/components/Toast'
import { alertError } from '@/components/AlertDialog'
import { useWallet } from '@/store/wallet'
import { ensureUnlocked } from '@/lib/vault/gate'
import { useSettings } from '@/store/settings'
import { usePortfolio } from '@/store/portfolio'
import { chainName } from '@/lib/chains'
import { fmtAmount, fmtMoney, fmtUsd } from '@/lib/format'
import PerpChart from '@/components/PerpChart'
import { WEB_SURFACE } from '@/lib/surface'
import MiniTrend from '@/components/MiniTrend'
import { reportTrade } from '@/lib/trades'
import {
  BSC_CHAIN_ID, BSC_USDT, MIN_DEPOSIT, MIN_NOTIONAL,
  BNB_GAS_RESERVE, linkPerpReader, perpFeeRate, setPerpFeeRate, bscBnbBalance, bscUsdtBalance, cancelOrder, closePosition, depositBnb, depositUsdt, estimateWithdrawFee, loadAccount, loadFills, loadLeverageBrackets, loadMarkets, loadOpenOrders, placeOrder, withdrawUsdt,
  type PerpAccount, type PerpFill, type PerpMarket, type PerpOrder, type PerpPosition,
} from '@/lib/aster'
import { t } from '@/lib/i18n'
import { isString, oneOf, posInt, usePageState } from '@/lib/pageState'
import { useBack } from '@/lib/useBack'
import { useFees } from '@/lib/fees'
import { errorText, isUserCancel } from '@/lib/errors'
import { needWallet } from '@/desktop/walletGate'

const pct = (n: number) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`
const fmtPx = (n: number) => n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 1 }) : n >= 1 ? n.toFixed(2) : n.toPrecision(4)

export default function Perp() {
  // Fetch fee rates once on entering the perps page (VIP charged at 0.04%); re-render the fee display once loaded
  setPerpFeeRate(useFees((s) => s.fees.perpRate))
  useEffect(() => { useFees.getState().load() }, [])
  const nav = useNavigate()
  const { evmAccount, keysUnlocked } = useWallet()
  /** Wallet locked (native app allows locked browsing): reading the perps account also needs a signature, so don't read yet — wait until the user taps "Verify" */
  const [locked, setLocked] = useState(false)
  const { slippageBps } = useSettings()
  const [markets, setMarkets] = useState<PerpMarket[]>([])
  // With ?coin=BTC it's the trade page, without it's the coin-picker home (entering your own perp trade from the feed also carries coin, landing directly on the trade page)
  const [params, setParams] = useSearchParams()
  const coinParam = params.get('coin')?.toUpperCase() || null
  const coin = coinParam || 'BTC'
  /** When entering the trade page from the list, push a history entry (recorded in that entry's state, so leaving and coming back still recognizes it); going back calls nav(-1), restoring the list's category / scroll position as-is;
   *  Trade pages opened directly (feed, deep links) have none — going back replaces with the list and scrolls to top */
  const fromList = !!(useLocation().state as { fromList?: boolean } | null)?.fromList
  const openCoin = (c: string) => setParams({ coin: c }, { state: { fromList: true } })
  const backToList = () => { if (fromList) nav(-1); else { setParams({}, { replace: true }); window.scrollTo(0, 0) } }
  // Scrolling is managed by the global ScrollRestorer: entering the trade page (new entry) scrolls to top, going back to the list restores position (previously this scrolled to top unconditionally, yanking the list back to top on return)
  /** Back button top-left of perps home: go back if there is a previous page, direct deep links go to the asset home */
  const goBack = useBack('/')
  /** Coin list category, search term and shown-count are kept in session (lib/pageState): leaving the perps page and coming back restores them */
  const [listTab, setListTab] = usePageState<'hot' | 'gain' | 'lose' | 'fav'>('perp.tab', 'hot', oneOf('hot', 'gain', 'lose', 'fav'))
  /** Watchlist: stored on device. Key prefix 0x4.* */
  const [favs, setFavs] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('0x4.perpFav') || '[]') } catch { return [] } })
  const toggleFav = (c: string) => setFavs((cur) => {
    const next = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]
    try { localStorage.setItem('0x4.perpFav', JSON.stringify(next)) } catch { /* Failing to persist doesn't affect trading */ }
    return next
  })
  const [account, setAccount] = useState<PerpAccount | null>(null)
  const [orders, setOrders] = useState<PerpOrder[]>([])
  const [fills, setFills] = useState<PerpFill[]>([])
  const [picking, setPicking] = useState(false)
  const [q, setQ] = usePageState('perp.q', '', isString)
  /** The trade page's "switch coin" sheet keeps its own search term: separate from the list search, so picking a coin in the sheet doesn't clear the list's search */
  const [pickQ, setPickQ] = useState('')
  const [fund, setFund] = useState<'deposit' | 'withdraw' | null>(null)
  // Arriving from the sprite page's "Deposit USDT" (?fund=deposit): open the deposit sheet directly (2026-10-05 goat)
  useEffect(() => { if (params.get('fund') === 'deposit') { setFund('deposit'); const p = new URLSearchParams(params); p.delete('fund'); setParams(p, { replace: true }) } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [loadErr, setLoadErr] = useState<string | null>(null)

  // Form
  const [lev, setLev] = useState(5)
  /** Order amount. unit decides whether this number is "margin (USDT)" or "coin quantity".
   *  Changed 2026-09-24: previously it was the position value and users had to divide by leverage themselves to know how much margin they were putting in; now they enter the margin directly */
  const [amt, setAmt] = useState('')
  const [unit, setUnit] = useState<'margin' | 'coin'>('margin')
  /** Long / short: switched at the top, the order button changes color with it */
  const [side, setSide] = useState<'long' | 'short'>('long')
  /** Take-profit / stop-loss and reduce-only live under "Advanced", out of the way normally */
  const [showAdv, setShowAdv] = useState(false)
  /** Reduce-only: this order can only shrink the existing position, never open a reverse one. Fat-finger insurance */
  const [reduceOnly, setReduceOnly] = useState(false)
  /** Leverage / margin mode collapse into one top row, expanding on tap — that's how Binance saves space */
  const [type, setType] = useState<'market' | 'limit'>('market')
  /** Cross / isolated. Isolated by default: losses are locked to this position's margin and can't drag the rest of the account down.
   *  This used to be hardcoded to cross (isCross=true) with no user choice. */
  const [isCross, setIsCross] = useState(false)
  const [limitPx, setLimitPx] = useState('')
  const [tp, setTp] = useState('')
  const [sl, setSl] = useState('')
  const [busy, setBusy] = useState(false)
  /** Separate error for the account section; null means no account (normal state for new users) */
  const [accountErr, setAccountErr] = useState<string | null>(null)
  /** The exchange confirms this wallet hasn't opened a perps account yet (never deposited): normal state for new users */
  const [noAccount, setNoAccount] = useState(false)

  const market = useMemo(() => markets.find((m) => m.coin === coin) || markets[0], [markets, coin])
  const canTrade = !!evmAccount

  const refresh = useCallback(async () => {
    // Market data and account are fetched separately: new users have no exchange account yet, so the account API errors,
    // and market data must not go down with it (previously one Promise.all failed everything).
    let m: PerpMarket[] | null = null
    try {
      m = await loadMarkets()
      setMarkets(m)
      setLoadErr(null)
    } catch (e) {
      setLoadErr(errorText(e, t('连接失败')))
    }
    if (!evmAccount) return
    // Don't read while locked: reading the account needs the agent-key signature, and refreshing every 8s would pop verification repeatedly
    if (!keysUnlocked) { setLocked(true); return }
    setLocked(false)
    try {
      // The true leverage cap requires a signature to fetch (cached, requested once); once obtained it overrides loadMarkets' estimate so users can actually reach 100x / 200x
      const [a, o, f, br] = await Promise.all([
        loadAccount(evmAccount), loadOpenOrders(evmAccount), loadFills(evmAccount),
        loadLeverageBrackets(evmAccount).catch(() => ({} as Record<string, number>)),
      ])
      if (m) setMarkets(m.map((x) => br[x.coin] ? { ...x, maxLeverage: br[x.coin] } : x))
      setAccount(a); setOrders(o); setFills(f); setAccountErr(null); setNoAccount(false)
      // Account already opened: also authorize a read-only agent so manual perp fills count toward VIP volume (at most once per app open, in background)
      void linkPerpReader(evmAccount)
    } catch (e) {
      // Both of these mean "this wallet hasn't opened a perps account on the exchange yet" — normal for new users, not a failure:
      //   NO_AGENT = trading agent not yet authorized;
      //   Aster's private API returns "This function can only be used after deposit" for any wallet that never deposited
      //   (verified 2026-09-24 with a fresh wallet on a real device; previously this raw English string was shown to users as the error)
      const msg = errorText(e, t('读取失败'))
      const fresh = msg === 'NO_AGENT' || /only be used after deposit/i.test(msg)
      setNoAccount(fresh)
      setAccountErr(fresh ? null : msg)
      setAccount(null); setOrders([]); setFills([])
    }
  }, [evmAccount, keysUnlocked])

  useEffect(() => { refresh(); const t = window.setInterval(refresh, 8000); return () => window.clearInterval(t) }, [refresh])

  // When switching markets, only clamp leverage down if it exceeds that market's cap.
  // It used to clamp to min(cap, 20), so switching from BTC (40x) to another coin mysteriously dropped the user's leverage to 20.
  useEffect(() => { if (market && lev > market.maxLeverage) setLev(market.maxLeverage) }, [market]) // eslint-disable-line react-hooks/exhaustive-deps
  // If this market only supports isolated, flip the switch back to isolated so the UI doesn't disagree with the actual order
  useEffect(() => { if (market?.onlyIsolated && isCross) setIsCross(false) }, [market]) // eslint-disable-line react-hooks/exhaustive-deps
  // Leverage and margin mode are recorded per coin on the perps account, not per order.
  // With an open position, follow the position's actual settings; otherwise the UI shows 5x after refresh while the account is really 10x — mismatched.
  useEffect(() => {
    const pos = account?.positions.find((x) => x.coin === market?.coin)
    if (!pos) return
    setLev(pos.leverage)
    setIsCross(pos.isCross)
  }, [account, market?.coin]) // eslint-disable-line react-hooks/exhaustive-deps

  const price = type === 'limit' && Number(limitPx) > 0 ? Number(limitPx) : market?.markPx || 0
  // Internally everything is computed as "position value (USD)"; the input just shows a different unit: margin × leverage = position value
  const notional = unit === 'margin' ? (Number(amt) || 0) * lev : (Number(amt) || 0) * price
  const size = price > 0 ? notional / price : 0
  const margin = lev > 0 ? notional / lev : 0
  const free = account?.withdrawable || 0
  const maxNotional = free * lev
  /** Estimate liquidation price per side: the two-button layout shows both at once */
  const liqFor = (s: 'long' | 'short') =>
    price > 0 ? (s === 'long' ? price * (1 - 1 / lev + 0.005) : price * (1 + 1 / lev - 0.005)) : 0
  /** Position size as a percentage of the "max openable", slider and input bound two-way */
  const sizePct = maxNotional > 0 ? Math.min(100, (notional / maxNotional) * 100) : 0
  const setPct = (p: number) => {
    if (maxNotional <= 0) return setAmt('')
    const usdVal = (maxNotional * p) / 100
    setAmt(unit === 'margin' ? String(Math.floor((free * p) / 100 * 100) / 100) : price > 0 ? (usdVal / price).toFixed(market?.szDecimals ?? 4) : '')
  }
  /** When switching denomination units, convert the entered number so the user doesn't have to retype */
  const switchUnit = () => {
    const next = unit === 'margin' ? 'coin' : 'margin'
    if (notional > 0 && price > 0 && lev > 0) setAmt(next === 'margin' ? String(Math.floor((notional / lev) * 100) / 100) : (notional / price).toFixed(market?.szDecimals ?? 4))
    setUnit(next)
  }
  /** Leverage quick tiers are generated from the market cap, always including the cap itself.
   *  With a hardcoded [2,5,10,20]: BTC's 40x would be unreachable, and ATOM (5x cap) would only get two buttons. */
  const levSteps = useMemo(() => {
    const max = market?.maxLeverage || 1
    const raw = max >= 100 ? [5, 20, 50, max] : max >= 40 ? [2, 10, 20, max] : max >= 20 ? [2, 5, 10, max] : max >= 10 ? [2, 5, max] : max >= 5 ? [1, 2, 3, max] : [1, max]
    return [...new Set(raw)].filter((v) => v >= 1 && v <= max)
  }, [market])

  /**
   * Gate before perp order / close / cancel (incl. leverage change) (2026-09-29 Codex review cec2419 P1):
   * Perps use the exchange's trading key; once cached, signing orders no longer goes through the main wallet, so the gated signer won't pop verification on its own.
   * Mobile app: wallet locked → pop face / password verification; web: 0x4 browser extension not connected → pop the extension panel. User cancel returns false.
   */
  const perpGate = async (): Promise<boolean> => {
    if (WEB_SURFACE) return !needWallet()
    try { await ensureUnlocked(t('确认合约交易')); return true } catch (e) { if (isUserCancel(e)) return false; throw e }
  }

  /** Side is decided by the pressed button; no more global long/short switch */
  const submit = async (side: 'long' | 'short') => {
    if (!market) return
    if (!(await perpGate())) return
    if (!evmAccount) return toast.error(t('钱包已锁定'))
    if (!(notional >= MIN_NOTIONAL)) return toast.error(t('最少 ${min}', { min: MIN_NOTIONAL }))
    if (margin > (account?.withdrawable || 0) + 1e-6) return toast.error(t('保证金不够，先存入 USDT'))
    if (type === 'limit' && !(Number(limitPx) > 0)) return toast.error(t('填一个限价'))
    setBusy(true)
    try {
      // Leverage and margin mode are set along with the order (web: main order + TP/SL share one confirmation window in the extension; mobile app still sets leverage before ordering, as before)
      const r = await placeOrder(evmAccount, { market, leverage: lev, isCross, isBuy: side === 'long', size, limitPx: type === 'limit' ? Number(limitPx) : undefined, reduceOnly, slippageBps, takeProfit: Number(tp) > 0 ? Number(tp) : undefined, stopLoss: Number(sl) > 0 ? Number(sl) : undefined })
      if (r.resting) toast.success(t('已挂单，成交后会出现在持仓里'))
      else {
        const fv = { coin: market.coin, sz: fmtAmount(r.filledSz), px: fmtPx(r.avgPx) }
        toast.success(side === 'long' ? t('做多 {coin} 成交 {sz} @ {px}', fv) : t('做空 {coin} 成交 {sz} @ {px}', fv))
        // Trading is social: opening a position is recorded as a buy, long vs short distinguished by different markers
        reportTrade({ side: 'buy', chainId: -1, token: `${market.coin}:${side}`, symbol: `${market.coin} ${side === 'long' ? '多' : '空'} ${lev}x`, name: `${market.coin} 永续 · 开${side === 'long' ? '多' : '空'}`, realized: 0, qty: r.filledSz, usd: r.filledSz * r.avgPx, chainKey: 'hyperliquid' })
      }
      // TP / SL failed to attach: tell the user explicitly, keep the inputs so they can re-attach or close right away (review #10)
      const pf = r.protectionFailed || []
      if (pf.length) {
        toast.error(pf.length === 2 ? t('止盈和止损都没有挂上，这个仓位现在没有保护。请重新设置，或手动平仓') : pf[0] === 'sl' ? t('止损没有挂上，这个仓位现在没有止损保护。请重新设置，或手动平仓') : t('止盈没有挂上，请重新设置'))
        setAmt('')
      } else { setAmt(''); setTp(''); setSl('') }
      refresh()
    } catch (e) { alertError(e, t('下单失败')) } finally { setBusy(false) }
  }

  const close = async (p: PerpPosition) => {
    const m = markets.find((x) => x.coin === p.coin)
    if (!m || !evmAccount) return
    if (!confirm(p.isLong ? t('市价平掉 {coin} 多单？', { coin: p.coin }) : t('市价平掉 {coin} 空单？', { coin: p.coin }))) return
    if (!(await perpGate())) return
    try {
      const r = await closePosition(evmAccount, m, p, slippageBps)
      toast.success(t('已平仓 {coin}', { coin: p.coin }))
      reportTrade({ side: 'sell', realized: p.unrealizedPnl, chainId: -1, token: `${p.coin}:${p.isLong ? 'long' : 'short'}`, symbol: `${p.coin} ${p.isLong ? '多' : '空'} ${p.leverage}x`, name: `${p.coin} 永续 · 平${p.isLong ? '多' : '空'}`, qty: r.filledSz || p.size, usd: (r.filledSz || p.size) * (r.avgPx || m.markPx), chainKey: 'hyperliquid' })
      refresh()
    } catch (e) { alertError(e, t('平仓失败')) }
  }

  const cancel = async (o: PerpOrder) => {
    const m = markets.find((x) => x.coin === o.coin)
    if (!m || !evmAccount) return
    if (!(await perpGate())) return
    try { await cancelOrder(evmAccount, m, o.oid); toast.success(t('已撤单')); refresh() } catch (e) { alertError(e, t('撤单失败')) }
  }

  const unrealized = account?.positions.reduce((s, p) => s + p.unrealizedPnl, 0) ?? 0
  const needDeposit = !account || free <= 0
  const q2 = q.trim().toLowerCase()
  const listed = useMemo(() => {
    if (q2) return markets.filter((m) => m.coin.toLowerCase().includes(q2))
    if (listTab === 'fav') return markets.filter((m) => favs.includes(m.coin))
    if (listTab === 'gain') return [...markets].filter((m) => m.volume24h > 0).sort((a, b) => b.change24h - a.change24h)
    if (listTab === 'lose') return [...markets].filter((m) => m.volume24h > 0).sort((a, b) => a.change24h - b.change24h)
    return markets
  }, [markets, listTab, favs, q2])
  const filtered = markets.filter((m) => m.coin.toLowerCase().includes(pickQ.trim().toLowerCase()))
  // List pagination: show PAGE items first, "load more" at the bottom adds PAGE more each time; category / search change resets to page one
  const [shown, setShown] = usePageState('perp.shown', PAGE, posInt())
  const [pickShown, setPickShown] = useState(PAGE)
  // Category / search change resets to page one; the mount pass doesn't count (that count is restored from back-navigation state)
  const listSig = `${listTab}|${q2}`
  const lastListSig = useRef(listSig)
  useEffect(() => { if (lastListSig.current !== listSig) { lastListSig.current = listSig; setShown(PAGE) } }, [listSig, setShown])
  useEffect(() => { setPickShown(PAGE) }, [pickQ, picking])

  // ---------------- Coin-picker home ----------------
  if (!coinParam) return (
    <div className="pb-10" style={{ paddingTop: 'calc(env(safe-area-inset-top) + .75rem)' }}>
      <div className="flex items-center gap-1 px-3">
        <button onClick={goBack} className="icon-button" aria-label={t('返回')}><ArrowLeft size={20} /></button>
        <h1 className="text-[28px] font-bold tracking-tight">{t('合约')}</h1>
      </div>

      {/* Account */}
      <section className="mx-4 mt-3 rounded-[22px] p-[18px]" style={{ background: 'radial-gradient(120% 140% at 100% 0%, rgba(205,189,255,.10), transparent 55%), var(--color-card)' }} aria-label={t('合约账户')}>
        {/* 2026-09-28 goat: removed the "Perps account equity · USDT" small print above — the number already carries USDT */}
        <div className="text-[34px] font-bold leading-tight tracking-tight tabular-nums">{account ? money(account.accountValue) : '--'}<span className="ml-1 text-base font-semibold text-muted">USDT</span></div>
        {account && (
          <div className="mt-3 flex gap-6 text-xs text-muted">
            <div>{t('可用保证金')}<b className="mt-0.5 block text-sm font-semibold text-fg tabular-nums">{money(account.withdrawable)}</b></div>
            <div>{t('未实现盈亏')}<b className={`mt-0.5 block text-sm font-semibold tabular-nums ${unrealized > 0 ? 'text-up' : unrealized < 0 ? 'text-down' : 'text-fg'}`}>{signed(unrealized)}</b></div>
            <div>{t('占用')}<b className="mt-0.5 block text-sm font-semibold text-fg tabular-nums">{money(account.marginUsed)}</b></div>
          </div>
        )}
        {locked && !account && <p className="mt-2 text-xs text-muted" role="status">{t('钱包已锁定，验证后查看账户')}<button onClick={() => ensureUnlocked(t('查看合约账户')).catch(() => {})} className="ml-2 text-accent">{t('验证')}</button></p>}
        {!account && noAccount && <p className="mt-2 text-xs leading-relaxed text-muted" role="status">{t('合约账户未开启，转入 USDT 后自动开启。')}</p>}
        {account && account.accountValue === 0 && <p className="mt-2 text-xs text-muted">{t('还没有资金。点「存入」把 BNB Chain 上的 USDT 转进来，约 1–3 分钟到账。')}</p>}
        {accountErr && <p className="mt-2 text-xs text-warning" role="status">{account ? t('账户更新失败，以上为上次读取的数据。') : t('暂时无法读取账户：{err}', { err: accountErr })}<button onClick={refresh} className="ml-2 text-accent">{t('重试')}</button></p>}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <button onClick={() => setFund('deposit')} className="h-[42px] rounded-[14px] bg-accent text-[15px] font-semibold text-bg active:scale-[.98]">{t('存入')}</button>
          <button onClick={() => setFund('withdraw')} disabled={!account} className="h-[42px] rounded-[14px] bg-card2 text-[15px] font-semibold disabled:opacity-40 active:scale-[.98]">{t('提出')}</button>
        </div>
      </section>

      {/* My positions (shown only if any); tapping goes to that coin's trade page */}
      {!!account?.positions.length && <>
        <SectionTitle title={t('我的仓位')} note={t('{n} 个', { n: account.positions.length })} />
        <div className="mx-4 space-y-2">
          {account.positions.map((p) => (
            <button key={p.coin} onClick={() => openCoin(p.coin)} className="flex w-full items-center gap-3 rounded-[18px] bg-card px-4 py-3.5 text-left active:scale-[.99]">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[15px] font-semibold">{p.coin}<SideTag long={p.isLong} lev={p.leverage} cross={p.isCross} /></div>
                <div className="mt-0.5 text-xs text-muted tabular-nums">{t('开仓 {entry} · 强平 {liq}', { entry: pxOf(p.entryPx, p.coin), liq: p.liquidationPx ? pxOf(p.liquidationPx, p.coin) : '--' })}</div>
              </div>
              <div className={`ml-auto text-right tabular-nums ${p.unrealizedPnl >= 0 ? 'text-up' : 'text-down'}`}>
                <div className="text-[15px] font-bold">{signed(p.unrealizedPnl)}</div>
                <div className="text-xs">{pct(p.roe)}</div>
              </div>
              <ChevronRight size={16} className="shrink-0 text-muted" />
            </button>
          ))}
        </div>
      </>}

      {orders.length > 0 && <>
        <SectionTitle title={t('挂单')} note={t('{n} 笔', { n: orders.length })} />
        <OrderList orders={orders} onCancel={cancel} pxOf={pxOf} />
      </>}

      {/* Coin picker */}
      <SectionTitle title={t('选择币种')} note={loadErr ? t('行情暂不可用') : markets.length ? t('{n} 个合约', { n: markets.length }) : t('正在读取…')} />
      <div className="mx-4 flex h-10 items-center gap-2 rounded-[13px] bg-card px-3">
        <Search size={16} className="text-muted" />
        <input aria-label={t('搜索币种')} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('搜索币种')} className="w-full bg-transparent text-base outline-none placeholder:text-muted/70" />
      </div>
      {!q2 && (
        <div className="flex gap-1.5 px-4 pt-3 pb-1.5" role="tablist" aria-label={t('币种分类')}>
          {([['hot', t('热门')], ['gain', t('涨幅榜')], ['lose', t('跌幅榜')], ['fav', t('自选')]] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={listTab === k} onClick={() => setListTab(k)} className={`rounded-[10px] px-3 py-1.5 text-[13px] font-semibold ${listTab === k ? 'bg-card2 text-fg' : 'text-muted'}`}>{label}</button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-[1fr_70px_112px] px-5 py-1.5 text-[11px] text-muted/80"><span>{t('币种 / 成交额')}</span><span>{t('24h 走势')}</span><span className="text-right">{t('最新价 / 涨跌')}</span></div>
      <div role="list">
        {listed.slice(0, shown).map((m) => (
          <button key={m.coin} role="listitem" onClick={() => openCoin(m.coin)} className="grid w-full grid-cols-[1fr_70px_112px] items-center border-t border-line/60 px-5 py-[11px] text-left first:border-t-0 active:bg-card">
            <div className="flex min-w-0 items-center gap-2.5">
              <CoinBadge coin={m.coin} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[15px] font-semibold">{m.coin}<span className="rounded-[5px] bg-card2 px-1.5 py-px text-[10px] font-bold text-muted">{m.maxLeverage}x</span></div>
                <div className="mt-0.5 text-[11px] text-muted/80 tabular-nums">{fmtUsd(m.volume24h, { compact: true })}</div>
              </div>
            </div>
            <MiniTrend coin={m.coin} up={m.change24h >= 0} />
            <div className="text-right tabular-nums">
              <div className="text-sm font-semibold">{pxOf(m.markPx, m.coin)}</div>
              <ChangePill v={m.change24h} />
            </div>
          </button>
        ))}
        {!listed.length && <p className="px-5 py-8 text-center text-sm text-muted">{listTab === 'fav' && !q2 ? t('还没有自选。进入币种页点右上角的星标加入。') : t('没有匹配的合约')}</p>}
      </div>
      {listed.length > shown && (
        <div className="px-4 pt-3">
          <button onClick={() => setShown((n) => n + PAGE)} className="glass-lite h-11 w-full rounded-full text-sm font-semibold">{t('加载更多（还有 {n} 个）', { n: listed.length - shown })}</button>
        </div>
      )}

      <FundSheet mode={fund} onClose={() => { setFund(null); refresh() }} account={account} />
    </div>
  )

  // ---------------- Trade page ----------------
  const myPos = account?.positions.find((p) => p.coin === market?.coin)
  const myOrders = orders.filter((o) => o.coin === market?.coin)
  const myFills = fills.filter((f) => f.coin === market?.coin)
  const long = side === 'long'
  const levMax = market?.maxLeverage || 1
  const levPct = levMax > 1 ? ((lev - 1) / (levMax - 1)) * 100 : 100

  return (
    <div className="pb-10" style={{ paddingTop: 'calc(env(safe-area-inset-top) + .5rem)' }}>
      <div className="flex items-center gap-1 px-2">
        <button onClick={backToList} className="icon-button" aria-label={t('返回币种列表')}><ArrowLeft size={20} /></button>
        <button onClick={() => setPicking(true)} className="flex min-h-11 items-center gap-1.5 rounded-xl px-1 text-[17px] font-bold" aria-label={t('切换币种')}>
          {coin}-USDT<span className="rounded-md bg-card2 px-1.5 py-0.5 text-[11px] font-semibold text-muted">{t('永续')}</span><ChevronDown size={16} className="text-muted" />
        </button>
        <button onClick={() => toggleFav(coin)} className="icon-button ml-auto" aria-label={favs.includes(coin) ? t('取消自选') : t('加入自选')} aria-pressed={favs.includes(coin)}>
          <Star size={19} className={favs.includes(coin) ? 'fill-warning text-warning' : ''} />
        </button>
      </div>

      {!market && <div className="mx-4 mt-3 rounded-2xl bg-card p-4 text-sm text-muted" role="status">{loadErr ? t('暂时无法读取合约行情') : t('正在读取合约行情…')}</div>}

      {/* Web: price + chart + positions / orders / fills on the left, order panel on the right (stuck to top); mobile app keeps the top-bottom layout (display: contents doesn't affect layout) */}
      {market && <div className={WEB_SURFACE ? 'perp-desk' : 'contents'}>
        <div className="flex items-end justify-between px-5 pt-1">
          <div className={`text-[32px] font-bold leading-tight tracking-tight tabular-nums ${market.change24h >= 0 ? 'text-up' : 'text-down'}`}>{pxOf(market.markPx, market.coin)}</div>
          <div className="mb-1.5"><ChangePill v={market.change24h} /></div>
        </div>
        <div className="grid grid-cols-3 gap-1 px-5 pt-2 text-[11px] text-muted/80">
          <div>{t('24h 成交额')}<b className="mt-0.5 block text-xs font-semibold text-fg tabular-nums">{fmtUsd(market.volume24h, { compact: true })}</b></div>
          <div>{t('资金费率')}<b className="mt-0.5 block text-xs font-semibold text-warning tabular-nums">{(market.funding * 100).toFixed(4)}%</b></div>
          <div>{t('最高杠杆')}<b className="mt-0.5 block text-xs font-semibold text-fg tabular-nums">{market.maxLeverage}x</b></div>
        </div>

        {/* Candles. The chart should be the body of the trade page */}
        <PerpChart coin={market.coin} pxDecimals={market.pxDecimals} />

        {/* Order form */}
        <section className="perp-order mx-3 mt-3 rounded-[22px] bg-card p-3.5" aria-label={t('下单')}>
          <div className="grid grid-cols-2 rounded-[13px] bg-black/30 p-[3px]" role="group" aria-label={t('方向')}>
            <button aria-pressed={long} onClick={() => setSide('long')} className={`h-[38px] rounded-[10px] text-[15px] font-bold transition-colors ${long ? 'bg-up text-[#062418]' : 'text-muted'}`}>{t('做多')}</button>
            <button aria-pressed={!long} onClick={() => setSide('short')} className={`h-[38px] rounded-[10px] text-[15px] font-bold transition-colors ${!long ? 'bg-down text-white' : 'text-muted'}`}>{t('做空')}</button>
          </div>

          <div className="mt-3.5 flex items-center justify-between">
            <Seg value={isCross ? 'cross' : 'iso'} onChange={(v) => setIsCross(v === 'cross')} options={[['cross', t('全仓'), market.onlyIsolated], ['iso', t('逐仓'), false]]} label={t('保证金模式')} />
            <div className="rounded-[10px] bg-accent/10 px-3 py-1.5 text-sm font-bold text-accent tabular-nums" aria-live="polite">{lev}x</div>
          </div>
          {market.onlyIsolated && <p className="mt-1 text-[11px] text-muted">{t('{coin} 只支持逐仓。', { coin: market.coin })}</p>}

          {/* Leverage: slider + quick tiers (tiers generated from this coin's max leverage) */}
          <div className="relative mt-2.5 h-7">
            <div className="absolute inset-x-0 top-[12px] h-1 rounded-full bg-card2" />
            <div className="absolute left-0 top-[12px] h-1 rounded-full bg-accent" style={{ width: `${levPct}%` }} />
            <input aria-label={t('杠杆')} type="range" min={1} max={levMax} value={lev} onChange={(e) => setLev(Number(e.target.value))} className="lev-range absolute inset-0 w-full" />
          </div>
          <div className="flex justify-between">
            {levSteps.map((v) => <button key={v} onClick={() => setLev(v)} className={`min-h-8 rounded-lg px-1.5 text-[11px] font-semibold tabular-nums ${lev === v ? 'text-accent' : 'text-muted'}`}>{v}x</button>)}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <Seg value={type} onChange={(v) => setType(v as 'market' | 'limit')} options={[['market', t('市价'), false], ['limit', t('限价'), false]]} label={t('订单类型')} />
            <span className="text-xs text-muted">{t('可用')} <b className="font-semibold text-fg tabular-nums">{account ? money(free) : '--'}</b> USDT</span>
          </div>

          {/* Numeric inputs explicitly use 16px to prevent iOS auto-zoom on focus */}
          <label className="mt-3 flex h-12 items-center gap-2.5 rounded-[13px] bg-black/30 px-3.5">
            <span className="w-11 shrink-0 text-xs text-muted">{t('价格')}</span>
            {type === 'limit'
              ? <input id="perp-limit" aria-label={t('限价')} className="w-full bg-transparent text-base font-semibold outline-none tabular-nums placeholder:font-normal placeholder:text-muted/70" type="number" inputMode="decimal" value={limitPx} onChange={(e) => setLimitPx(e.target.value)} placeholder={pxOf(market.markPx, market.coin)} />
              : <span className="text-base text-muted/80">{t('以市价成交')}</span>}
          </label>
          <label className="mt-2 flex h-12 items-center gap-2.5 rounded-[13px] bg-black/30 px-3.5">
            <span className="w-11 shrink-0 text-xs text-muted">{unit === 'margin' ? t('保证金') : t('数量')}</span>
            <input aria-label={unit === 'margin' ? t('保证金（USDT）') : t('数量（{coin}）', { coin: market.coin })} className="w-full bg-transparent text-base font-semibold outline-none tabular-nums placeholder:font-normal placeholder:text-muted/70" type="number" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder={unit === 'margin' ? '0' : '0.001'} />
            <button type="button" onClick={switchUnit} className="flex shrink-0 items-center gap-1 rounded-lg bg-card2 px-2 py-1 text-xs font-semibold text-muted" aria-label={t('切换输入单位')}>
              {unit === 'margin' ? 'USDT' : market.coin}<ArrowLeftRight size={11} />
            </button>
          </label>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {[10, 25, 50, 100].map((r) => <button key={r} onClick={() => setPct(r)} disabled={maxNotional <= 0} className={`h-[30px] rounded-[9px] text-xs font-semibold disabled:opacity-40 ${Math.round(sizePct) === r ? 'bg-card2 text-fg' : 'bg-black/30 text-muted'}`}>{r}%</button>)}
          </div>

          {notional > 0 && notional < MIN_NOTIONAL && <p className="mt-2 text-[11px] text-down">{t('仓位价值最少 ${min}，交易所会拒掉更小的单。', { min: MIN_NOTIONAL })}</p>}
          {account && maxNotional > 0 && maxNotional < MIN_NOTIONAL && (
            <p className="mt-2 text-[11px] text-down">{t('可用保证金只剩 {free}，{lev}x 下最多开 {max}，不够最低的 ${min}。先平掉已有仓位，或者存入更多 USDT。', { free: money(free), lev, max: fmtMoney(maxNotional), min: MIN_NOTIONAL })}</p>
          )}

          {/* Advanced: TP/SL, reduce-only */}
          <button type="button" onClick={() => setShowAdv((v) => !v)} aria-expanded={showAdv} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-muted">
            <SlidersHorizontal size={13} />{t('止盈止损 · 只减仓')}{(tp || sl || reduceOnly) && <span className="size-1.5 rounded-full bg-accent" />}<ChevronDown size={13} className={`transition-transform ${showAdv ? 'rotate-180' : ''}`} />
          </button>
          {showAdv && (
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="flex h-11 items-center gap-2 rounded-[12px] bg-black/30 px-3"><span className="shrink-0 text-xs text-muted">{t('止盈')}</span><input id="perp-tp" aria-label={t('止盈触发价')} className="w-full bg-transparent text-base outline-none tabular-nums placeholder:text-muted/60" type="number" inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} placeholder={t('触发价')} /></label>
                <label className="flex h-11 items-center gap-2 rounded-[12px] bg-black/30 px-3"><span className="shrink-0 text-xs text-muted">{t('止损')}</span><input id="perp-sl" aria-label={t('止损触发价')} className="w-full bg-transparent text-base outline-none tabular-nums placeholder:text-muted/60" type="number" inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} placeholder={t('触发价')} /></label>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={reduceOnly} onChange={(e) => setReduceOnly(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
                {t('只减仓（这笔单只会减少现有仓位，不会反向开新仓）')}
              </label>
            </div>
          )}

          <dl className="mt-3 space-y-[7px] text-xs">
            <Row k={t('仓位价值')} v={notional ? `${money(notional)} USDT` : '--'} />
            <Row k={t('数量')} v={size ? `${fmtAmount(size)} ${market.coin}` : '--'} />
            <Row k={t('预估强平价')} v={notional ? pxOf(liqFor(side), market.coin) : '--'} warn />
            {/* Show only the combined fee rate (goat 2026-09-25: don't split exchange / platform). Market = exchange taker 0.04% + platform 0.06% = 0.1%; limit maker exchange 0%, combined 0.06% */}
            <Row k={t('手续费（{rate}%）', { rate: feeRate(type) * 100 })} v={notional ? `${money(notional * feeRate(type))} USDT` : '--'} />
            <Row k={t('下单后剩余保证金')} v={margin ? `${money(Math.max(0, free - margin))} USDT` : '--'} />
          </dl>

          {!evmAccount
            ? <button disabled className="mt-3.5 h-[52px] w-full rounded-2xl bg-card2 text-base font-bold text-muted">{t('钱包已锁定')}</button>
            : needDeposit
              ? <button onClick={() => setFund('deposit')} className="mt-3.5 h-[52px] w-full rounded-2xl bg-accent text-base font-bold text-bg active:scale-[.99]">{t('存入 USDT')}</button>
              : <Button size="lg" loading={busy} disabled={!notional} onClick={() => submit(side)}
                  className={`mt-3.5 !h-[52px] w-full !rounded-2xl !text-base !font-bold ${long ? '!bg-up !text-[#062418]' : '!bg-down !text-white'}`}>
                  {long ? t('开多') : t('开空')} · {lev}x{size ? ` · ${fmtAmount(size)} ${market.coin}` : ''}
                </Button>}
        </section>

        {/* This coin's position */}
        {myPos && <>
          <SectionTitle title={t('当前仓位')} note={market.coin} />
          <div className="mx-3 rounded-[18px] bg-card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold">{myPos.coin}<SideTag long={myPos.isLong} lev={myPos.leverage} cross={myPos.isCross} /></div>
              <div className={`text-right font-bold tabular-nums ${myPos.unrealizedPnl >= 0 ? 'text-up' : 'text-down'}`}>{signed(myPos.unrealizedPnl)}<span className="ml-1 text-xs font-medium">{pct(myPos.roe)}</span></div>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-[11px] text-muted">
              <div>{t('数量')}<div className="mt-0.5 text-xs text-fg tabular-nums">{fmtAmount(myPos.size)}</div></div>
              <div>{t('开仓价')}<div className="mt-0.5 text-xs text-fg tabular-nums">{pxOf(myPos.entryPx, myPos.coin)}</div></div>
              <div>{t('标记价')}<div className="mt-0.5 text-xs text-fg tabular-nums">{pxOf(market.markPx, market.coin)}</div></div>
              <div>{t('强平价')}<div className="mt-0.5 text-xs text-warning tabular-nums">{myPos.liquidationPx ? pxOf(myPos.liquidationPx, myPos.coin) : '--'}</div></div>
            </div>
            <Button size="sm" variant="secondary" className="mt-3 w-full" disabled={!canTrade} onClick={() => close(myPos)}>{t('市价平仓')}</Button>
          </div>
        </>}

        {myOrders.length > 0 && <>
          <SectionTitle title={t('挂单')} note={t('{n} 笔', { n: myOrders.length })} />
          <OrderList orders={myOrders} onCancel={cancel} pxOf={pxOf} />
        </>}

        {myFills.length > 0 && <>
          <SectionTitle title={t('最近成交')} />
          <div className="mx-3 divide-y divide-line/60 overflow-hidden rounded-[18px] bg-card">
            {myFills.slice(0, 10).map((f, i) => (
              <div key={f.hash + i} className="flex items-center gap-3 px-4 py-2.5 text-sm tabular-nums">
                <span className="text-xs text-muted">{f.dir}</span>
                <span className="ml-auto text-muted">{fmtAmount(f.sz)} @ {pxOf(f.px, f.coin)}</span>
                {f.closedPnl !== 0 && <span className={`text-xs ${f.closedPnl >= 0 ? 'text-up' : 'text-down'}`}>{signed(f.closedPnl)}</span>}
              </div>
            ))}
          </div>
        </>}
      </div>}


      {/* Switch coin */}
      <Sheet open={picking} onClose={() => setPicking(false)} title={t('切换币种')}>
        <div className="flex items-center gap-2 rounded-2xl bg-card2 px-3 py-2"><Search size={16} className="text-muted" /><input aria-label={t('搜索合约')} value={pickQ} onChange={(e) => setPickQ(e.target.value)} placeholder={t('搜索 BTC / SOL / WIF…')} className="w-full bg-transparent text-base outline-none" /></div>
        <div className="mt-2">
          {!filtered.length && <p className="py-6 text-center text-sm text-muted">{t('没有匹配的合约')}</p>}
          {filtered.slice(0, pickShown).map((m) => (
            <button key={m.coin} onClick={() => { setParams({ coin: m.coin }, { replace: true, state: fromList ? { fromList: true } : undefined }); setPicking(false); setPickQ('') }} className="flex w-full items-center gap-3 py-2.5 text-left">
              <CoinBadge coin={m.coin} />
              <div className="flex-1"><div className="font-semibold">{m.coin}<span className="ml-1 text-[11px] text-muted">{m.maxLeverage}x</span></div><div className="text-[11px] text-muted">{t('24h 成交 {v}', { v: fmtUsd(m.volume24h, { compact: true }) })}</div></div>
              <div className="text-right tabular-nums"><div className="text-sm">{pxOf(m.markPx, m.coin)}</div><ChangePill v={m.change24h} /></div>
            </button>
          ))}
          {filtered.length > pickShown && (
            <button onClick={() => setPickShown((n) => n + PAGE)} className="glass-lite mt-2 h-11 w-full rounded-full text-sm font-semibold">{t('加载更多（还有 {n} 个）', { n: filtered.length - pickShown })}</button>
          )}
        </div>
      </Sheet>

      <FundSheet mode={fund} onClose={() => { setFund(null); refresh() }} account={account} />
    </div>
  )

  /** Display per this coin's price precision (a small coin at 0.0043540 must not show as 0.00) */
  function pxOf(n: number, c: string) {
    const d = markets.find((x) => x.coin === c)?.pxDecimals
    if (!(n > 0)) return '--'
    if (n >= 1000 || d === undefined) return fmtPx(n)
    // Prices above 100 only need 2 decimals (SOL 114.74, not 114.7400); small coins show full exchange precision
    const digits = Math.min(d, 8, n >= 100 ? 2 : n >= 1 ? 4 : 8)
    return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  }
}

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${money(Math.abs(n))}`

function SectionTitle({ title, note }: { title: string; note?: string }) {
  return <div className="flex items-baseline justify-between px-5 pt-6 pb-2.5"><h2 className="text-[17px] font-semibold">{title}</h2>{note && <span className="text-xs text-muted/80">{note}</span>}</div>
}

function ChangePill({ v }: { v: number }) {
  return <span className={`mt-0.5 inline-block min-w-[62px] rounded-md px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums ${v >= 0 ? 'bg-up/12 text-up' : 'bg-down/12 text-down'}`}>{pct(v)}</span>
}

function SideTag({ long, lev, cross }: { long: boolean; lev: number; cross: boolean }) {
  return <span className={`rounded-[7px] px-1.5 py-0.5 text-[11px] font-bold ${long ? 'bg-up/14 text-up' : 'bg-down/14 text-down'}`}>{long ? t('多') : t('空')} {lev}x{cross ? '' : ` ${t('逐仓')}`}</span>
}

/** Coin round badge: no reliable icon source, so use initial + fixed color — same coin always the same color */
const BRAND: Record<string, string> = { BTC: '#f7931a', ETH: '#627eea', BNB: '#f3ba2f', SOL: '#14f195', XRP: '#9aa4ad', DOGE: '#c2a633', ASTER: '#8cff4d' }
/** Perp coin icons (2026-09-25 goat: previously only letter placeholders, no icons).
 *  Try in order: Binance icon repo → OKX → Hyperliquid → CoinCap → letter placeholder. Tested 2026-09-26 against Aster's 567 perps:
 *  Binance 285, OKX 160, Hyperliquid 4, CoinCap 15 — 82% have images; the rest are mostly stocks, Chinese-name memes and very obscure coins, showing letter placeholders.
 *  Aster's leveraged "1000PEPE"-style contracts strip the multiplier prefix before lookup; when a source returns 403/404 or an HTML page, the failed img automatically falls through to the next */
function coinIconUrls(coin: string): string[] {
  const base = coin.replace(/^(1000000|10000|1000|1M|K)(?=[A-Z])/, '')
  const names = [...new Set([coin, base])]
  return [
    ...names.map((n) => `https://bin.bnbstatic.com/static/assets/logos/${n}.png`),
    ...names.map((n) => `https://static.okx.com/cdn/oksupport/asset/currency/icon/${n.toLowerCase()}.png`),
    ...names.map((n) => `https://app.hyperliquid.xyz/coins/${n}.svg`),
    ...names.map((n) => `https://assets.coincap.io/assets/icons/${n.toLowerCase()}@2x.png`),
  ]
}
function CoinBadge({ coin }: { coin: string }) {
  const urls = useMemo(() => coinIconUrls(coin), [coin])
  const [i, setI] = useState(0)
  useEffect(() => setI(0), [coin])
  if (i < urls.length) return <img src={urls[i]} alt="" aria-hidden="true" loading="lazy" className="size-8 shrink-0 rounded-full bg-card2 object-cover" onError={() => setI((n) => n + 1)} />
  let h = 0
  for (const ch of coin) h = (h * 31 + ch.charCodeAt(0)) % 360
  const color = BRAND[coin] || `hsl(${h} 55% 62%)`
  return <span className="grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-bold" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }} aria-hidden="true">{coin.slice(0, 2)}</span>
}

function Seg({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: [string, string, boolean][]; label: string }) {
  return (
    <div className="flex rounded-[10px] bg-black/30 p-[3px]" role="group" aria-label={label}>
      {options.map(([k, text, disabled]) => (
        <button key={k} aria-pressed={value === k} disabled={disabled} onClick={() => onChange(k)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${value === k ? 'bg-card2 text-fg' : 'text-muted'}`}>{text}</button>
      ))}
    </div>
  )
}

function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return <div className="flex justify-between gap-3 text-muted/80"><dt>{k}</dt><dd className={`font-semibold tabular-nums ${warn && v !== '--' ? 'text-warning' : 'text-fg'}`}>{v}</dd></div>
}

function OrderList({ orders, onCancel, pxOf }: { orders: PerpOrder[]; onCancel: (o: PerpOrder) => void; pxOf: (n: number, c: string) => string }) {
  return (
    <div className="mx-4 divide-y divide-line/60 overflow-hidden rounded-[18px] bg-card">
      {orders.map((o) => (
        <div key={o.oid} className="flex items-center gap-3 px-4 py-3 text-sm tabular-nums">
          <span className="font-semibold">{o.coin}</span>
          <span className={o.isBuy ? 'text-up' : 'text-down'}>{o.isBuy ? t('买') : t('卖')}{o.trigger && o.trigger !== 'Limit' ? ` · ${o.trigger}` : ''}</span>
          <span className="ml-auto text-muted">{fmtAmount(o.size)} @ {pxOf(o.limitPx, o.coin)}</span>
          <button onClick={() => onCancel(o)} className="min-h-9 px-1 text-xs font-semibold text-accent">{t('撤单')}</button>
        </div>
      ))}
    </div>
  )
}

/** Replace {chain} in copy with bolded BNB Chain (translate the whole sentence together, keep the bold) */
function boldChain(s: string) {
  const [a, b = ''] = s.split('{chain}')
  return <>{a}<b>BNB Chain</b>{b}</>
}

/** Perps list page size */
const PAGE = 20

/** Combined fee rate: exchange taker 0.04% (maker 0) + platform builder fee. toFixed trims float dust */
// What the user pays in total: Aster taker 0.04% (maker 0) + our builder fee (regular 0.06% / VIP 0.04%, pushed by server)
const feeRate = (type: string) => Number(((type === 'market' ? 0.0004 : 0) + perpFeeRate()).toFixed(6))

/** Deposit / withdraw: both via USDT on BNB Chain, gas in BNB */
function FundSheet({ mode, onClose, account }: { mode: 'deposit' | 'withdraw' | null; onClose: () => void; account: PerpAccount | null }) {
  const { evmAddress, evmAccount } = useWallet()
  const nav = useNavigate()
  const holdings = usePortfolio((s) => s.holdings)
  // Dollar stables on other chains (USDT / USDC, plus USDG / USDe on the Robinhood chain) or USDC on BSC: one-tap flash-swap into BSC USDT
  // (LI.FI tested Robinhood USDG → BSC USDT via Symbiosis, ~40s to arrive, 2026-09-25)
  const others = holdings.filter((h) => ['USDT', 'USDC', 'USDG', 'USDE'].includes(h.symbol.toUpperCase()) && !(h.chainId === BSC_CHAIN_ID && h.symbol.toUpperCase() === 'USDT') && h.amount >= 1)
  const [fee, setFee] = useState<number | null>(null)
  const [phase, setPhase] = useState('')
  const [amount, setAmount] = useState('')
  const [bal, setBal] = useState<number | null>(null)
  /** Which coin to deposit with: USDT deposits directly; BNB auto-swaps to USDT first */
  const [asset, setAsset] = useState<'USDT' | 'BNB'>('USDT')
  const [bnbBal, setBnbBal] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (mode === 'deposit' && evmAddress) { bscUsdtBalance(evmAddress).then(setBal); bscBnbBalance(evmAddress).then(setBnbBal) } if (mode === 'withdraw') estimateWithdrawFee().then(setFee); if (!mode) { setAmount(''); setPhase(''); setAsset('USDT') } }, [mode, evmAddress])
  const n = Number(amount) || 0
  const go = async () => {
    if (!evmAccount) return toast.error(t('钱包已锁定'))
    setBusy(true)
    try {
      if (mode === 'deposit' && asset === 'BNB') { await depositBnb(evmAccount, n, setPhase); toast.success(t('已把 {n} BNB 换成 USDT 存入，约 1–3 分钟到账', { n })) }
      else if (mode === 'deposit') { setPhase(t('正在签名…')); await depositUsdt(evmAccount, n, () => setPhase(t('第 1 步：授权 USDT（钱包签名）'))); toast.success(t('已存入 {n} USDT，约 1–3 分钟到账', { n })) }
      else { await withdrawUsdt(evmAccount, n); toast.success(t('已提出，几分钟内到账 BNB Chain')) }
      onClose()
    } catch (e) { alertError(e, mode === 'deposit' ? t('存入失败') : t('提出失败')) } finally { setBusy(false) }
  }
  return (
    <Sheet open={!!mode} onClose={onClose} title={mode === 'deposit' ? t('存入 USDT') : t('提出 USDT')}>
      {mode === 'deposit' ? (
        <>
          <div className="flex rounded-lg bg-card2 p-0.5" role="group" aria-label={t('存入币种')}>
            {(['USDT', 'BNB'] as const).map((a) => <button key={a} aria-pressed={asset === a} onClick={() => { setAsset(a); setAmount('') }} className={`min-h-10 flex-1 rounded-md text-sm font-semibold ${asset === a ? 'bg-accent text-bg' : 'text-muted'}`}>{a}</button>)}
          </div>
          <p className="mt-3 text-xs text-muted">{asset === 'USDT' ? boldChain(t('用钱包里 {chain} 上的 USDT 存入合约账户，最少 {min} USDT，约 1–3 分钟到账。手续费用 BNB 支付（约 $0.05）。', { min: MIN_DEPOSIT })) : <>{t('你的 BNB 会按当前价格换成 USDT，存进合约账户。之后保证金一直按 USDT 计算，BNB 涨跌不会影响它。')}<br />{t('过程中需要在钱包里确认 2 到 3 次，请留 {n} BNB 作为网络手续费。', { n: BNB_GAS_RESERVE })}</>}</p>
          <div className="mt-3"><Label htmlFor="perp-fund">{t('金额（{asset}）', { asset })}</Label><Input id="perp-fund" className="text-base" type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={asset === 'USDT' ? '100' : '0.1'} autoFocus /></div>
          <div className="mt-1 flex items-center justify-between text-xs text-muted"><span>{t('BNB Chain 余额 {v}', { v: asset === 'USDT' ? `${bal === null ? '--' : fmtAmount(bal)} USDT` : `${bnbBal === null ? '--' : fmtAmount(bnbBal)} BNB` })}</span>{((asset === 'USDT' && bal !== null && bal > 0) || (asset === 'BNB' && bnbBal !== null && bnbBal > BNB_GAS_RESERVE)) && <button onClick={() => setAmount(asset === 'USDT' ? String(Math.floor((bal || 0) * 100) / 100) : String(Math.floor(((bnbBal || 0) - BNB_GAS_RESERVE) * 10000) / 10000))} className="text-accent">{t('全部')}</button>}</div>
          {asset === 'USDT' && others.map((h) => <button key={`${h.chainId}:${h.mint}`} onClick={() => nav(`/swap?from=${h.chainId}:${h.mint}&to=${BSC_CHAIN_ID}:${BSC_USDT}`)} className="mt-3 flex w-full items-center justify-between rounded-xl border border-line px-3 py-2.5 text-sm"><span className="text-muted">{t('{chain} 上有 {amount} {symbol}', { chain: chainName(h.chainId), amount: fmtAmount(h.amount), symbol: h.symbol })}</span><span className="font-semibold text-accent">{t('闪兑成 BNB Chain USDT')}</span></button>)}
          {asset === 'USDT' && bal !== null && bal < MIN_DEPOSIT && !others.length && <Button variant="secondary" className="mt-3 w-full" onClick={() => nav(`/swap?to=${BSC_CHAIN_ID}:${BSC_USDT}`)}>{t('闪兑')}</Button>}
          {phase && <p className="mt-2 text-xs text-muted" role="status">{phase}</p>}
          <Button size="lg" className="mt-3 w-full" loading={busy} disabled={asset === 'USDT' ? !(n >= MIN_DEPOSIT) : !(n > 0)} onClick={go}>{asset === 'USDT' ? t('存入 {amount}', { amount: n ? `${n} USDT` : '' }) : t('换成 USDT 并存入 {amount}', { amount: n ? `${n} BNB` : '' })}</Button>
        </>
      ) : (
        <>
          <p className="text-xs text-muted">{boldChain(t('提回你钱包的 {chain} 地址，手续费约 {fee} USDT（按当时网络费估算），几分钟内到账。', { fee: fee === null ? '--' : fee }))}</p>
          <div className="mt-3"><Label htmlFor="perp-fund">{t('金额（USDT）')}</Label><Input id="perp-fund" className="text-base" type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100" autoFocus /></div>
          <div className="mt-1 flex items-center justify-between text-xs text-muted"><span>{t('可提 {amount} USDT', { amount: account ? fmtAmount(account.withdrawable) : '--' })}</span>{account && account.withdrawable > 0 && <button onClick={() => setAmount(String(Math.floor(account.withdrawable * 100) / 100))} className="text-accent">{t('全部')}</button>}</div>
          <Button size="lg" className="mt-3 w-full" loading={busy} disabled={!(n > (fee ?? 0.2))} onClick={go}>{t('提出 {amount}', { amount: n ? `${n} USDT` : '' })}</Button>
        </>
      )}
    </Sheet>
  )
}
