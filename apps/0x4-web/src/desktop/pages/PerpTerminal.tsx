// Web "Perps" trading terminal (2026-09-29 goat round 3: K-lines and the left coin list redesigned; the positions bar wasn't visible on desktop without scrolling; TP/SL expansion clipped through).
// Modeled on Hyperliquid / Lighter: everything fits one screen, the page itself doesn't scroll, each panel scrolls on its own:
//   Top: perps header — pair selector (dropdown panel hugging the button: search + hot / gainers / losers / favorites, replacing the old full left market list) + live price and 24h stats
//   Middle: K-lines (OHLC) | order book + latest trades (real depth and tick data from the exchange's public API, websocket push, falling back to polling when cut)
//   Right: order panel 320 (full column height): margin mode, leverage, market / limit, long / short, size, ratio, reduce-only, TP/SL (two rows inside the panel), perps account
//   Bottom: positions / open orders / fill history (fixed height, visible within one screen, the table scrolls itself)
// Ordering, closing, cancelling, and deposit/withdraw call exactly the same functions in lib/aster as the phone perps page (src/pages/Perp.tsx), with the parameter math copied too;
// Ordering / closing / cancelling all pass the same gate (on web, connect the 0x4 browser extension if not connected). Failed quotes show an empty state — never fake data.
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeftRight, ChevronDown, Crosshair, LoaderCircle, Lock, RefreshCw, Search, Star, Wallet } from 'lucide-react'
import { toast } from '@/components/Toast'
import { alertError, useAlert } from '@/components/AlertDialog'
import { isWalletConnected, useWallet } from '@/store/wallet'
import { useSettings } from '@/store/settings'
import { usePortfolio } from '@/store/portfolio'
import { chainName } from '@/lib/chains'
import { fmtAmount, fmtMoney, fmtUsd } from '@/lib/format'
import { reportTrade } from '@/lib/trades'
import {
  BSC_CHAIN_ID, BSC_USDT, MIN_DEPOSIT, MIN_NOTIONAL,
  BNB_GAS_RESERVE, authorizePerpAgent, linkPerpReader, perpFeeRate, setPerpFeeRate, bscBnbBalance, bscUsdtBalance, cancelOrder, closePosition, depositBnb, depositUsdt, estimateWithdrawFee, loadAccount, loadCandles, loadFills, loadLeverageBrackets, loadMarkets, loadOpenOrders, placeOrder, roundPx, roundSz, setProtection, withdrawUsdt,
  type Candle, type Interval, type PerpAccount, type PerpFill, type PerpMarket, type PerpOrder, type PerpPosition,
} from '@/lib/aster'
import { locale, t } from '@/lib/i18n'
import { isBool, oneOf, usePageState } from '@/lib/pageState'
import { useFees } from '@/lib/fees'
import { errorText, isUserCancel } from '@/lib/errors'
import { needWallet, unlockOx4 } from '../walletGate'
import ChartPanel from '../trade/ChartPanel'
import OrderBook from '../trade/OrderBook'
import CoinIcon from '../trade/CoinIcon'
import Popover from '../trade/Popover'
import Modal from '../trade/Modal'
import { usePerpLive, type PerpLive } from '../trade/usePerpLive'
import { INTERVAL_SEC, bubblesOf, flowOf, patchLast, usdShort } from '@/lib/perpFlow'
import { buildPlan, estPnl, orderKind, protectIssue, type PlanDraft, type PlanLine, type PlanPending, type ProtectKind } from '../trade/planLines'
import type { PlanPick, PlanProps } from '../trade/PlanOverlay'
import SpriteLook from '../trade/SpriteLook'
import { buildBrief } from '@/lib/chartBrief'
import type { PerpStats } from '@/lib/asterBook'
import type { Ox4PerpSession } from '@/lib/vault/extension'
import './trade.css'

const IVALS: Interval[] = ['1m', '5m', '15m', '1h', '4h', '1d']
const pct = (n: number) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`
const fmtPx = (n: number) => n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 1 }) : n >= 1 ? n.toFixed(2) : n.toPrecision(4)
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${money(Math.abs(n))}`
const dir = (n: number) => n >= 0 ? 'up' : 'down'
/** Total fee rate: exchange taker 0.04% (maker 0) + platform fee (0.06% regular / 0.04% VIP, pushed by the server). Same math as the phone perps page */
const feeRate = (type: string) => Number(((type === 'market' ? 0.0004 : 0) + perpFeeRate()).toFixed(6))
/** Gate before ordering / closing / cancelling (including leverage changes): on web without the 0x4 browser extension connected, go connect it and stop here (matches the web branch of the phone perps page's perpGate) */
const perpGate = () => !needWallet()
const FAV_KEY = '0x4.perpFav'

type PxFmt = (n: number, c: string) => string
/** The order being filled in the order panel: show = something was entered, draw the preview line on the K-line chart; even when empty it carries direction and current price for "pick price on chart" */
type Draft = PlanDraft & { show: boolean }
/** The price filled back into the order panel after dragging lines / picking a price on the K-line chart (n increments each time, so the same price can be filled again) */
type ChartPx = { kind: 'limit' | ProtectKind; px: number; n: number }
/**
 * How far the perps account read got (2026-09-29: web read-only queries no longer auto-trigger authorization — "no trading key authorized yet" must be distinguished from "not funded yet"):
 * none = no wallet / loading = reading / ready = ok / noAgent = trading key not authorized yet (the user will be asked to authorize in the extension on their first order) /
 * noDeposit = the exchange says this wallet hasn't funded / cancelled = user rejected the signature in the extension (no more auto re-reads; wait for the user to hit retry) / error = anything else
 */
/** locked: the 0x4 extension is locked (since 2026-10-06, extension locking no longer logs web out); reading the perps account needs the extension's signature — don't auto-pop unlock, give an "Unlock" button */
type AcctState = { kind: 'none' | 'loading' | 'ready' | 'noAgent' | 'noDeposit' | 'cancelled' | 'locked' } | { kind: 'error'; msg: string }

export default function PerpTerminal() {
  // On entering the perps page, pull the fee rate once (VIPs pay 0.04%); re-render the fee display after it arrives
  setPerpFeeRate(useFees((s) => s.fees.perpRate))
  useEffect(() => { void useFees.getState().load() }, [])
  const { evmAccount, keysUnlocked } = useWallet()
  const connected = useWallet(isWalletConnected) && !!evmAccount
  const { slippageBps } = useSettings()
  const [params, setParams] = useSearchParams()
  const coin = params.get('coin')?.toUpperCase() || 'BTC'
  const pick = (c: string) => setParams({ coin: c }, { replace: true })

  const [markets, setMarkets] = useState<PerpMarket[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [account, setAccount] = useState<PerpAccount | null>(null)
  const [orders, setOrders] = useState<PerpOrder[]>([])
  const [fills, setFills] = useState<PerpFill[]>([])
  const [acct, setAcct] = useState<AcctState>({ kind: 'none' })
  /** The user once rejected signing: periodic refreshes no longer read the account — only "Retry" reads */
  const paused = useRef(false)
  const [fund, setFund] = useState<'deposit' | 'withdraw' | null>(null)
  // Arriving from the sprite page's "Deposit USDT" (?fund=deposit): open the deposit window directly instead of making people hunt for it at the bottom-right (2026-10-05 goat)
  useEffect(() => { if (params.get('fund') === 'deposit') { setFund('deposit'); const p = new URLSearchParams(params); p.delete('fund'); setParams(p, { replace: true }) } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  /** A price tapped in the order book: filled into the limit order (n increments each time, so tapping the same price twice fills it again) */
  const [bookPx, setBookPx] = useState<{ px: number; n: number } | null>(null)
  const [liveRetry, setLiveRetry] = useState(0)
  // Trading lines on the K-line chart (2026-10-02 goat batch 1)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [chartPx, setChartPx] = useState<ChartPx | null>(null)
  /** TP/SL newly set / changed on the chart for an existing position: only sent to the exchange after tapping "Confirm" */
  const [pending, setPending] = useState<PlanPending | null>(null)
  /** Picking a price on the chart: draft = picking for the current order in the order panel, pos = picking for an existing position */
  const [pickMode, setPickMode] = useState<{ kind: ProtectKind; target: 'draft' | 'pos' } | null>(null)
  const [protectBusy, setProtectBusy] = useState(false)
  useEffect(() => { setPending(null); setPickMode(null); setChartPx(null) }, [coin])
  /** Favorites: stored locally, same key as the phone perps page */
  const [favs, setFavs] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]') } catch { return [] } })
  const toggleFav = (c: string) => setFavs((cur) => {
    const next = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]
    try { localStorage.setItem(FAV_KEY, JSON.stringify(next)) } catch { /* Failing to save doesn't affect trading */ }
    return next
  })

  // Read markets and account separately: new users have no exchange account yet, so the account endpoint errors — that must not take down market data too
  // Proactively authorize the trading key: authorizable even just to view balances / the sprite's positions (it used to pop only on the first order, 2026-10-05 goat)
  const [authBusy, setAuthBusy] = useState(false)
  const authorize = async () => {
    if (!evmAccount || authBusy) return
    setAuthBusy(true)
    try { await authorizePerpAgent(evmAccount); paused.current = false; toast.success(t('已授权，正在读取合约账户')); await refresh(true) }
    catch (e) { if (!isUserCancel(e)) toast.error(errorText(e, t('授权失败'))) }
    finally { setAuthBusy(false) }
  }
  const refresh = useCallback(async (force = false) => {
    let m: PerpMarket[] | null = null
    try { m = await loadMarkets(); setMarkets(m); setLoadErr(null) } catch (e) { setLoadErr(errorText(e, t('连接失败'))) }
    if (!evmAccount || !keysUnlocked) { setAccount(null); setOrders([]); setFills([]); setAcct({ kind: evmAccount ? 'locked' : 'none' }); return }
    if (paused.current && !force) return
    paused.current = false
    // Show "loading" only on the first read or when the user hits retry (after a failure / cancellation); post-order refreshes don't flash
    setAcct((s) => s.kind === 'none' || (force && (s.kind === 'error' || s.kind === 'cancelled')) ? { kind: 'loading' } : s)
    try {
      const [a, o, f, br] = await Promise.all([
        loadAccount(evmAccount), loadOpenOrders(evmAccount), loadFills(evmAccount),
        loadLeverageBrackets(evmAccount).catch(() => ({} as Record<string, number>)),
      ])
      if (m) setMarkets(m.map((x) => br[x.coin] ? { ...x, maxLeverage: br[x.coin] } : x))
      setAccount(a); setOrders(o); setFills(f); setAcct({ kind: 'ready' })
      // Account already opened: also authorize the read-only agent so manual perps fills count toward VIP volume (done in the background, at most once per launch)
      void linkPerpReader(evmAccount)
    } catch (e) {
      // NO_AGENT: trading key not authorized yet (web read-only queries don't pop the auth window — authorization happens at the first order); "only be used after deposit": not funded yet. Both are normal states for new users
      const raw = e instanceof Error ? e.message : String(e ?? '')
      const msg = errorText(e, t('读取失败'))
      setAccount(null); setOrders([]); setFills([])
      if (raw === 'NO_AGENT' || msg === 'NO_AGENT') setAcct({ kind: 'noAgent' })
      else if (/only be used after deposit/i.test(`${raw} ${msg}`)) setAcct({ kind: 'noDeposit' })
      else if (!msg) { paused.current = true; setAcct({ kind: 'cancelled' }) }   // The user rejected in the extension: no more auto-popping
      else setAcct({ kind: 'error', msg })
    }
  }, [evmAccount, keysUnlocked])
  // Wallet switched: clear the "rejected before" memory
  useEffect(() => { paused.current = false }, [evmAccount])
  // Refresh every 8 seconds; not refreshed while the tab is in the background
  useEffect(() => { void refresh(); const id = window.setInterval(() => { if (!document.hidden) void refresh() }, 8000); return () => window.clearInterval(id) }, [refresh])

  const market = useMemo(() => markets.find((m) => m.coin === coin), [markets, coin])
  /** Display at this coin's price precision (a small coin at 0.0043540 must not show as 0.00) */
  const pxOf = useCallback<PxFmt>((n, c) => {
    const d = markets.find((x) => x.coin === c)?.pxDecimals
    if (!(n > 0)) return '--'
    if (n >= 1000 || d === undefined) return fmtPx(n)
    const digits = Math.min(d, 8, n >= 100 ? 2 : n >= 1 ? 4 : 8)
    return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  }, [markets])
  const live = usePerpLive(market ? coin : '', liveRetry)

  const mark = live.stats.mark || market?.markPx || 0
  const pos = useMemo(() => account?.positions.find((p) => p.coin === coin && p.size > 0) ?? null, [account, coin])
  const coinOrders = useMemo(() => orders.filter((o) => o.coin === coin), [orders, coin])
  // Position gone: unconfirmed TP/SL are voided along with it; if the old order to replace is already gone (triggered / cancelled elsewhere): place a fresh one instead
  useEffect(() => { if (!pos) { setPending(null); setPickMode((p) => p?.target === 'pos' ? null : p) } }, [pos])
  useEffect(() => { setPending((p) => p && p.oid !== undefined && !coinOrders.some((o) => o.oid === p.oid) ? { ...p, oid: undefined } : p) }, [coinOrders])
  const planLines = useMemo(() => buildPlan({ mark, position: pos, orders: coinOrders, draft: draft?.show ? draft : null, pending }), [mark, pos, coinOrders, draft, pending])

  const close = async (p: PerpPosition) => {
    const m = markets.find((x) => x.coin === p.coin)
    if (!m || !perpGate() || !evmAccount) return
    try {
      const r = await closePosition(evmAccount, m, p, slippageBps)
      toast.success(t('已平仓 {coin}', { coin: p.coin }))
      reportTrade({ side: 'sell', realized: p.unrealizedPnl, chainId: -1, token: `${p.coin}:${p.isLong ? 'long' : 'short'}`, symbol: `${p.coin} ${p.isLong ? '多' : '空'} ${p.leverage}x`, name: `${p.coin} 永续 · 平${p.isLong ? '多' : '空'}`, qty: r.filledSz || p.size, usd: (r.filledSz || p.size) * (r.avgPx || m.markPx), chainKey: 'hyperliquid' })
      void refresh()
    } catch (e) { alertError(e, t('平仓失败')) }
  }
  const cancel = async (o: PerpOrder) => {
    const m = markets.find((x) => x.coin === o.coin)
    if (!m || !perpGate() || !evmAccount) return
    try { await cancelOrder(evmAccount, m, o.oid); toast.success(t('已撤单')); setPending((p) => p?.oid === o.oid ? null : p); void refresh() } catch (e) { alertError(e, t('撤单失败')) }
  }

  // ---- Trading lines on the K-line chart: drag, pick price, confirm ----
  const bump = (kind: ChartPx['kind'], px: number) => setChartPx((c) => ({ kind, px, n: (c?.n || 0) + 1 }))
  const onPlanMove = (l: PlanLine, px: number) => {
    if (l.role === 'draftEntry') bump('limit', px)
    else if (l.role === 'draftTp') bump('tp', px)
    else if (l.role === 'draftSl') bump('sl', px)
    else if (l.role === 'tp' || l.role === 'sl') setPending({ kind: l.role, px, oid: l.oid })
    else if (l.role === 'pendingTp' || l.role === 'pendingSl') setPending((p) => p ? { ...p, px } : p)
  }
  /** What the mouse-following line says while picking a price: the estimated PnL at that price; say so directly when the price is on the wrong side */
  const pickAt = (px: number) => {
    if (!pickMode) return {}
    if (pickMode.target === 'pos' && pos) {
      const pnl = estPnl(pos.isLong, pos.entryPx, px, pos.size)
      return { pnl, pct: pnl !== undefined && pos.marginUsed > 0 ? pnl / pos.marginUsed : undefined, issue: protectIssue(pickMode.kind, pos.isLong, px, [mark]) }
    }
    if (pickMode.target === 'draft' && draft) {
      const pnl = estPnl(draft.isLong, draft.entry, px, draft.size)
      return { pnl, pct: pnl !== undefined && draft.margin > 0 ? pnl / draft.margin : undefined, issue: protectIssue(pickMode.kind, draft.isLong, px, [mark, draft.entry]) }
    }
    return {}
  }
  const onPick = (px: number) => {
    if (!pickMode) return
    if (pickMode.target === 'draft') bump(pickMode.kind, px)
    // This position already has the same kind of order: treat as modifying it (cancel the old, place the new)
    else setPending({ kind: pickMode.kind, px, oid: coinOrders.find((o) => orderKind(o) === pickMode.kind)?.oid })
    setPickMode(null)
  }
  const confirmPending = async () => {
    if (!pending || !market || !pos || !evmAccount || !perpGate()) return
    const issue = protectIssue(pending.kind, pos.isLong, pending.px, [mark])
    if (issue) { toast.error(issue); return }
    const cur = pending
    setProtectBusy(true)
    try {
      await setProtection(evmAccount, market, pos.isLong, cur.kind, cur.px, cur.oid)
      toast.success(cur.kind === 'tp' ? t('止盈已设在 {px}', { px: pxOf(cur.px, coin) }) : t('止损已设在 {px}', { px: pxOf(cur.px, coin) }))
      setPending(null)
    } catch (e) {
      // Old one cancelled, new one not placed: this position is now missing a layer of protection — say so plainly (keep the pending line; tapping confirm again places a fresh one directly)
      if ((e as { protectionGone?: boolean } | null)?.protectionGone) {
        setPending({ kind: cur.kind, px: cur.px })
        useAlert.getState().show({
          kind: 'error', title: cur.kind === 'sl' ? t('止损没有挂上') : t('止盈没有挂上'),
          message: cur.kind === 'sl' ? t('原来的止损已经撤掉，新的没有挂上，这个仓位现在没有止损保护。') : t('原来的止盈已经撤掉，新的没有挂上，这个仓位现在没有止盈。'),
          hint: t('图上的线还在，再点一次「确认」重新挂；或者手动平仓。'),
        })
      } else alertError(e, t('设置失败'))
    } finally { setProtectBusy(false); void refresh(true) }
  }
  const plan: PlanProps | undefined = market ? {
    lines: planLines, coin, pxDecimals: market.pxDecimals,
    onMove: onPlanMove,
    onCancelOrder: (oid) => { const o = coinOrders.find((x) => x.oid === oid); if (o) void cancel(o) },
    onAdd: (kind) => setPickMode({ kind, target: 'pos' }),
    onConfirm: () => void confirmPending(), onDiscard: () => setPending(null), busy: protectBusy,
    pick: pickMode ? { kind: pickMode.kind, at: pickAt } satisfies PlanPick : null,
    onPick, onPickCancel: () => setPickMode(null),
  } : undefined

  // No quotes yet: the whole block shows loading / failed / no-such-contract — stated only once
  if (!market) {
    return (
      <div className="tx-term tx-perp-empty">
        <div className="tx-panel">
          {markets.length
            ? <div className="tx-empty"><span>{t('没有找到合约 {coin}', { coin })}</span><button type="button" className="tx-btn tx-btn-sm" onClick={() => pick('BTC')}>BTC-USDT</button></div>
            : loadErr
              ? <div className="tx-empty"><span>{t('暂时无法读取合约行情')}</span><button type="button" className="tx-btn tx-btn-sm" onClick={() => void refresh()}><RefreshCw size={13} />{t('重试')}</button></div>
              : <div className="tx-empty"><span className="tx-spin" aria-hidden="true" /><span>{t('正在读取合约行情')}</span></div>}
        </div>
      </div>
    )
  }

  const markOf = (c: string) => markets.find((m) => m.coin === c)?.markPx || 0
  return (
    <div className="tx-term tx-perp">
      <PerpHead market={market} markets={markets} live={live.stats} last={live.tape[0]?.px} favs={favs} onFav={toggleFav} onPick={pick} pxOf={pxOf} stale={!!loadErr} onRetry={() => void refresh()} />
      <PerpChart market={market} pxOf={pxOf} plan={plan} live={live} pos={pos} orders={coinOrders} />
      <OrderBook coin={market.coin} book={live.book} tape={live.tape} mark={live.stats.mark} mode={live.mode} szDecimals={market.szDecimals}
        bigMin={live.bigMin} pxText={(n) => pxOf(n, market.coin)} onPickPrice={(px) => setBookPx((c) => ({ px, n: (c?.n || 0) + 1 }))} onRetry={() => setLiveRetry((v) => v + 1)} />
      <OrderPanel market={market} account={account} connected={connected} acct={acct} pxOf={pxOf} bookPx={bookPx}
        chartPx={chartPx} onDraft={setDraft} picking={pickMode?.target === 'draft' ? pickMode.kind : null} onPickPx={(kind) => setPickMode(kind ? { kind, target: 'draft' } : null)}
        onFund={setFund} onDone={() => void refresh(true)} onRetry={() => void refresh(true)} onAuthorize={authorize} authBusy={authBusy} onUnlock={() => void unlockOx4()} />
      <BottomTabs account={account} orders={orders} fills={fills} connected={connected} acct={acct} current={market.coin}
        pxOf={pxOf} markOf={markOf} onPick={pick} onClose={close} onCancel={cancel} onRetry={() => void refresh(true)} onAuthorize={authorize} authBusy={authBusy} onUnlock={() => void unlockOx4()} />
      <FundModal mode={fund} onClose={() => { setFund(null); void refresh() }} account={account} />
    </div>
  )
}

/** Perps header: pair selector + latest price + mark / index price / 24h / open interest / funding rate and countdown (all real exchange data; "--" when unavailable) */
function PerpHead({ market, markets, live, last, favs, onFav, onPick, pxOf, stale, onRetry }: {
  market: PerpMarket; markets: PerpMarket[]; live: PerpStats; last?: number; favs: string[]
  onFav: (c: string) => void; onPick: (c: string) => void; pxOf: PxFmt; stale: boolean; onRetry: () => void
}) {
  const btn = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [, tick] = useState(0)
  useEffect(() => { const id = window.setInterval(() => tick((n) => n + 1), 1000); return () => window.clearInterval(id) }, [])
  const c = market.coin
  const price = last || live.last || market.markPx
  const open24 = live.open24h || market.prevDayPx
  const chg = open24 > 0 && price > 0 ? (price - open24) / open24 : market.change24h
  const funding = live.funding ?? market.funding
  const left = live.nextFunding ? Math.max(0, live.nextFunding - Date.now()) : null
  const hms = left === null ? '' : [Math.floor(left / 3600_000), Math.floor(left / 60_000) % 60, Math.floor(left / 1000) % 60].map((n) => String(n).padStart(2, '0')).join(':')
  const fav = favs.includes(c)
  const vol = live.quoteVolume24h ?? market.volume24h
  return (
    <header className="tx-panel tx-head">
      <div className="tx-head-id">
        <button ref={btn} type="button" className="tx-market-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog" aria-label={t('切换合约')}>
          <CoinIcon coin={c} size={26} />
          <span className="tx-head-sym"><b>{c}-USDT<span className="tx-badge">{market.maxLeverage}x</span></b><small>{t('永续')} · {t('USDT 保证金')}</small></span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        <button type="button" className={`tx-icon-btn ${fav ? 'is-on' : ''}`} onClick={() => onFav(c)} aria-pressed={fav} aria-label={fav ? t('取消自选') : t('加入自选')} title={fav ? t('取消自选') : t('加入自选')}><Star size={15} fill={fav ? 'currentColor' : 'none'} /></button>
      </div>
      <div className="tx-head-px">
        <b className={dir(chg)}>{pxOf(price, c)}</b>
        <small className={dir(chg)}>{pct(chg)}</small>
      </div>
      <dl className="tx-stats">
        <div><dt>{t('标记价格')}</dt><dd>{pxOf(live.mark || market.markPx, c)}</dd></div>
        <div><dt>{t('指数价格')}</dt><dd>{live.index ? pxOf(live.index, c) : '--'}</dd></div>
        <div><dt>{t('24h 涨跌')}</dt><dd className={dir(chg)}>{open24 > 0 && price > 0 ? `${price - open24 >= 0 ? '+' : '-'}${pxOf(Math.abs(price - open24), c)}` : '--'}</dd></div>
        <div><dt>{t('24h 最高')}</dt><dd>{live.high24h ? pxOf(live.high24h, c) : '--'}</dd></div>
        <div><dt>{t('24h 最低')}</dt><dd>{live.low24h ? pxOf(live.low24h, c) : '--'}</dd></div>
        <div><dt>{t('24h 成交额')}</dt><dd>{vol > 0 ? fmtUsd(vol, { compact: true }) : '--'}</dd></div>
        <div><dt>{t('持仓量')}</dt><dd>{live.openInterest ? fmtUsd(live.openInterest, { compact: true }) : '--'}</dd></div>
        <div><dt>{t('资金费率 / 倒计时')}</dt><dd><span className={funding >= 0 ? 'warn' : 'up'}>{(funding * 100).toFixed(4)}%</span>{hms && <span className="mute"> / {hms}</span>}</dd></div>
      </dl>
      {stale && <div className="tx-head-act"><button type="button" className="tx-link warn" onClick={onRetry}>{t('行情更新失败，重试')}<RefreshCw size={12} /></button></div>}
      <MarketPicker open={open} anchor={btn} onClose={() => setOpen(false)} markets={markets} current={c} favs={favs} onFav={onFav} onPick={(x) => { onPick(x); setOpen(false) }} />
    </header>
  )
}

/** Pair picker dropdown: search + hot (by volume) / gainers / losers / favorites; gain/loss only counts pairs with trades */
function MarketPicker({ open, anchor, onClose, markets, current, favs, onFav, onPick }: {
  open: boolean; anchor: RefObject<HTMLButtonElement | null>; onClose: () => void; markets: PerpMarket[]; current: string; favs: string[]
  onFav: (c: string) => void; onPick: (c: string) => void
}) {
  const [tab, setTab] = usePageState<'hot' | 'gain' | 'lose' | 'fav'>('desk.perp.rail', 'hot', oneOf('hot', 'gain', 'lose', 'fav'))
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(60)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) { setQ(''); requestAnimationFrame(() => input.current?.focus()) } }, [open])
  const q2 = q.trim().toLowerCase()
  const list = useMemo(() => {
    if (q2) return markets.filter((m) => m.coin.toLowerCase().includes(q2)).sort((a, b) => Number(b.coin.toLowerCase() === q2) - Number(a.coin.toLowerCase() === q2))
    if (tab === 'fav') return markets.filter((m) => favs.includes(m.coin))
    if (tab === 'gain') return markets.filter((m) => m.volume24h > 0).sort((a, b) => b.change24h - a.change24h)
    if (tab === 'lose') return markets.filter((m) => m.volume24h > 0).sort((a, b) => a.change24h - b.change24h)
    return markets
  }, [markets, tab, favs, q2])
  useEffect(() => setShown(60), [tab, q2])
  return (
    <Popover open={open} anchor={anchor} onClose={onClose} width={460} maxHeight={560} label={t('选择合约')} className="tx-mk-pop">
      <label className="tx-pop-search">
        <Search size={14} aria-hidden="true" />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('搜索合约')} aria-label={t('搜索合约')} spellCheck={false}
          onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) onPick(list[0].coin) }} />
      </label>
      {!q2 && <div className="tx-tabs" role="tablist" aria-label={t('合约分类')}>
        {([['hot', t('热门')], ['gain', t('涨幅榜')], ['lose', t('跌幅榜')], ['fav', t('自选')]] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tx-tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{label}{k === 'fav' && favs.length > 0 && <small>{favs.length}</small>}</button>
        ))}
      </div>}
      <div className="tx-mk-head" aria-hidden="true"><span>{t('合约')}</span><span className="r">{t('价格')}</span><span className="r">{t('24h 涨跌')}</span><span className="r">{t('24h 成交额')}</span></div>
      <div className="tx-mk-list" onScroll={(e) => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight > el.scrollHeight - 200 && shown < list.length) setShown((n) => n + 60) }}>
        {!list.length
          ? <div className="tx-empty is-tight"><span>{tab === 'fav' && !q2 ? t('还没有自选。点合约名旁边的星标加入。') : t('没有匹配的合约')}</span></div>
          : list.slice(0, shown).map((m) => {
            const on = m.coin === current, fav = favs.includes(m.coin)
            return (
              <div key={m.coin} className={`tx-mk-row ${on ? 'on' : ''}`} role="button" tabIndex={0} aria-current={on || undefined}
                onClick={() => onPick(m.coin)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(m.coin) } }}>
                <button type="button" className={`tx-mk-star ${fav ? 'is-on' : ''}`} onClick={(e) => { e.stopPropagation(); onFav(m.coin) }} aria-pressed={fav} aria-label={fav ? t('取消自选') : t('加入自选')}><Star size={13} fill={fav ? 'currentColor' : 'none'} /></button>
                <span className="tx-mk-sym"><CoinIcon coin={m.coin} size={18} /><span>{m.coin}</span><em>{m.maxLeverage}x</em></span>
                <span className="r tx-num">{fmtPx(m.markPx)}</span>
                <span className={`r tx-num ${dir(m.change24h)}`}>{pct(m.change24h)}</span>
                <span className="r tx-num mute">{m.volume24h > 0 ? fmtUsd(m.volume24h, { compact: true }) : '--'}</span>
              </div>
            )
          })}
      </div>
    </Popover>
  )
}

/**
 * K-lines: the exchange's public endpoint, refreshed every 10 seconds (not refreshed while the tab is in the background); between refreshes the last candle's close follows the latest trade price.
 * Two toolbar toggles (2026-10-02 goat batch 2, stored locally): "buy/sell pressure" = a strip under the K-lines, "large orders" = bubbles on the chart
 */
function PerpChart({ market, pxOf, plan, live, pos, orders }: { market: PerpMarket; pxOf: PxFmt; plan?: PlanProps; live: PerpLive; pos: PerpPosition | null; orders: PerpOrder[] }) {
  const [interval, setIval] = usePageState<Interval>('desk.perp.interval', '1h', oneOf('1m', '5m', '15m', '1h', '4h', '1d'))
  const [showFlow, setShowFlow] = usePageState<boolean>('desk.perp.flow', true, isBool)
  const [showBig, setShowBig] = usePageState<boolean>('desk.perp.big', true, isBool)
  const [retry, setRetry] = useState(0)
  const [s, set] = useState<{ status: 'loading' | 'ready' | 'error'; data: Candle[]; asOf: number }>({ status: 'loading', data: [], asOf: 0 })
  const coin = market.coin
  useEffect(() => {
    let alive = true
    set({ status: 'loading', data: [], asOf: 0 })
    const load = () => loadCandles(coin, interval, 300)
      .then((data) => { if (alive) set({ status: 'ready', data, asOf: Date.now() }) })
      // Refresh failed: if we already have this chart, keep showing it (toolbar small print explains); otherwise show failure + retry
      .catch(() => { if (alive) set((c) => ({ ...c, status: 'error' })) })
    void load()
    const id = window.setInterval(() => { if (!document.hidden) void load() }, 10_000)
    return () => { alive = false; window.clearInterval(id) }
  }, [coin, interval, retry])
  const lastPx = live.tape[0]?.px
  const candles = useMemo(() => patchLast(s.data, lastPx), [s.data, lastPx])
  const flow = useMemo(() => showFlow ? flowOf(s.data) : null, [showFlow, s.data])
  const bubbles = useMemo(() => showBig ? bubblesOf(live.big, INTERVAL_SEC[interval]) : [], [showBig, live.big, interval])
  const since = live.bigSince ? new Date(live.bigSince).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : ''
  // "Ask the sprite": the moment it's tapped, summarize this chart into a digest (positions carry ratios only, no amounts or values). Buy/sell pressure is included whether its toggle is on or not
  const getBrief = () => buildBrief({
    market: 'perp', symbol: coin, interval, candles, flow: flowOf(s.data), big: live.big, bigSince: live.bigSince,
    position: pos ? { isLong: pos.isLong, leverage: pos.leverage, roe: pos.roe, liquidationPx: pos.liquidationPx } : null,
    tpPx: pos ? orders.find((o) => orderKind(o) === 'tp')?.limitPx : undefined, slPx: pos ? orders.find((o) => orderKind(o) === 'sl')?.limitPx : undefined,
  })
  return (
    <ChartPanel intervals={IVALS} interval={interval} onInterval={setIval} candles={candles} chartKey={`perp:${coin}:${interval}`} status={s.status} asOf={s.asOf} onRetry={() => setRetry((v) => v + 1)} formatPrice={(n) => pxOf(n, coin)}
      plan={plan} flow={flow} bubbles={bubbles} bubbleMin={live.bigMin}>
      <div className="tx-chart-tools" role="group" aria-label={t('图表显示')}>
        <button type="button" className={showFlow ? 'on' : ''} aria-pressed={showFlow} onClick={() => setShowFlow((v) => !v)} title={t('每根 K 线里主动买入减主动卖出的成交额，线是累计')}>{t('买卖力量')}</button>
        <button type="button" className={showBig ? 'on' : ''} aria-pressed={showBig} onClick={() => setShowBig((v) => !v)}
          title={live.bigMin > 0 ? t('金额排在最近成交前 2% 的单，从 {time} 起有记录；每根 K 线买、卖各合成一个泡', { time: since }) : t('正在读取最近的成交')}>
          {t('大单')}{live.bigMin > 0 && <small>≥ {usdShort(live.bigMin)}</small>}
        </button>
      </div>
      <SpriteLook chartKey={`perp:${coin}:${interval}`} getBrief={getBrief} />
    </ChartPanel>
  )
}

/** Order panel. Form and math copied from the phone perps page: margin × leverage = position value, size = position value ÷ price */
function OrderPanel({ market, account, connected, acct, pxOf, bookPx, chartPx, onDraft, picking, onPickPx, onFund, onDone, onRetry, onAuthorize, authBusy, onUnlock }: {
  market: PerpMarket; account: PerpAccount | null; connected: boolean; acct: AcctState
  pxOf: PxFmt; bookPx: { px: number; n: number } | null; onFund: (m: 'deposit' | 'withdraw') => void; onDone: () => void; onRetry: () => void
  onAuthorize: () => void; authBusy: boolean
  /** "Unlock" while the extension is locked: ask the 0x4 extension to pop its unlock window; the page re-reads the account automatically after unlocking */
  onUnlock: () => void
  /** The price filled back after dragging lines / picking a price on the K-line chart */
  chartPx: ChartPx | null
  /** Report the order being filled to the perps page, drawn as the preview line on the K-line chart */
  onDraft: (d: Draft) => void
  /** Currently picking the TP / SL price for this order on the chart */
  picking: ProtectKind | null
  onPickPx: (kind: ProtectKind | null) => void
}) {
  const { evmAccount } = useWallet()
  const { slippageBps } = useSettings()
  const [lev, setLev] = useState(5)
  const [amt, setAmt] = useState('')
  const [unit, setUnit] = useState<'margin' | 'coin'>('margin')
  const [type, setType] = useState<'market' | 'limit'>('market')
  const [side, setSide] = useState<'long' | 'short'>('long')
  /** Isolated by default: losses are locked inside this position's margin */
  const [isCross, setIsCross] = useState(false)
  const [limitPx, setLimitPx] = useState('')
  const [reduceOnly, setReduceOnly] = useState(false)
  const [tpsl, setTpsl] = useState(false)
  const [tp, setTp] = useState('')
  const [sl, setSl] = useState('')
  const [busy, setBusy] = useState(false)
  /** Why an order can't be placed after tapping order (written under the matching input); cleared when the input changes */
  const [hint, setHint] = useState<{ at: 'amt' | 'px' | ProtectKind; text: string } | null>(null)
  const [pop, setPop] = useState<'lev' | 'mode' | null>(null)
  const levBtn = useRef<HTMLButtonElement>(null)
  const modeBtn = useRef<HTMLButtonElement>(null)
  const amtInput = useRef<HTMLInputElement>(null)
  const pxInput = useRef<HTMLInputElement>(null)

  // When switching markets, clamp to the cap only when over it; markets supporting only isolated get the switch flipped back to isolated
  useEffect(() => { if (lev > market.maxLeverage) setLev(market.maxLeverage) }, [market.maxLeverage]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (market.onlyIsolated && isCross) setIsCross(false) }, [market.onlyIsolated]) // eslint-disable-line react-hooks/exhaustive-deps
  // Switching coins clears the half-filled order
  useEffect(() => { setAmt(''); setLimitPx(''); setTp(''); setSl(''); setHint(null) }, [market.coin])
  useEffect(() => { setHint(null) }, [amt, limitPx, type, side, lev, tp, sl, tpsl])
  // Tapped a level in the order book: switch to limit, fill in the price
  useEffect(() => { if (bookPx) { setType('limit'); setLimitPx(String(bookPx.px)) } }, [bookPx])
  // Dragged a preview line on the K-line chart, or picked a price on the chart: fill it back into the matching input (at the exchange's price precision)
  useEffect(() => {
    if (!chartPx) return
    const v = roundPx(chartPx.px, market.pxDecimals)
    if (chartPx.kind === 'limit') { setType('limit'); setLimitPx(v) }
    else { setTpsl(true); (chartPx.kind === 'tp' ? setTp : setSl)(v) }
  }, [chartPx]) // eslint-disable-line react-hooks/exhaustive-deps
  // Leverage and margin mode are recorded per coin on the perps account: with a position open, the position's actual settings win
  const pos = account?.positions.find((x) => x.coin === market.coin)
  useEffect(() => { if (pos) { setLev(pos.leverage); setIsCross(pos.isCross) } }, [pos?.leverage, pos?.isCross, market.coin]) // eslint-disable-line react-hooks/exhaustive-deps

  const price = type === 'limit' && Number(limitPx) > 0 ? Number(limitPx) : market.markPx || 0
  const notional = unit === 'margin' ? (Number(amt) || 0) * lev : (Number(amt) || 0) * price
  const size = price > 0 ? notional / price : 0
  const margin = lev > 0 ? notional / lev : 0
  const free = account?.withdrawable || 0
  const maxNotional = free * lev
  const liq = price > 0 && notional > 0 ? (side === 'long' ? price * (1 - 1 / lev + 0.005) : price * (1 + 1 / lev - 0.005)) : 0
  const sizePct = maxNotional > 0 ? Math.min(100, Math.round((notional / maxNotional) * 100)) : 0
  // Report this order to the perps page for the preview line: draw when size, limit price, or TP/SL has any input (reduce-only orders don't draw TP/SL or the liquidation price)
  const isLimit = type === 'limit' && Number(limitPx) > 0
  const tpN = tpsl && !reduceOnly && Number(tp) > 0 ? Number(tp) : undefined
  const slN = tpsl && !reduceOnly && Number(sl) > 0 ? Number(sl) : undefined
  const showDraft = size > 0 || isLimit || tpN !== undefined || slN !== undefined
  /** The size that will actually be ordered (floored to the exchange's size precision); estimated PnL is computed from it */
  const sizeR = Number(roundSz(size, market.szDecimals))
  useEffect(() => {
    onDraft({ show: showDraft, isLong: side === 'long', entry: price, isLimit, size: sizeR, margin, liq: liq || undefined, tp: tpN, sl: slN, reduceOnly })
  }, [showDraft, side, price, isLimit, sizeR, margin, liq, tpN, slN, reduceOnly]) // eslint-disable-line react-hooks/exhaustive-deps
  const estOf = (kind: ProtectKind) => { const v = kind === 'tp' ? tpN : slN; return v === undefined ? undefined : estPnl(side === 'long', price, v, sizeR) }
  const ests = (['tp', 'sl'] as const).map((kind) => ({ kind, pnl: estOf(kind) })).filter((x): x is { kind: ProtectKind; pnl: number } => x.pnl !== undefined)
  const setPct = (p: number) => {
    if (maxNotional <= 0) return setAmt('')
    if (p <= 0) return setAmt('')
    const usdVal = (maxNotional * p) / 100
    setAmt(unit === 'margin' ? String(Math.floor((free * p) / 100 * 100) / 100) : price > 0 ? (usdVal / price).toFixed(market.szDecimals) : '')
  }
  const switchUnit = () => {
    const next = unit === 'margin' ? 'coin' : 'margin'
    if (notional > 0 && price > 0 && lev > 0) setAmt(next === 'margin' ? String(Math.floor((notional / lev) * 100) / 100) : (notional / price).toFixed(market.szDecimals))
    setUnit(next)
  }
  const levMax = market.maxLeverage || 1
  const levSteps = useMemo(() => {
    const max = levMax
    const raw = max >= 100 ? [1, 5, 20, 50, max] : max >= 40 ? [1, 2, 10, 20, max] : max >= 20 ? [1, 2, 5, 10, max] : max >= 10 ? [1, 2, 5, max] : max >= 5 ? [1, 2, 3, max] : [1, max]
    return [...new Set(raw)].filter((v) => v >= 1 && v <= max)
  }, [levMax])
  const loadingAccount = connected && acct.kind === 'loading'
  const needDeposit = connected && (acct.kind === 'noDeposit' || (acct.kind === 'ready' && free <= 0))
  const readFailed = connected && (acct.kind === 'error' || acct.kind === 'cancelled')
  /** Trading key not authorized yet: balances unreadable — don't gate on margin before ordering (the exchange validates); the extension asks the user to authorize at the first order */
  const noAgent = connected && acct.kind === 'noAgent'

  const submit = async () => {
    if (!perpGate()) return
    if (!evmAccount) return toast.error(t('钱包已锁定'))
    if (!(Number(amt) > 0)) { setHint({ at: 'amt', text: t('请输入数量') }); amtInput.current?.focus(); return }
    if (type === 'limit' && !(Number(limitPx) > 0)) { setHint({ at: 'px', text: t('请输入价格') }); pxInput.current?.focus(); return }
    if (!(notional >= MIN_NOTIONAL)) { setHint({ at: 'amt', text: t('仓位价值最少 ${min}，交易所会拒掉更小的单。', { min: MIN_NOTIONAL }) }); amtInput.current?.focus(); return }
    if (!noAgent && margin > free + 1e-6) { setHint({ at: 'amt', text: t('保证金不够：需要 {need} USDT，可用 {free} USDT', { need: money(margin), free: money(free) }) }); amtInput.current?.focus(); return }
    // TP/SL placed on the wrong side (e.g. long TP below spot): the exchange rejects it on the spot, leaving the position unprotected. Block it before the order goes out
    for (const kind of ['tp', 'sl'] as const) {
      const v = kind === 'tp' ? tpN : slN
      const issue = v === undefined ? null : protectIssue(kind, side === 'long', v, [market.markPx, price])
      if (issue) { setHint({ at: kind, text: issue }); return }
    }
    setBusy(true)
    try {
      // Leverage and margin mode are set along with the order (on web they're folded with the main order and TP/SL into the extension's single confirmation window; the phone app still sets leverage first, then orders)
      const r = await placeOrder(evmAccount, { market, leverage: lev, isCross, isBuy: side === 'long', size, limitPx: type === 'limit' ? Number(limitPx) : undefined, reduceOnly, slippageBps, takeProfit: tpsl && Number(tp) > 0 ? Number(tp) : undefined, stopLoss: tpsl && Number(sl) > 0 ? Number(sl) : undefined })
      if (r.resting) toast.success(t('已挂单，成交后会出现在持仓里'))
      else {
        const fv = { coin: market.coin, sz: fmtAmount(r.filledSz), px: fmtPx(r.avgPx) }
        toast.success(side === 'long' ? t('做多 {coin} 成交 {sz} @ {px}', fv) : t('做空 {coin} 成交 {sz} @ {px}', fv))
        // Trading is social: opening a position counts as a buy, longs/shorts distinguished by different markers (same format as the phone perps page)
        reportTrade({ side: 'buy', chainId: -1, token: `${market.coin}:${side}`, symbol: `${market.coin} ${side === 'long' ? '多' : '空'} ${lev}x`, name: `${market.coin} 永续 · 开${side === 'long' ? '多' : '空'}`, realized: 0, qty: r.filledSz, usd: r.filledSz * r.avgPx, chainKey: 'hyperliquid' })
      }
      // TP / SL not placed: tell the user explicitly, keep the inputs filled for a quick re-place or close
      const pf = r.protectionFailed || []
      if (pf.length) {
        toast.error(pf.length === 2 ? t('止盈和止损都没有挂上，这个仓位现在没有保护。请重新设置，或手动平仓') : pf[0] === 'sl' ? t('止损没有挂上，这个仓位现在没有止损保护。请重新设置，或手动平仓') : t('止盈没有挂上，请重新设置'))
        setAmt('')
      } else { setAmt(''); setTp(''); setSl('') }
      onDone()
    } catch (e) { alertError(e, t('下单失败')) } finally { setBusy(false) }
  }

  const sideLabel = side === 'long' ? t('做多 {coin}', { coin: market.coin }) : t('做空 {coin}', { coin: market.coin })
  const main = !connected
    ? <button type="button" className="tx-btn tx-btn-lg is-pearl" onClick={() => { needWallet() }}><Wallet size={16} aria-hidden="true" />{t('连接 0x4 Wallet')}</button>
    : acct.kind === 'locked'
      ? <button type="button" className="tx-btn tx-btn-lg is-pearl" onClick={onUnlock}><Lock size={15} aria-hidden="true" />{t('解锁 0x4 Wallet')}</button>
    : readFailed
      ? <button type="button" className="tx-btn tx-btn-lg" onClick={onRetry}><RefreshCw size={15} aria-hidden="true" />{t('重新读取合约账户')}</button>
      : loadingAccount
        ? <button type="button" className="tx-btn tx-btn-lg" disabled><LoaderCircle size={16} className="tx-spin-ic" aria-hidden="true" />{t('正在读取合约账户')}</button>
        : needDeposit
          ? <button type="button" className="tx-btn tx-btn-lg is-pearl" onClick={() => onFund('deposit')}>{t('存入 USDT')}</button>
          : <button type="button" className={`tx-btn tx-btn-lg ${side === 'long' ? 'is-up' : 'is-down'}`} onClick={() => void submit()} aria-busy={busy || undefined} disabled={busy}>
            {busy && <LoaderCircle size={16} className="tx-spin-ic" aria-hidden="true" />}{busy ? t('处理中…') : sideLabel}
          </button>

  return (
    <aside className="tx-panel tx-order" aria-label={t('下单')}>
      <div className="tx-order-in">
        <div className="tx-perp-top">
          <button ref={modeBtn} type="button" onClick={() => setPop((p) => p === 'mode' ? null : 'mode')} aria-expanded={pop === 'mode'} aria-haspopup="dialog">{isCross ? t('全仓') : t('逐仓')}<ChevronDown size={13} aria-hidden="true" /></button>
          <button ref={levBtn} type="button" onClick={() => setPop((p) => p === 'lev' ? null : 'lev')} aria-expanded={pop === 'lev'} aria-haspopup="dialog" aria-label={t('杠杆')}>{t('杠杆')} <b className="tx-num">{lev}x</b><ChevronDown size={13} aria-hidden="true" /></button>
        </div>
        <Popover open={pop === 'mode'} anchor={modeBtn} onClose={() => setPop(null)} width={280} label={t('保证金模式')} className="tx-lev-pop">
          <div className="tx-seg" role="group" aria-label={t('保证金模式')} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            <button type="button" aria-pressed={!isCross} className={!isCross ? 'on' : ''} onClick={() => { setIsCross(false); setPop(null) }}>{t('逐仓')}</button>
            <button type="button" aria-pressed={isCross} disabled={market.onlyIsolated} className={isCross ? 'on' : ''} onClick={() => { setIsCross(true); setPop(null) }}>{t('全仓')}</button>
          </div>
          <p className="tx-fine" style={{ textAlign: 'left' }}>{market.onlyIsolated ? t('{coin} 只支持逐仓。', { coin: market.coin }) : isCross ? t('全仓：账户里所有可用保证金一起承担这个仓位的亏损。') : t('逐仓：亏损锁死在这个仓位的保证金里，不影响账户里其他钱。')}</p>
        </Popover>
        <Popover open={pop === 'lev'} anchor={levBtn} onClose={() => setPop(null)} width={300} align="end" label={t('调整杠杆')} className="tx-lev-pop">
          <div className="tx-lev-val"><span className="mute">{t('杠杆')}</span><b>{lev}x</b></div>
          <div className="tx-slider">
            <div className="tx-slider-track"><span style={{ width: `${levMax > 1 ? ((lev - 1) / (levMax - 1)) * 100 : 100}%` }} /></div>
            <input aria-label={t('杠杆')} type="range" min={1} max={levMax} value={lev} onChange={(e) => setLev(Number(e.target.value))} />
          </div>
          <div className="tx-lev-steps">{levSteps.map((v) => <button key={v} type="button" onClick={() => setLev(v)} className={lev === v ? 'on' : ''}>{v}x</button>)}</div>
          <p className="tx-fine" style={{ textAlign: 'left' }}>{t('{coin} 最高 {max}x。杠杆越高，强平价离开仓价越近。', { coin: market.coin, max: levMax })}</p>
        </Popover>

        <div className="tx-ordtype" role="tablist" aria-label={t('订单类型')}>
          <button type="button" role="tab" aria-selected={type === 'market'} className={`tx-tab ${type === 'market' ? 'on' : ''}`} onClick={() => setType('market')}>{t('市价')}</button>
          <button type="button" role="tab" aria-selected={type === 'limit'} className={`tx-tab ${type === 'limit' ? 'on' : ''}`} onClick={() => setType('limit')}>{t('限价')}</button>
        </div>

        <div className="tx-side" role="group" aria-label={t('方向')}>
          <button type="button" aria-pressed={side === 'long'} className={`is-up ${side === 'long' ? 'on' : ''}`} onClick={() => setSide('long')}>{t('做多')}</button>
          <button type="button" aria-pressed={side === 'short'} className={`is-down ${side === 'short' ? 'on' : ''}`} onClick={() => setSide('short')}>{t('做空')}</button>
        </div>

        <div className="tx-kv">
          <div><dt>{t('可用保证金')}</dt><dd className="tx-num">{connected && account ? `${money(free)} USDT` : '--'}</dd></div>
          <div><dt>{t('当前仓位')}</dt><dd className={`tx-num ${pos ? (pos.isLong ? 'up' : 'down') : ''}`}>{pos ? `${pos.isLong ? t('多') : t('空')} ${fmtAmount(pos.size)} ${market.coin}` : '--'}</dd></div>
        </div>

        {type === 'limit' && <div>
          <label className={`tx-field ${hint?.at === 'px' ? 'is-bad' : ''}`}>
            <span>{t('价格')}</span>
            <input ref={pxInput} aria-label={t('限价')} type="number" inputMode="decimal" value={limitPx} onChange={(e) => setLimitPx(e.target.value)} placeholder={pxOf(market.markPx, market.coin)} aria-invalid={hint?.at === 'px'} />
            <small>USDT</small>
          </label>
          {hint?.at === 'px' && <p className="tx-hint" role="alert">{hint.text}</p>}
        </div>}
        <div>
          <label className={`tx-field ${hint?.at === 'amt' ? 'is-bad' : ''}`}>
            <span>{unit === 'margin' ? t('保证金') : t('数量')}</span>
            <input ref={amtInput} aria-label={unit === 'margin' ? t('保证金（USDT）') : t('数量（{coin}）', { coin: market.coin })} type="number" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="0" aria-invalid={hint?.at === 'amt'} />
            <button type="button" onClick={switchUnit} className="tx-unit" aria-label={t('切换输入单位')}>{unit === 'margin' ? 'USDT' : market.coin}<ArrowLeftRight size={11} aria-hidden="true" /></button>
          </label>
          {hint?.at === 'amt' && <p className="tx-hint" role="alert">{hint.text}</p>}
        </div>
        <div className="tx-slider-row">
          <div className="tx-slider">
            <div className="tx-slider-track"><span style={{ width: `${sizePct}%` }} /></div>
            <div className="tx-slider-dots" aria-hidden="true">{[0, 25, 50, 75, 100].map((p) => <i key={p} className={sizePct >= p ? 'on' : ''} style={{ left: `${p}%` }} />)}</div>
            <input aria-label={t('按可用保证金比例')} type="range" min={0} max={100} step={1} value={sizePct} disabled={maxNotional <= 0} onChange={(e) => setPct(Number(e.target.value))} />
          </div>
          <span className="tx-slider-val">{sizePct}%</span>
        </div>
        {account && maxNotional > 0 && maxNotional < MIN_NOTIONAL && <p className="tx-note warn">{t('可用保证金只剩 {free}，{lev}x 下最多开 {max}，不够最低的 ${min}。先平掉已有仓位，或者存入更多 USDT。', { free: money(free), lev, max: fmtMoney(maxNotional), min: MIN_NOTIONAL })}</p>}

        <div className="tx-checks">
          <label className="tx-check"><input type="checkbox" checked={reduceOnly} onChange={(e) => setReduceOnly(e.target.checked)} />{t('只减仓')}</label>
          <label className="tx-check"><input type="checkbox" checked={tpsl} onChange={(e) => setTpsl(e.target.checked)} aria-expanded={tpsl} />{t('止盈 / 止损')}</label>
        </div>
        {/* TP/SL: two rows, both within the panel width (2026-09-29 goat: the old two-column inputs overflowed past the panel's right edge) */}
        {tpsl && <div className="tx-tpsl">
          {(['tp', 'sl'] as const).map((kind) => {
            const v = kind === 'tp' ? tp : sl
            return (
              <div key={kind}>
                <label className={`tx-field ${hint?.at === kind ? 'is-bad' : ''}`}>
                  <span>{kind === 'tp' ? t('止盈') : t('止损')}</span>
                  <input aria-label={kind === 'tp' ? t('止盈触发价') : t('止损触发价')} type="number" inputMode="decimal" value={v} onChange={(e) => (kind === 'tp' ? setTp : setSl)(e.target.value)} placeholder={t('触发价')} aria-invalid={hint?.at === kind} />
                  <small>USDT</small>
                  <button type="button" className={`tx-pick ${picking === kind ? 'is-on' : ''}`} onClick={() => onPickPx(picking === kind ? null : kind)} aria-pressed={picking === kind} aria-label={kind === 'tp' ? t('在图上选止盈价') : t('在图上选止损价')} title={kind === 'tp' ? t('在图上选止盈价') : t('在图上选止损价')}><Crosshair size={14} aria-hidden="true" /></button>
                </label>
                {hint?.at === kind && <p className="tx-hint" role="alert">{hint.text}</p>}
              </div>
            )
          })}
          {/* Estimated PnL at the TP / SL price: two per row, so the order panel isn't stretched taller */}
          {ests.length > 0 && <p className="tx-est" title={t('按入场价和数量估算，不含手续费和资金费')}>
            {ests.map(({ kind, pnl }) => <span key={kind}>{kind === 'tp' ? t('止盈') : t('止损')} <b className={pnl >= 0 ? 'up' : 'down'}>{signed(pnl)}{margin > 0 ? ` (${pnl >= 0 ? '+' : ''}${(pnl / margin * 100).toFixed(1)}%)` : ''}</b></span>)}
          </p>}
        </div>}

        {main}
        {noAgent && <p className="tx-fine">{t('合约交易密钥还没授权')}</p>}
        {connected && <QuickTrade account={evmAccount} />}

        <dl className="tx-kv">
          <div><dt>{t('仓位价值')}</dt><dd className="tx-num">{notional ? `${money(notional)} USDT` : '--'}</dd></div>
          <div><dt>{t('数量')}</dt><dd className="tx-num">{size ? `${fmtAmount(size)} ${market.coin}` : '--'}</dd></div>
          <div><dt>{t('所需保证金')}</dt><dd className="tx-num">{margin ? `${money(margin)} USDT` : '--'}</dd></div>
          <div><dt>{t('预估强平价')}</dt><dd className="tx-num warn">{liq ? pxOf(liq, market.coin) : '--'}</dd></div>
          <div><dt>{t('手续费（{rate}%）', { rate: feeRate(type) * 100 })}</dt><dd className="tx-num">{notional ? `${money(notional * feeRate(type))} USDT` : '--'}</dd></div>
        </dl>
      </div>

      {/* Perps account: shown only with a wallet connected (stated once on the main button when not connected) */}
      {connected && <section className="tx-acct" aria-label={t('合约账户')}>
        <div className="tx-acct-head"><h3>{t('合约账户')}</h3>{acct.kind !== 'ready' && acct.kind !== 'none' && <span className={`tx-state-chip ${acct.kind === 'error' || acct.kind === 'cancelled' ? 'warn' : ''}`}>{
          acct.kind === 'loading' ? t('读取中') : acct.kind === 'locked' ? <button type="button" className="underline-offset-2 hover:underline" onClick={onUnlock}>{t('解锁查看')}</button> : acct.kind === 'noAgent' ? <button type="button" className="underline-offset-2 hover:underline" disabled={authBusy} onClick={onAuthorize}>{authBusy ? t('授权中…') : t('授权后查看余额')}</button> : acct.kind === 'noDeposit' ? t('未入金') : acct.kind === 'cancelled' ? t('已取消') : t('读取失败')}</span>}</div>
        <dl className="tx-kv">
            <div><dt>{t('账户权益')}</dt><dd className="tx-num">{account ? `${money(account.accountValue)} USDT` : '--'}</dd></div>
            <div><dt>{t('占用保证金')}</dt><dd className="tx-num">{account ? `${money(account.marginUsed)} USDT` : '--'}</dd></div>
            <div><dt>{t('未实现盈亏')}</dt><dd className={`tx-num ${account ? dir(account.positions.reduce((s, p) => s + p.unrealizedPnl, 0)) : ''}`}>{account ? signed(account.positions.reduce((s, p) => s + p.unrealizedPnl, 0)) : '--'}</dd></div>
        </dl>
        <div className="tx-acct-btns">
          <button type="button" className="tx-btn tx-btn-sm" onClick={() => onFund('deposit')}>{t('存入')}</button>
          <button type="button" className="tx-btn tx-btn-sm" onClick={() => onFund('withdraw')} disabled={!account}>{t('提出')}</button>
        </div>
      </section>}
    </aside>
  )
}

/** The "web quick trading" toggle API on the extension wallet (lib/vault/extension.ts ox4PerpSession; the phone app's wallet doesn't have it) */
interface PerpSessionApi { status(): Promise<Ox4PerpSession>; start(): Promise<Ox4PerpSession>; end(): Promise<Ox4PerpSession> }

/**
 * Web quick trading (2026-09-30 goat: authorize once at login, no per-order popups on web afterwards).
 * On: says it takes effect immediately, and it can be turned off; off (not checked at login, wallet was locked, past 24 hours): an "Enable" button, extension pops to confirm.
 * The state is re-asked from the extension every 8 seconds along with the perps page (turned off in the extension, wallet locked — this follows along)
 */
function QuickTrade({ account }: { account: unknown }) {
  const api = (account as { ox4PerpSession?: PerpSessionApi } | null)?.ox4PerpSession
  const [s, setS] = useState<Ox4PerpSession | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!api) { setS(null); return }
    let live = true
    const load = () => { void api.status().then((v) => { if (live) setS(v) }) }
    load()
    const id = window.setInterval(() => { if (!document.hidden) load() }, 8000)
    return () => { live = false; window.clearInterval(id) }
  }, [api])
  if (!api || !s) return null
  const act = async (fn: () => Promise<Ox4PerpSession>) => {
    setBusy(true)
    try { setS(await fn()) } catch (e) { if (!isUserCancel(e)) alertError(e, t('操作失败')) } finally { setBusy(false) }
  }
  return s.active
    ? <p className="tx-quick is-on">
      <span>{t('快捷交易已开启')}</span>
      <button type="button" className="tx-btn tx-btn-sm" disabled={busy} onClick={() => void act(api.end)}>{t('关闭')}</button>
    </p>
    : <p className="tx-quick">
      <span>{t('开启快捷交易后，下单不用每笔都在插件里确认')}</span>
      <button type="button" className="tx-btn tx-btn-sm" disabled={busy} onClick={() => void act(api.start)}>{t('开启')}</button>
    </p>
}

/** Bottom tabs: Positions / Open orders / Fill history (all contracts, can filter to the current one). Fixed height, visible within one screen, the table scrolls itself */
function BottomTabs({ account, orders, fills, connected, acct, current, pxOf, markOf, onPick, onClose, onCancel, onRetry, onAuthorize, authBusy, onUnlock }: {
  account: PerpAccount | null; orders: PerpOrder[]; fills: PerpFill[]; connected: boolean; acct: AcctState; current: string
  pxOf: PxFmt; markOf: (c: string) => number; onPick: (c: string) => void; onClose: (p: PerpPosition) => Promise<void>; onCancel: (o: PerpOrder) => Promise<void>; onRetry: () => void
  onAuthorize: () => void; authBusy: boolean; onUnlock: () => void
}) {
  const [tab, setTab] = usePageState<'pos' | 'orders' | 'fills'>('desk.perp.tab', 'pos', oneOf('pos', 'orders', 'fills'))
  const [onlyCur, setOnlyCur] = usePageState<boolean>('desk.perp.onlyCur', false, isBool)
  /** Two-step close confirmation: first tap turns into "confirm close", a second tap within 4s actually closes (no browser dialog) */
  const [arming, setArming] = useState<string | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  useEffect(() => { if (!arming) return; const id = window.setTimeout(() => setArming(null), 4000); return () => window.clearTimeout(id) }, [arming])
  const keep = <T extends { coin: string }>(l: T[]) => onlyCur ? l.filter((x) => x.coin === current) : l
  const positions = keep(account?.positions ?? [])
  const ords = keep(orders), fls = keep(fills)
  const when = (ms: number) => new Date(ms).toLocaleString(locale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const loading = connected && acct.kind === 'loading'

  return (
    <section className="tx-panel tx-bottom" aria-label={t('合约记录')}>
      <div className="tx-tabs" role="tablist" aria-label={t('合约记录')}>
        {([['pos', t('仓位'), (account?.positions ?? []).length], ['orders', t('当前委托'), orders.length], ['fills', t('成交记录'), 0]] as const).map(([k, label, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tx-tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{label}{n > 0 && <small>{n}</small>}</button>
        ))}
        {connected && acct.kind === 'ready' && <div className="tx-tabs-end"><label className="tx-check"><input type="checkbox" checked={onlyCur} onChange={(e) => setOnlyCur(e.target.checked)} />{t('只看 {coin}', { coin: current })}</label></div>}
      </div>
      <div className="tx-bottom-body">
        {!connected ? <div className="tx-empty"><Wallet size={20} aria-hidden="true" /><span>{t('连接钱包后在这里查看仓位、委托和成交记录')}</span><button type="button" className="tx-btn tx-btn-sm" onClick={() => { needWallet() }}>{t('连接 0x4 Wallet')}</button></div>
          : acct.kind === 'locked' ? <div className="tx-empty"><Lock size={20} aria-hidden="true" /><span>{t('0x4 Wallet 已锁定，解锁后显示仓位、委托和成交')}</span><button type="button" className="tx-btn tx-btn-sm" onClick={onUnlock}>{t('解锁')}</button></div>
          : acct.kind === 'error' ? <div className="tx-empty"><span>{t('暂时无法读取合约账户：{err}', { err: acct.msg })}</span><button type="button" className="tx-btn tx-btn-sm" onClick={onRetry}><RefreshCw size={13} />{t('重试')}</button></div>
            : acct.kind === 'cancelled' ? <div className="tx-empty"><span>{t('你在插件里取消了签名，没有读取合约账户')}</span><button type="button" className="tx-btn tx-btn-sm" onClick={onRetry}><RefreshCw size={13} />{t('重试')}</button></div>
            : acct.kind === 'noAgent' ? <div className="tx-empty"><span>{t('授权交易密钥后，这里显示你的仓位、委托和成交（包括小精灵开的）')}</span><button type="button" className="tx-btn tx-btn-sm" disabled={authBusy} onClick={onAuthorize}>{authBusy ? <LoaderCircle size={13} className="animate-spin" /> : null}{t('授权交易密钥')}</button></div>
            : acct.kind === 'noDeposit' ? <div className="tx-empty"><span>{t('合约账户还没有资金，存入 USDT 后就能开仓')}</span></div>
            : loading ? <div className="tx-empty"><span className="tx-spin" aria-hidden="true" /><span>{t('正在读取合约账户')}</span></div>
              : tab === 'pos' ? (positions.length ? (
                <div className="tx-table-wrap"><table className="tx-table">
                  <thead><tr><th>{t('合约')}</th><th className="r">{t('数量')}</th><th className="r">{t('仓位价值')}</th><th className="r">{t('开仓价')}</th><th className="r">{t('标记价')}</th><th className="r">{t('强平价')}</th><th className="r">{t('保证金')}</th><th className="r">{t('未实现盈亏')}</th><th className="r" aria-label={t('操作')} /></tr></thead>
                  <tbody>{positions.map((p) => {
                    const key = `${p.coin}:${p.isLong}`
                    return <tr key={key}>
                      <td><button type="button" className="tx-cell-coin" onClick={() => onPick(p.coin)}><CoinIcon coin={p.coin} size={18} /><b>{p.coin}</b><span className={`tx-dir ${p.isLong ? 'up' : 'down'}`}>{p.isLong ? t('多') : t('空')} {p.leverage}x{p.isCross ? '' : ` ${t('逐仓')}`}</span></button></td>
                      <td className="r">{fmtAmount(p.size)}</td>
                      <td className="r">{money(p.positionValue)}</td>
                      <td className="r">{pxOf(p.entryPx, p.coin)}</td>
                      <td className="r">{pxOf(markOf(p.coin), p.coin)}</td>
                      <td className="r warn">{p.liquidationPx ? pxOf(p.liquidationPx, p.coin) : '--'}</td>
                      <td className="r">{money(p.marginUsed)}</td>
                      <td className={`r ${dir(p.unrealizedPnl)}`}>{signed(p.unrealizedPnl)}<small>{pct(p.roe)}</small></td>
                      <td className="r"><button type="button" className={`tx-btn tx-btn-sm ${arming === key ? 'is-danger' : ''}`} disabled={working === key} onClick={async () => {
                        if (arming !== key) return setArming(key)
                        setArming(null); setWorking(key)
                        try { await onClose(p) } finally { setWorking(null) }
                      }}>{working === key ? t('处理中…') : arming === key ? t('确认市价平仓') : t('市价平仓')}</button></td>
                    </tr>
                  })}</tbody>
                </table></div>
              ) : <div className="tx-empty"><span>{onlyCur ? t('{coin} 没有仓位', { coin: current }) : t('没有仓位')}</span></div>)
                : tab === 'orders' ? (ords.length ? (
                  <div className="tx-table-wrap"><table className="tx-table">
                    <thead><tr><th>{t('合约')}</th><th>{t('方向')}</th><th>{t('类型')}</th><th className="r">{t('数量')}</th><th className="r">{t('价格')}</th><th className="r">{t('时间')}</th><th className="r" aria-label={t('操作')} /></tr></thead>
                    <tbody>{ords.map((o) => <tr key={o.oid}>
                      <td><button type="button" className="tx-cell-coin" onClick={() => onPick(o.coin)}><CoinIcon coin={o.coin} size={18} /><b>{o.coin}</b></button></td>
                      <td className={o.isBuy ? 'up' : 'down'}>{o.isBuy ? t('买') : t('卖')}{o.reduceOnly ? ` · ${t('只减仓')}` : ''}</td>
                      <td>{o.trigger && o.trigger !== 'Limit' ? o.trigger : t('限价')}</td>
                      <td className="r">{fmtAmount(o.size)}</td>
                      <td className="r">{pxOf(o.limitPx, o.coin)}</td>
                      <td className="r mute">{o.timestamp ? when(o.timestamp) : '--'}</td>
                      <td className="r"><button type="button" className="tx-btn tx-btn-sm" disabled={working === `o${o.oid}`} onClick={async () => { setWorking(`o${o.oid}`); try { await onCancel(o) } finally { setWorking(null) } }}>{t('撤单')}</button></td>
                    </tr>)}</tbody>
                  </table></div>
                ) : <div className="tx-empty"><span>{t('没有委托。限价单、止盈止损挂上以后会显示在这里。')}</span></div>)
                  : (fls.length ? (
                    <div className="tx-table-wrap"><table className="tx-table">
                      <thead><tr><th>{t('时间')}</th><th>{t('合约')}</th><th>{t('方向')}</th><th className="r">{t('价格')}</th><th className="r">{t('数量')}</th><th className="r">{t('手续费')}</th><th className="r">{t('已实现盈亏')}</th></tr></thead>
                      <tbody>{fls.map((f, i) => <tr key={f.hash + i}>
                        <td className="mute">{when(f.time)}</td>
                        <td><button type="button" className="tx-cell-coin" onClick={() => onPick(f.coin)}><b>{f.coin}</b></button></td>
                        <td className={f.isBuy ? 'up' : 'down'}>{f.dir}</td>
                        <td className="r">{pxOf(f.px, f.coin)}</td>
                        <td className="r">{fmtAmount(f.sz)}</td>
                        <td className="r">{money(f.fee)}</td>
                        <td className={`r ${f.closedPnl ? dir(f.closedPnl) : ''}`}>{f.closedPnl ? signed(f.closedPnl) : '--'}</td>
                      </tr>)}</tbody>
                    </table></div>
                  ) : <div className="tx-empty"><span>{t('还没有成交')}</span></div>)}
      </div>
    </section>
  )
}

/** Replace {chain} in the copy with bold "BNB Chain" (translate the whole sentence together, keep the bold) */
function boldChain(s: string) {
  const [a, b = ''] = s.split('{chain}')
  return <>{a}<b>BNB Chain</b>{b}</>
}

/** Deposit / withdraw: both go through USDT on BNB Chain, gas in BNB. Same functions and same validation as the phone perps page's deposit sheet (centered modal on desktop) */
function FundModal({ mode, onClose, account }: { mode: 'deposit' | 'withdraw' | null; onClose: () => void; account: PerpAccount | null }) {
  const { evmAddress, evmAccount } = useWallet()
  const holdings = usePortfolio((s) => s.holdings)
  // USD stablecoins on other chains: prompt to swap into USDT on BNB Chain first
  const others = holdings.filter((h) => ['USDT', 'USDC', 'USDG', 'USDE'].includes(h.symbol.toUpperCase()) && !(h.chainId === BSC_CHAIN_ID && h.symbol.toUpperCase() === 'USDT') && h.amount >= 1)
  const [fee, setFee] = useState<number | null>(null)
  const [phase, setPhase] = useState('')
  const [amount, setAmount] = useState('')
  const [bal, setBal] = useState<number | null>(null)
  const [asset, setAsset] = useState<'USDT' | 'BNB'>('USDT')
  const [bnbBal, setBnbBal] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (mode === 'deposit' && evmAddress) { bscUsdtBalance(evmAddress).then(setBal).catch(() => setBal(null)); bscBnbBalance(evmAddress).then(setBnbBal).catch(() => setBnbBal(null)) }
    if (mode === 'withdraw') estimateWithdrawFee().then(setFee).catch(() => setFee(null))
    if (!mode) { setAmount(''); setPhase(''); setAsset('USDT') }
  }, [mode, evmAddress])
  const n = Number(amount) || 0
  const go = async () => {
    if (!perpGate()) return
    if (!evmAccount) return toast.error(t('钱包已锁定'))
    setBusy(true)
    try {
      if (mode === 'deposit' && asset === 'BNB') { await depositBnb(evmAccount, n, setPhase); toast.success(t('已把 {n} BNB 换成 USDT 存入，约 1–3 分钟到账', { n })) }
      else if (mode === 'deposit') { setPhase(t('正在签名…')); await depositUsdt(evmAccount, n, () => setPhase(t('第 1 步：授权 USDT（钱包签名）'))); toast.success(t('已存入 {n} USDT，约 1–3 分钟到账', { n })) }
      else { await withdrawUsdt(evmAccount, n); toast.success(t('已提出，几分钟内到账 BNB Chain')) }
      onClose()
    } catch (e) { alertError(e, mode === 'deposit' ? t('存入失败') : t('提出失败')) } finally { setBusy(false) }
  }
  const balText = asset === 'USDT' ? `${bal === null ? '--' : fmtAmount(bal)} USDT` : `${bnbBal === null ? '--' : fmtAmount(bnbBal)} BNB`
  const canAll = (asset === 'USDT' && bal !== null && bal > 0) || (asset === 'BNB' && bnbBal !== null && bnbBal > BNB_GAS_RESERVE)
  return (
    <Modal open={!!mode} onClose={onClose} dismissible={!busy} title={mode === 'deposit' ? t('存入 USDT') : t('提出 USDT')}>
      {mode === 'deposit' ? (
        <>
          <div className="tx-seg" role="group" aria-label={t('存入币种')} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            {(['USDT', 'BNB'] as const).map((a) => <button key={a} type="button" aria-pressed={asset === a} className={asset === a ? 'on' : ''} onClick={() => { setAsset(a); setAmount('') }}>{a}</button>)}
          </div>
          <p>{asset === 'USDT' ? boldChain(t('用钱包里 {chain} 上的 USDT 存入合约账户，最少 {min} USDT，约 1–3 分钟到账。手续费用 BNB 支付（约 $0.05）。', { min: MIN_DEPOSIT })) : <>{t('你的 BNB 会按当前价格换成 USDT，存进合约账户。之后保证金一直按 USDT 计算，BNB 涨跌不会影响它。')} {t('过程中需要在钱包里确认 2 到 3 次，请留 {n} BNB 作为网络手续费。', { n: BNB_GAS_RESERVE })}</>}</p>
          <label className="tx-field"><span>{t('金额（{asset}）', { asset })}</span><input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={asset === 'USDT' ? '100' : '0.1'} autoFocus /><small>{asset}</small></label>
          <div className="tx-sec-label"><span>{t('BNB Chain 余额 {v}', { v: balText })}</span>{canAll && <button type="button" className="tx-link" onClick={() => setAmount(asset === 'USDT' ? String(Math.floor((bal || 0) * 100) / 100) : String(Math.floor(((bnbBal || 0) - BNB_GAS_RESERVE) * 10000) / 10000))}>{t('全部')}</button>}</div>
          {asset === 'USDT' && others.map((h) => <Link key={`${h.chainId}:${h.mint}`} to={`/swap?from=${h.chainId}:${h.mint}&to=${BSC_CHAIN_ID}:${BSC_USDT}`} onClick={onClose} className="tx-note"><span className="mute">{t('{chain} 上有 {amount} {symbol}', { chain: chainName(h.chainId), amount: fmtAmount(h.amount), symbol: h.symbol })}</span><span className="tx-link">{t('闪兑成 BNB Chain USDT')}</span></Link>)}
          {phase && <p role="status">{phase}</p>}
          <button type="button" className="tx-btn tx-btn-lg is-pearl" disabled={busy || (asset === 'USDT' ? !(n >= MIN_DEPOSIT) : !(n > 0))} onClick={() => void go()}>
            {busy && <LoaderCircle size={16} className="tx-spin-ic" aria-hidden="true" />}{asset === 'USDT' ? t('存入 {amount}', { amount: n ? `${n} USDT` : '' }) : t('换成 USDT 并存入 {amount}', { amount: n ? `${n} BNB` : '' })}
          </button>
        </>
      ) : (
        <>
          <p>{boldChain(t('提回你钱包的 {chain} 地址，手续费约 {fee} USDT（按当时网络费估算），几分钟内到账。', { fee: fee === null ? '--' : fee }))}</p>
          <label className="tx-field"><span>{t('金额（USDT）')}</span><input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100" autoFocus /><small>USDT</small></label>
          <div className="tx-sec-label"><span>{t('可提 {amount} USDT', { amount: account ? fmtAmount(account.withdrawable) : '--' })}</span>{account && account.withdrawable > 0 && <button type="button" className="tx-link" onClick={() => setAmount(String(Math.floor(account.withdrawable * 100) / 100))}>{t('全部')}</button>}</div>
          <button type="button" className="tx-btn tx-btn-lg is-pearl" disabled={busy || !(n > (fee ?? 0.2))} onClick={() => void go()}>
            {busy && <LoaderCircle size={16} className="tx-spin-ic" aria-hidden="true" />}{t('提出 {amount}', { amount: n ? `${n} USDT` : '' })}
          </button>
        </>
      )}
    </Modal>
  )
}
