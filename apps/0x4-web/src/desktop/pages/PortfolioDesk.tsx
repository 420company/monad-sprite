// Web "My assets" (/portfolio, entered from the wallet capsule menu; web's / lands here too. 2026-09-29 goat: "I tapped personal center and got the phone-preview UI again").
// Layout references pro exchanges' asset pages (docs/WEB_DESIGN.md):
//   Top block: big total-assets number + today's PnL + refresh state, actions top-right (Receive · Send · Swap · Perps), per-chain addresses below (tap to copy), then three small stat cells;
// Tabs below: assets (token, network, amount, price, value, 24h) · perp positions · activity.
// Balances, today's PnL, activity, and the perps account all reuse the phone home / activity / perps pages' stores and functions (usePortfolio, useDayPnl, useActivityTimeline, loadAccount),
// No separate implementation; receive / send reuse the phone's business components, with the shell as a centered modal on wide web screens (components/Sheet).
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDownLeft, ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, ArrowUpRight, ChevronRight, Clock, Copy, Crown, Eye, EyeOff, RefreshCw, Repeat, TrendingUp, Wallet, WifiOff, XCircle } from 'lucide-react'
import TokenLogo from '@/components/TokenLogo'
import ReceiveSheet from '@/components/ReceiveSheet'
import SendSheet from '@/components/SendSheet'
import FeeSheet from '@/components/FeeSheet'
import { DayPnlSheet, signedMoney, signedPct } from '@/components/DayPnl'
import SwapPanel, { StatusPill } from '@/pages/Swap'
import Sheet from '@/components/Sheet'
import { ACTIVITY_FILTERS, subtitleOf, titleOf, useActivityTimeline, type ActivityFilter } from '@/pages/Activity'
import { BTC_CHAIN_ID, SOLANA_CHAIN_ID, chainById, chainName, isNative } from '@/lib/chains'
import { fmtAmount, fmtMoney, fmtPct, fmtUsd, timeAgo } from '@/lib/format'
import { pnlSign, summarize } from '@/lib/dayPnl'
import { authorizePerpAgent, loadAccount, type PerpAccount } from '@/lib/aster'
import { useFees } from '@/lib/fees'
import { errorText, isUserCancel } from '@/lib/errors'
import { toast } from '@/components/Toast'
import { locale, t } from '@/lib/i18n'
import { oneOf, usePageState } from '@/lib/pageState'
import type { Holding } from '@/lib/types'
import { usePortfolio } from '@/store/portfolio'
import { useWallet } from '@/store/wallet'
import { useSettings } from '@/store/settings'
import { useDayPnl } from '@/store/dayPnl'
import { useSocial } from '@/store/social'
import { Empty, copyAddr, midShort } from '../ui'
import { useExternalWallet } from '../Ox4Only'
import { getOx4Wallet, unlockOx4 } from '../walletGate'

type Tab = 'assets' | 'perp' | 'activity'
const tone = (v: number) => (pnlSign(v) > 0 ? 'wc-up' : pnlSign(v) < 0 ? 'wc-down' : 'wc-mute')
const money = (v: number) => (v >= 1e6 ? fmtUsd(v, { compact: true }) : fmtMoney(v))
/** Tapping a position: Bitcoin has no market page; EVM native coins go to spot (swap); everything else goes to the coin detail */
// Bitcoin swap (2026-09-30): tapping the BTC row opens the swap, pre-selecting sell-BTC
const holdingPath = (h: Holding) => h.chainId === BTC_CHAIN_ID ? `/swap?from=${BTC_CHAIN_ID}:bitcoin` : h.chainId !== SOLANA_CHAIN_ID && isNative(h.mint) ? '/spot' : `/token/${chainById(h.chainId)?.dexKey || 'solana'}/${h.mint}`

export default function PortfolioDesk() {
  const nav = useNavigate()
  const { address, evmAddress, btcAddress } = useWallet()
  const external = useExternalWallet()
  const { hideBalance, toggleHideBalance } = useSettings()
  const { holdings, btc, totalUsd, loading, error, refresh, lastUpdated } = usePortfolio()
  const [modal, setModal] = useState<'receive' | 'send' | 'swap' | 'pnl' | 'tier' | null>(null)
  const [tab, setTab] = usePageState<Tab>('desk.portfolio.tab', 'assets', oneOf('assets', 'perp', 'activity'))
  // Deep-linking to a specific tab from elsewhere (/activity → /portfolio?tab=activity)
  const [params] = useSearchParams()
  useEffect(() => { const q = params.get('tab'); if (q === 'assets' || q === 'perp' || q === 'activity') setTab(q) }, [params]) // eslint-disable-line react-hooks/exhaustive-deps

  // Same refresh as the mobile home: refresh if stale for over 15s on entry, then silently every 30s; only manual refreshes show a spinner
  const [manual, setManual] = useState(false)
  const refreshNow = () => { setManual(true); Promise.resolve(refresh()).finally(() => setManual(false)) }
  useEffect(() => {
    if (Date.now() - usePortfolio.getState().lastUpdated > 15_000) refresh()
    const timer = setInterval(refresh, 30_000)
    return () => clearInterval(timer)
  }, [refresh, address, evmAddress])

  // Today's PnL (spot + perps, same scope as home) and account types
  const socialReady = useSocial((s) => s.status === 'ready')
  const { ledger, perp } = useDayPnl()
  useEffect(() => { void useDayPnl.getState().update() }, [lastUpdated, address, socialReady])
  useEffect(() => { if (socialReady) void useFees.getState().load() }, [socialReady, address])
  const pnl = summarize(ledger, perp, Date.now())
  const fees = useFees((s) => s.fees)
  const vip = fees.vip
  const feesFor = useFees((s) => (s.loadedAt > 0 ? s.account : null))
  const meAddr = useSocial((s) => s.me?.address)

  // Bitcoin positions are stored separately (store/portfolio) — merged into the list here, sorted by value
  const positions = useMemo(() => (btc ? [...holdings, btc].sort((a, b) => b.valueUsd - a.valueUsd) : holdings).filter((h) => h.amount > 0), [holdings, btc])
  const hasSnapshot = lastUpdated > 0
  const unpriced = positions.filter((h) => !(h.priceUsd > 0)).length
  const balanceKnown = hasSnapshot && (positions.length === 0 || unpriced < positions.length)
  // When the perps account is readable, total assets include perps account equity (same scope as today's PnL: spot + perps)
  const perpEquity = pnl?.perp?.equity ?? null
  const grandTotal = totalUsd + (perpEquity || 0)
  const mask = (s: string) => (hideBalance ? '****' : s)
  const firstLoad = !hasSnapshot && !error
  const updated = hasSnapshot ? new Date(lastUpdated).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : null
  const addrs = [
    evmAddress && { k: 'EVM', v: evmAddress },
    address && { k: 'Solana', v: address },
    btcAddress && { k: 'Bitcoin', v: btcAddress },
  ].filter(Boolean) as { k: string; v: string }[]

  return (
    <div className="wc-page">
      <header className="wc-head">
        <div>
          <h1 className="wc-title">{t('我的资产')}</h1>
          <p className="wc-sub">{t('各条链的余额、合约账户和收发记录。')}</p>
        </div>
      </header>

      {/* Overview */}
      <section className="wc-panel" aria-label={t('资产概览')} aria-busy={loading}>
        <div className="wc-pf-sum">
          <div className="min-w-0">
            <div className="wc-pf-label">
              {unpriced > 0 ? t('已估值资产') : t('总资产')}
              <button type="button" className="wc-btn is-ghost is-sm is-icon" onClick={toggleHideBalance} aria-pressed={hideBalance} aria-label={hideBalance ? t('显示资产') : t('隐藏资产')} title={hideBalance ? t('显示资产') : t('隐藏资产')}>{hideBalance ? <EyeOff size={15} /> : <Eye size={15} />}</button>
              {meAddr && feesFor === meAddr && <button type="button" className={`wc-chip ${vip ? 'is-accent' : ''}`} onClick={() => setModal('tier')} aria-label={t('账户种类：{kind}', { kind: vip ? 'VIP' : t('普通') })}>{vip && <Crown size={11} aria-hidden="true" />}{vip ? 'VIP' : t('普通账户')}</button>}
            </div>
            <div className="wc-pf-total" title={balanceKnown ? mask(fmtMoney(grandTotal)) : undefined}>
              {firstLoad && !hideBalance ? <span className="wc-sk" style={{ width: 260, height: 40 }} aria-label={t('正在加载资产')} /> : mask(balanceKnown ? (grandTotal >= 1e6 ? fmtUsd(grandTotal, { compact: true }) : fmtMoney(grandTotal)) : '--')}
            </div>
            <div className="wc-pf-pnl" role="status">
              {pnl && balanceKnown && (
                <button type="button" className="flex items-center gap-1.5 hover:text-[var(--w-fg)]" onClick={() => setModal('pnl')} aria-label={t('查看今日盈亏')}>
                  {t('今日盈亏')}
                  {hideBalance ? <b>****</b> : <b className={tone(pnl.pnl)}>{signedMoney(pnl.pnl)}{pnl.pct !== null && ` (${signedPct(pnl.pnl, pnl.pct)})`}</b>}
                  <ChevronRight size={13} aria-hidden="true" />
                </button>
              )}
              <span className={error ? 'text-[var(--color-warning)]' : ''}>
                {error ? (updated ? t('暂时无法更新余额 · 上次更新 {time}', { time: updated }) : t('暂时无法更新余额')) : firstLoad ? t('正在更新资产') : manual && loading ? t('正在更新') : unpriced > 0 ? t('{n} 项资产暂无报价', { n: unpriced }) : t('已更新 {time}', { time: updated ?? '' })}
              </span>
              <button type="button" className="wc-btn is-ghost is-sm is-icon" onClick={refreshNow} disabled={manual && loading} aria-label={t('刷新资产')} title={t('刷新资产')}><RefreshCw size={13} className={manual && loading ? 'animate-spin' : ''} /></button>
            </div>
          </div>
          <div className="wc-pf-acts" role="group" aria-label={t('钱包操作')}>
            <button type="button" className="wc-btn is-primary" onClick={() => setModal('receive')}><ArrowDownToLine size={15} />{t('收款')}</button>
            <button type="button" className="wc-btn" onClick={() => setModal('send')}><ArrowUpFromLine size={15} />{t('发送')}</button>
            {/* Swaps happen in a modal on this page (2026-10-02 goat: it used to jump to the spot page, which didn't feel like a swap): any coin to any coin, same-chain or cross-chain */}
            <button type="button" className="wc-btn" onClick={() => setModal('swap')}><Repeat size={15} />{t('闪兑')}</button>
            <button type="button" className="wc-btn" onClick={() => nav('/perp')}><TrendingUp size={15} />{t('合约')}</button>
          </div>
        </div>
        {addrs.length > 0 && (
          <div className="wc-pf-addrs">
            {addrs.map((a) => <button key={a.k} type="button" className="wc-addr" onClick={() => copyAddr(a.v)} title={a.v} aria-label={t('复制 {chain} 地址', { chain: a.k })}><em>{a.k}</em><code>{midShort(a.v)}</code><Copy size={12} aria-hidden="true" /></button>)}
            {/* External wallets don't do Bitcoin: Bitcoin is a 0x4 Wallet exclusive — tapping goes to get it (2026-09-30) */}
            {external && <button type="button" className="wc-addr is-ox4" onClick={getOx4Wallet}><em>Bitcoin</em><span>{t('0x4 Wallet 专属')}</span></button>}
          </div>
        )}
        <dl className="wc-pf-stats" style={{ borderTop: '1px solid var(--w-line)' }}>
          <div><dt>{t('钱包资产')}</dt><dd>{balanceKnown ? mask(money(totalUsd)) : '--'}<small>{t('{n} 项资产', { n: hasSnapshot ? positions.length : '--' })}</small></dd></div>
          <div><dt>{t('合约账户')}</dt><dd>{perpEquity !== null ? mask(money(perpEquity)) : '--'}<small>{perpEquity !== null ? t('保证金用 BNB Chain 上的 USDT') : t('未开通或暂时读不到')}</small></dd></div>
          {/* Third cell: cumulative volume and the VIP threshold (server-verified volume, /api/fees/me); today's PnL is already under the big number, not repeated */}
          <div><dt>{t('累计交易额')}</dt><dd>{feesFor === meAddr && meAddr ? mask(money(fees.volume.spot + fees.volume.perp)) : '--'}<small>{vip ? t('已是 VIP，手续费更低') : t('现货满 {a} 或合约满 {b} 自动升级 VIP', { a: fmtUsd(fees.target.spot, { compact: true }), b: fmtUsd(fees.target.perp, { compact: true }) })}</small></dd></div>
        </dl>
      </section>

      {/* Tab bar */}
      <section className="wc-panel is-clip">
        <div className="wc-tabs" role="tablist" aria-label={t('资产明细')}>
          <button type="button" role="tab" aria-selected={tab === 'assets'} onClick={() => setTab('assets')}>{t('资产')}{hasSnapshot && positions.length > 0 && <span className="wc-mute num">{positions.length}</span>}</button>
          <button type="button" role="tab" aria-selected={tab === 'perp'} onClick={() => setTab('perp')}>{t('合约仓位')}</button>
          <button type="button" role="tab" aria-selected={tab === 'activity'} onClick={() => setTab('activity')}>{t('活动记录')}</button>
        </div>
        {tab === 'assets' && <AssetsTable positions={positions} firstLoad={firstLoad} error={!!error && !positions.length} mask={mask} onRetry={refreshNow} onReceive={() => setModal('receive')} />}
        {tab === 'perp' && <PerpPositions mask={mask} />}
        {tab === 'activity' && <ActivityTable />}
      </section>

      <ReceiveSheet open={modal === 'receive'} onClose={() => setModal(null)} address={address} evmAddress={evmAddress} />
      <SendSheet open={modal === 'send'} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh() }} />
      <Sheet open={modal === 'swap'} center onClose={() => { setModal(null); refresh() }} title={t('闪兑')}>
        <SwapPanel bare />
      </Sheet>
      <DayPnlSheet open={modal === 'pnl'} onClose={() => setModal(null)} summary={pnl} hidden={hideBalance} walletUsd={balanceKnown ? totalUsd : null} />
      <FeeSheet open={modal === 'tier'} onClose={() => setModal(null)} />
    </div>
  )
}

/** Assets table: token, network, amount, price, value, 24h; tapping a row goes to markets / spot */
function AssetsTable({ positions, firstLoad, error, mask, onRetry, onReceive }: { positions: Holding[]; firstLoad: boolean; error: boolean; mask: (s: string) => string; onRetry: () => void; onReceive: () => void }) {
  if (error) return <Empty tall icon={WifiOff} text={t('持仓暂不可用')} action={<button type="button" className="wc-btn is-sm" onClick={onRetry}><RefreshCw size={13} />{t('重试')}</button>} />
  return (
    <div className="wc-assets" role="table" aria-label={t('资产')}>
      <div className="wc-tr is-th" role="row">
        <span role="columnheader">{t('资产')}</span><span role="columnheader">{t('网络')}</span>
        <span role="columnheader" className="r">{t('数量')}</span><span role="columnheader" className="r wc-hide-md">{t('价格')}</span>
        <span role="columnheader" className="r">{t('价值')}</span><span role="columnheader" className="r wc-hide-md">24h</span><span role="columnheader" />
      </div>
      {firstLoad ? Array.from({ length: 4 }, (_, i) => <div key={i} className="wc-tr" role="row"><span className="wc-sk" style={{ height: 16, width: '60%' }} /><span className="wc-sk" style={{ height: 12, width: 70 }} /><span /><span className="wc-hide-md" /><span /><span className="wc-hide-md" /><span /></div>)
        : !positions.length ? <Empty tall icon={Wallet} text={t('暂无资产')} action={<button type="button" className="wc-btn is-sm is-primary" onClick={onReceive}><ArrowDownToLine size={13} />{t('收款')}</button>} />
          : positions.map((h) => {
            const to = holdingPath(h)
            const chain = chainById(h.chainId)
            const cells = <>
              <span role="cell" className="wc-id"><TokenLogo src={h.logo} symbol={h.symbol} size={30} chain={h.chainId === SOLANA_CHAIN_ID ? 'solana' : chain?.dexKey} address={h.mint} /><span><b><span>{h.symbol}</span></b><small>{h.name}</small></span></span>
              <span role="cell" className="wc-chainpill">{chain?.logo && <img src={chain.logo} alt="" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />}<span className="wc-ell">{chain?.name || t('未知网络')}</span></span>
              <span role="cell" className="r num">{mask(fmtAmount(h.amount))}</span>
              <span role="cell" className="r num wc-hide-md">{h.priceUsd > 0 ? fmtUsd(h.priceUsd) : '--'}</span>
              <span role="cell" className="r num" style={{ fontWeight: 600 }}>{mask(h.priceUsd > 0 ? money(h.valueUsd) : '--')}</span>
              <span role="cell" className={`r num wc-hide-md ${h.priceUsd > 0 && h.change24h != null ? ((h.change24h ?? 0) >= 0 ? 'wc-up' : 'wc-down') : 'wc-mute'}`}>{h.priceUsd > 0 && h.change24h != null ? fmtPct(h.change24h) : '--'}</span>
              <span role="cell" className="r">{to && <span className="wc-btn is-sm" aria-hidden="true">{t('交易||action')}</span>}</span>
            </>
            return to
              ? <Link key={`${h.chainId}:${h.mint}`} to={to} className="wc-tr" role="row">{cells}</Link>
              : <div key={`${h.chainId}:${h.mint}`} className="wc-tr" role="row">{cells}</div>
          })}
    </div>
  )
}

/** Perp positions: only fetched when this tab opens (needs the perp agent signature); same endpoint and "not yet enabled" check as the perp page */
function PerpPositions({ mask }: { mask: (s: string) => string }) {
  const nav = useNavigate()
  const { evmAccount, keysUnlocked } = useWallet()
  const [acc, setAcc] = useState<PerpAccount | null>(null)
  const [noAccount, setNoAccount] = useState(false)
  // Trading key not authorized yet (web extension): the account may already hold funds or the sprite's positions — just unreadable. It used to be lumped with "not enabled", saying "perps account not opened" (2026-10-05 goat saw this after depositing 20 USDT)
  const [noAgent, setNoAgent] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!evmAccount || !keysUnlocked) { setLoading(false); return }
    let alive = true
    setLoading(true); setErr(null)
    loadAccount(evmAccount)
      .then((a) => { if (alive) { setAcc(a); setNoAccount(false); setNoAgent(false) } })
      .catch((e) => {
        if (!alive) return
        // NO_AGENT / "only be used after deposit": this wallet hasn't opened a perps account on the exchange yet — a normal state for new users, not a malfunction
        const msg = errorText(e, t('读取失败'))
        const raw = e instanceof Error ? e.message : ''
        const agent = raw === 'NO_AGENT' || msg === 'NO_AGENT'
        const fresh = !agent && /only be used after deposit/i.test(`${raw} ${msg}`)
        setNoAgent(agent); setNoAccount(fresh); setErr(agent || fresh ? null : msg); setAcc(null)
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [evmAccount, keysUnlocked, retry])
  const goPerp = <button type="button" className="wc-btn is-sm" onClick={() => nav('/perp')}><TrendingUp size={13} />{t('去合约')}</button>
  if (!evmAccount) return <Empty tall icon={TrendingUp} text={t('合约用 BNB Chain 地址交易，连接后在合约页开通。')} action={goPerp} />
  // 0x4 extension locked (since 2026-10-06, extension locking no longer logs web out): reading the perps account needs the extension's signature — no auto unlock pop
  if (!keysUnlocked) return <Empty tall icon={TrendingUp} text={t('0x4 Wallet 已锁定，解锁后显示合约账户的余额和仓位。')} action={<button type="button" className="wc-btn is-sm" onClick={() => void unlockOx4()}>{t('解锁')}</button>} />
  if (loading && !acc) return <div className="flex flex-col gap-3 p-5">{Array.from({ length: 3 }, (_, i) => <span key={i} className="wc-sk" style={{ height: 40 }} />)}</div>
  if (noAgent) return <Empty tall icon={TrendingUp} text={t('授权交易密钥后显示合约账户的余额和仓位（包括小精灵开的）。')} action={<button type="button" className="wc-btn is-sm" disabled={authBusy} onClick={async () => {
    if (!evmAccount) return
    setAuthBusy(true)
    try { await authorizePerpAgent(evmAccount); setRetry((n) => n + 1) } catch (e) { if (!isUserCancel(e)) toast.error(errorText(e, t('授权失败'))) } finally { setAuthBusy(false) }
  }}>{authBusy ? t('授权中…') : t('授权交易密钥')}</button>} />
  if (noAccount) return <Empty tall icon={TrendingUp} text={t('合约账户未开启，转入 USDT 后自动开启。')} action={goPerp} />
  if (err && !acc) return <Empty tall icon={WifiOff} text={t('合约账户暂时读不到：{reason}', { reason: err })} action={<button type="button" className="wc-btn is-sm" onClick={() => setRetry((n) => n + 1)}><RefreshCw size={13} />{t('重试')}</button>} />
  if (!acc) return null
  return (
    <>
      <div className="wc-pos" role="table" aria-label={t('合约仓位')}>
        <div className="wc-tr is-th" role="row">
          <span role="columnheader">{t('合约')}</span><span role="columnheader">{t('方向')}</span>
          <span role="columnheader" className="r">{t('数量')}</span><span role="columnheader" className="r">{t('开仓价')}</span>
          <span role="columnheader" className="r">{t('仓位价值')}</span><span role="columnheader" className="r">{t('未实现盈亏')}</span>
          <span role="columnheader" className="r">{t('强平价')}</span><span role="columnheader" />
        </div>
        {!acc.positions.length ? <Empty tall icon={TrendingUp} text={t('没有持仓')} action={goPerp} />
          : acc.positions.map((p) => (
            <Link key={p.coin} to={`/perp?coin=${encodeURIComponent(p.coin)}`} className="wc-tr" role="row">
              <span role="cell" className="wc-id"><span><b><span>{p.coin}USDT</span></b><small>{p.isCross ? t('全仓') : t('逐仓')} · {p.leverage}x</small></span></span>
              <span role="cell"><span className={`wc-chip ${p.isLong ? 'is-up' : 'is-down'}`}>{p.isLong ? t('多') : t('空')}</span></span>
              <span role="cell" className="r num">{mask(fmtAmount(p.size))}</span>
              <span role="cell" className="r num">{fmtUsd(p.entryPx)}</span>
              <span role="cell" className="r num">{mask(fmtMoney(p.positionValue))}</span>
              <span role="cell" className={`r num ${tone(p.unrealizedPnl)}`}>{mask(signedMoney(p.unrealizedPnl))} <span className="wc-mute">({fmtPct(p.roe * 100)})</span></span>
              <span role="cell" className="r num">{p.liquidationPx ? fmtUsd(p.liquidationPx) : '--'}</span>
              <span role="cell" className="r"><span className="wc-btn is-sm" aria-hidden="true">{t('管理||action')}</span></span>
            </Link>
          ))}
      </div>
      <div className="wc-pf"><span className="num">{t('账户权益 {a} · 可提 {b}', { a: mask(fmtMoney(acc.accountValue)), b: mask(fmtMoney(acc.withdrawable)) })}</span><button type="button" className="wc-btn is-ghost is-sm" onClick={() => setRetry((n) => n + 1)}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} />{t('刷新')}</button></div>
    </>
  )
}

/** Activity: the same timeline as the phone activity page (useActivityTimeline), filterable by chain; tapping a row opens the block explorer */
function ActivityTable() {
  const [filter, setFilter] = usePageState<ActivityFilter>('desk.portfolio.chain', 'all', oneOf(...ACTIVITY_FILTERS.map((f) => f.value)))
  const { list, rows, pending, notice, unavailableNames, refresh } = useActivityTimeline(filter)
  return (
    <div>
      <div className="wc-filter">
        <div className="wc-seg" role="group" aria-label={t('按链筛选')}>
          {ACTIVITY_FILTERS.map((f) => <button key={f.value} type="button" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>{t(f.label)}</button>)}
        </div>
        <span className="wc-grow" />
        <button type="button" className="wc-btn is-ghost is-sm" onClick={refresh}><RefreshCw size={13} className={list.loading ? 'animate-spin' : ''} />{t('刷新')}</button>
      </div>
      {(notice.failed.length > 0 || unavailableNames.length > 0) && list.items && (
        <div className="wc-note is-warn" style={{ margin: '12px 20px 0' }} role="status">
          <WifiOff size={15} aria-hidden="true" />
          <span>{notice.failed.length > 0 ? t('部分记录读取失败') : t('{chains} 的记录暂时查不到', { chains: unavailableNames.join('、') })}</span>
          {notice.failed.length > 0 && <button type="button" className="wc-btn is-sm" onClick={refresh}>{t('重试')}</button>}
        </div>
      )}
      <div className="wc-acts" role="table" aria-label={t('活动记录')}>
        <div className="wc-tr is-th" role="row">
          <span role="columnheader">{t('类型')}</span><span role="columnheader">{t('详情')}</span><span role="columnheader">{t('网络')}</span>
          <span role="columnheader" className="r">{t('时间')}</span><span role="columnheader" className="r">{t('状态')}</span>
        </div>
        {pending.map((b) => (
          <a key={b.txHash} href={chainById(b.fromChain)?.explorerTx(b.txHash)} target="_blank" rel="noreferrer" className="wc-tr" role="row">
            <span role="cell" className="wc-id"><span className="wc-tx-ic"><ArrowLeftRight size={15} className="text-[var(--w-accent)]" /></span><span><b><span>{t(b.fromChain === b.toChain ? '兑换 {from} → {to}' : '跨链 {from} → {to}', { from: b.fromSymbol, to: b.toSymbol })}</span></b></span></span>
            <span role="cell" className="wc-ell wc-mute">{fmtAmount(b.fromAmount)} {b.fromSymbol} · {chainName(b.fromChain)}{b.fromChain !== b.toChain ? ` → ${chainName(b.toChain)}` : ''}</span>
            <span role="cell" className="wc-chainpill">{chainName(b.fromChain)}</span>
            <span role="cell" className="r wc-mute">{timeAgo(b.createdAt)}</span>
            <span role="cell" className="r"><StatusPill status={b.status} /></span>
          </a>
        ))}
        {list.items === null && list.loading ? Array.from({ length: 5 }, (_, i) => <div key={i} className="wc-tr" role="row"><span className="wc-sk" style={{ height: 16, width: '70%' }} /><span className="wc-sk" style={{ height: 12, width: '60%' }} /><span /><span /><span /></div>)
          : list.failed && !list.items?.length ? <Empty tall icon={WifiOff} text={t('读取失败')} action={<button type="button" className="wc-btn is-sm" onClick={list.retry}><RefreshCw size={13} />{t('重试')}</button>} />
            : list.items && !rows.length && !list.loading && list.done && !pending.length ? <Empty tall icon={Clock} text={t('还没有交易记录')} />
              : rows.map((r) => {
                const chain = chainById(r.chainId)
                const Icon = r.status === 'failed' ? XCircle : r.kind === 'receive' ? ArrowDownLeft : r.kind === 'send' ? ArrowUpRight : r.kind === 'swap' || r.kind === 'bridge' ? ArrowLeftRight : Repeat
                const color = r.status === 'failed' ? 'var(--w-down)' : r.kind === 'receive' ? 'var(--w-up)' : r.kind === 'send' ? 'var(--w-fg)' : 'var(--w-accent)'
                return (
                  <a key={r.key} href={chain?.explorerTx(r.hash)} target="_blank" rel="noreferrer" className="wc-tr" role="row">
                    <span role="cell" className="wc-id"><span className="wc-tx-ic" style={{ color }}><Icon size={15} />{chain && <img src={chain.logo} alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}</span><span><b><span>{titleOf(r)}</span></b></span></span>
                    <span role="cell" className="wc-ell wc-mute">{subtitleOf(r)}</span>
                    <span role="cell" className="wc-chainpill"><span className="wc-ell">{chainName(r.chainId)}</span></span>
                    <span role="cell" className="r wc-mute">{r.status === 'pending' && !r.bridge ? t('待确认') : timeAgo(r.time)}</span>
                    <span role="cell" className="r">{r.status === 'failed' ? <span className="wc-chip is-down">{t('失败')}</span> : r.bridge ? <StatusPill status={r.bridge.status} /> : <span className="wc-chip is-up">{t('完成')}</span>}</span>
                  </a>
                )
              })}
      </div>
      {list.items && list.items.length > 0 && !list.done && (
        <div className="wc-pf" style={{ justifyContent: 'center' }}>
          {list.moreFailed ? <button type="button" className="wc-btn is-sm" onClick={list.retry}><RefreshCw size={13} />{t('加载失败，点这里重试')}</button>
            : <button type="button" className="wc-btn is-sm" onClick={list.loadMore} disabled={list.loading}>{list.loading ? t('加载中…') : t('加载更多')}</button>}
        </div>
      )}
    </div>
  )
}
