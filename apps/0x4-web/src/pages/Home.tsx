// Assets page: watchlist and holdings as two side-by-side tabs (2026-09-27 goat: holdings below the watchlist was invisible and dragged on); wallet, receive, and multi-chain send keep their existing wiring.
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowDownToLine, ArrowUpFromLine, Bug, ChevronRight, Clock, Copy, Eye, EyeOff, RefreshCw, Repeat, ShieldAlert, Star, TrendingUp, Wallet } from 'lucide-react'
import { PERP_ENABLED } from '@/lib/features'
import BellButton from '@/components/BellButton'
import { WEB_SURFACE } from '@/lib/surface'
import HomeBrand from '@/components/HomeBrand'
import MeetScan from '@/components/MeetScan'
import GasWatch from '@/components/GasWatch'
import FeeSheet from '@/components/FeeSheet'
import { AccountBadge, DayPnlLine, DayPnlSheet } from '@/components/DayPnl'
import Button from '@/components/Button'
import TokenLogo from '@/components/TokenLogo'
import TokenRow from '@/components/TokenRow'
import PriceChange from '@/components/PriceChange'
import ReceiveSheet from '@/components/ReceiveSheet'
import SendSheet from '@/components/SendSheet'
import { toast } from '@/components/Toast'
import { BTC_CHAIN_ID, SOLANA_CHAIN_ID, chainById, isNative } from '@/lib/chains'
import { fmtAmount, fmtMoney, fmtUsd, shortId } from '@/lib/format'
import { marketKey } from '@/lib/market'
import { usePortfolio } from '@/store/portfolio'
import { useWallet } from '@/store/wallet'
import { useSettings } from '@/store/settings'
import { useFavorites } from '@/store/favorites'
import { useMarket } from '@/store/market'
import { useDayPnl } from '@/store/dayPnl'
import { useSocial } from '@/store/social'
import { useFees } from '@/lib/fees'
import { summarize } from '@/lib/dayPnl'
import { copyText } from '@/lib/native'
import { locale, t } from '@/lib/i18n'
import { pressPrefetchHandlers } from '@/lib/candlePrefetch'

/** Max rows shown per home tab initially; "expand all" when holdings overflow */
const LIST_MAX = 6

export default function Home() {
  const { address, evmAddress, vault } = useWallet()
  const { backedUp, hideBalance, toggleHideBalance } = useSettings()
  const { holdings, btc, totalUsd, loading, error, refresh, lastUpdated } = usePortfolio()
  const [sheet, setSheet] = useState<'receive' | 'send' | 'pnl' | 'tier' | null>(null)
  const nav = useNavigate()
  // Diagnostics builds only (VITE_DIAG=1): meme.wallet.app://?receive=btc or build-time VITE_DIAG_OPEN=receive-btc opens the Bitcoin receive page directly,
  // for simulator acceptance screenshots (headless simulators can't tap deep-link confirm sheets); always false in production builds
  const loc = useLocation()
  const diagBtc = import.meta.env.VITE_DIAG === '1' && (new URLSearchParams(loc.search).get('receive') === 'btc' || import.meta.env.VITE_DIAG_OPEN === 'receive-btc')
  useEffect(() => { if (diagBtc) setSheet('receive') }, [diagBtc])
  const favorites = useFavorites((s) => s.items)
  // Watchlist by default; holdings when there's no watchlist. The chosen tab is remembered locally
  const [tab, setTab] = useState<'fav' | 'hold'>(() => { try { const v = localStorage.getItem('0x4.homeTab'); if (v === 'fav' || v === 'hold') return v } catch { /* Privacy mode */ } return useFavorites.getState().items.length ? 'fav' : 'hold' })
  const pickTab = (k: 'fav' | 'hold') => { setTab(k); try { localStorage.setItem('0x4.homeTab', k) } catch { /* Privacy mode */ } }
  const [showAll, setShowAll] = useState(false)
  const { cache, loadTokens } = useMarket()

  useEffect(() => {
    const byChain = new Map<string, string[]>()
    favorites.forEach((f) => byChain.set(f.chain, [...(byChain.get(f.chain) || []), f.address]))
    byChain.forEach((addrs, chain) => loadTokens(addrs, chain))
  }, [favorites, loadTokens])

  // Spinner and "updating" show only on manual refresh; the 30s background refresh stays silent so the UI doesn't flash every half minute (2026-09-25 goat feedback)
  const [manual, setManual] = useState(false)
  const refreshNow = () => { setManual(true); Promise.resolve(refresh()).finally(() => setManual(false)) }
  const showBusy = loading && manual

  useEffect(() => {
    if (Date.now() - usePortfolio.getState().lastUpdated > 15_000) refresh()
    const timer = setInterval(refresh, 30_000)
    return () => clearInterval(timer)
  }, [refresh, address])

  // Today's PnL (2026-09-29): recorded after each balance refresh; the perp portion comes from the server, not re-asked within 60s
  const socialReady = useSocial((s) => s.status === 'ready')
  const { ledger, perp } = useDayPnl()
  useEffect(() => { void useDayPnl.getState().update() }, [lastUpdated, address, socialReady])
  // The badge under the address needs the current account's tier (hidden on API failure)
  useEffect(() => { if (socialReady) void useFees.getState().load() }, [socialReady, address])
  const pnl = summarize(ledger, PERP_ENABLED ? perp : null, Date.now())

  // Bitcoin holdings stored separately (see store/portfolio); merged into the list here, sorted by value
  const positions = (btc ? [...holdings, btc].sort((a, b) => b.valueUsd - a.valueUsd) : holdings).filter((h) => h.amount > 0)
  const shownPositions = showAll ? positions : positions.slice(0, LIST_MAX)
  const hasSnapshot = lastUpdated > 0
  const unpriced = positions.filter((h) => !(h.priceUsd > 0)).length
  // Missing state when amounts are unknown; when some tokens lack quotes, say so — this is the valued portion.
  const balanceKnown = hasSnapshot && (positions.length === 0 || unpriced < positions.length)
  // When the perp account is readable, total assets include perp equity (same scope as today's PnL: spot + perp)
  const grandTotal = totalUsd + (pnl?.perp?.equity || 0)
  const balance = balanceKnown ? (grandTotal >= 1e6 ? fmtUsd(grandTotal, { compact: true }) : fmtMoney(grandTotal)) : '--'
  const mask = (value: string) => hideBalance ? '****' : value
  const updated = hasSnapshot ? new Date(lastUpdated).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : null
  const firstLoad = !hasSnapshot && !error

  // Home shows / copies the EVM address (shared by BNB Chain, Ethereum, etc.); it used to show the Solana address, and users who imported an EVM key
  // mistook the unfamiliar string for a wrongly imported wallet (2026-09-25 goat feedback). The Solana address is viewable under "receive" → Solana.
  const shownAddr = evmAddress || address || ''
  const copy = async () => {
    if (!shownAddr) return
    try { await copyText(shownAddr); toast.success(t('地址已复制')) }
    catch { toast.error(t('复制失败，请在收款页查看地址')) }
  }


  return (
    <div className="safe-top">
      <header className="page-header page-gutter">
        {/* Right of the logo: scroll official-announcement titles when present (tap for full text), otherwise "0x4" (2026-09-29).
   Web (phone browsers arriving via Me → My assets): the top bar already has 0x4 and the bell, so only the page title here, no duplicate set (2026-10-07) */}
        {WEB_SURFACE ? <h1 className="page-title">{t('我的资产')}</h1> : <HomeBrand />}
        <div className="account-tools">
          {/* Scan: log into desktop (Meet / Cyber Eden / admin). Phone app and phone browsers only; since 2026-09-28 this is the app's only such entry */}
          <MeetScan />
          {!WEB_SURFACE && <BellButton />}
          <button onClick={() => nav('/activity')} className="icon-button" aria-label={t('活动记录')} data-tooltip={t('活动记录')}><Clock size={20} /></button>
          <button onClick={refreshNow} disabled={showBusy} className="icon-button" aria-label={t('刷新资产')} data-tooltip={t('刷新资产')}><RefreshCw size={19} className={showBusy ? 'animate-spin' : ''} /></button>
        </div>
      </header>

      {/* Asset card: a real frosted-glass big card */}
      <section className="glass mx-4 rounded-[28px] px-5 pt-3 pb-5" aria-label={t('资产概览')} aria-busy={loading}>
        <div className="account-summary">
          <div className="flex items-center gap-1 text-[13px] text-muted">
            {unpriced > 0 ? t('已估值资产') : t('总资产')}
            <button onClick={toggleHideBalance} className="icon-button" aria-label={hideBalance ? t('显示资产') : t('隐藏资产')} aria-pressed={hideBalance} data-tooltip={hideBalance ? t('显示资产') : t('隐藏资产')}>{hideBalance ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          </div>
          <button onClick={copy} className="text-action font-mono" aria-label={t('复制钱包地址')} data-tooltip={t('复制钱包地址')}>{shortId(shownAddr)}<Copy size={13} /></button>
        </div>
        <div className="flex min-h-12 items-center">
          {firstLoad && !hideBalance ? <div className="skeleton h-10 w-44" aria-label={t('正在加载资产')} /> : <div className="balance-value number min-w-0" data-long={balance.length > 10 && !hideBalance} aria-label={balanceKnown ? mask(fmtMoney(grandTotal)) : undefined} title={balanceKnown ? mask(fmtMoney(grandTotal)) : undefined}>{mask(balance)}</div>}
          {/* Right under the address: account badge (regular / VIP); tap for tier and fee rates */}
          <span className="ml-auto shrink-0 self-start pl-2"><AccountBadge onOpen={() => setSheet('tier')} /></span>
        </div>
        {balanceKnown && <DayPnlLine summary={pnl} hidden={hideBalance} onOpen={() => setSheet('pnl')} />}
        <div className="mt-2 min-h-5 text-[13px] text-muted" role="status">
          {error ? <span className="text-warning">{updated ? t('暂时无法更新余额 · 上次更新 {time}', { time: updated }) : t('暂时无法更新余额')}</span> : firstLoad ? t('正在更新资产') : showBusy ? t('正在更新') : unpriced > 0 ? t('{n} 项资产暂无报价', { n: unpriced }) : t('已更新 {time}', { time: updated ?? '' })}
        </div>
        {error && <Button size="sm" variant="ghost" className="mt-1 -ml-3" disabled={loading} onClick={refreshNow}><RefreshCw size={14} />{t('重试')}</Button>}
      </section>

      {/* Buttons split into as many cells as there are buttons: the iOS store build has no "perp" so only 3 remain — still laying out 4 cells would cram them left (2026-10-02 goat) */}
      <section className={`page-gutter mt-4 grid gap-2 ${PERP_ENABLED ? 'grid-cols-4' : 'grid-cols-3'}`} aria-label={t('钱包操作')}>
        <Action icon={<ArrowDownToLine size={20} />} label={t('收款')} onClick={() => setSheet('receive')} />
        <Action icon={<ArrowUpFromLine size={20} />} label={t('发送')} onClick={() => setSheet('send')} />
        <Action icon={<Repeat size={20} />} label={t('闪兑')} onClick={() => nav('/swap')} />
        {PERP_ENABLED && <Action icon={<TrendingUp size={20} />} label={t('合约')} onClick={() => nav('/perp')} />}
      </section>

      {/* The fly sprite is the flagship feature, right below the action area; styled to the new design (outline row, no gradient card) */}
      <div className="page-gutter mt-4">
        <Link to="/flies" className="glass-lite flex min-h-16 items-center gap-3 rounded-[22px] px-4 py-3">
          <Bug size={22} className="shrink-0 text-accent" aria-hidden="true" />
          <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{t('赛博伊甸园')}</span><span className="mt-0.5 block truncate text-xs text-muted">{t('你的小精灵全天候为你交易，它生活在赛博伊甸园中。')}</span></span>
          <ChevronRight size={16} className="shrink-0 text-muted" />
        </Link>
      </div>

      {!backedUp && vault?.mnemonic && (
        <div className="page-gutter mt-4">
          <button onClick={() => nav('/settings?open=backup')} className="glass-lite flex min-h-14 w-full items-center gap-3 rounded-[22px] !border-warning/30 px-4 py-3 text-left text-[13px] text-warning">
            <ShieldAlert size={18} className="shrink-0" /><span className="min-w-0 flex-1"><span className="block font-medium">{t('备份助记词')}</span><span className="mt-0.5 block text-xs text-muted">{t('丢失设备后，需用助记词恢复钱包。')}</span></span><ChevronRight size={16} className="shrink-0" />
          </button>
        </div>
      )}

      {/* Gas warnings: alert / auto-top-up when a chain holding coins runs low on gas (2026-09-27) */}
      <GasWatch onOpenFuel={() => nav('/settings?open=fuel')} />

      {/* Watchlist / holdings tabs (2026-09-27 goat): home shows just these two market blocks, switch by tab — no more one long vertical stack */}
      <section className="mt-5" aria-label={t('行情')}>
        <div className="section-header page-gutter">
          <div className="flex items-center gap-5" role="tablist">
            {(['fav', 'hold'] as const).map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => pickTab(k)} className={`section-title transition-colors ${tab === k ? '' : '!text-muted'}`}>{k === 'fav' ? t('自选') : t('持仓')}</button>
            ))}
          </div>
          {tab === 'fav' ? <Link to="/discover" className="text-action">{t('查看全部')}<ChevronRight size={14} /></Link>
            : hasSnapshot && <span className="number text-[13px] text-muted">{t('{n} 项资产', { n: positions.length })}</span>}
        </div>
        {tab === 'fav' && <>
          {favorites.slice(0, LIST_MAX).map((f) => <TokenRow key={`${f.chain}:${f.address}`} token={{ ...(cache[marketKey(f.chain, f.address)] || f), symbol: f.symbol }} />)}
          {!favorites.length && (
            <div className="page-gutter flex items-center gap-3 py-3">
              <Star size={20} strokeWidth={1.5} className="shrink-0 text-muted" />
              <p className="min-w-0 flex-1 text-sm text-muted">{t('还没有自选，在币种页点星标即可加入')}</p>
            </div>
          )}
        </>}
        {tab === 'hold' && <>
        {firstLoad && <div className="page-gutter space-y-3 py-3">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-14" />)}</div>}
        {shownPositions.map((h) => (
          <Link key={`${h.chainId}:${h.mint}`} to={h.chainId === BTC_CHAIN_ID ? `/swap?from=${BTC_CHAIN_ID}:bitcoin` /* Bitcoin instant swap (2026-09-30): tap BTC to go to swap with BTC pre-selected as the sell side */ : h.chainId !== SOLANA_CHAIN_ID && isNative(h.mint) ? '/swap' : `/token/${chainById(h.chainId)?.dexKey || 'solana'}/${h.mint}`} {...(h.chainId !== BTC_CHAIN_ID ? pressPrefetchHandlers({ chain: chainById(h.chainId)?.dexKey || 'solana', address: h.mint }) : {})} className="holding-row list-row glass-lite mx-4 mb-2.5 !min-h-0 rounded-[22px] !border-b-0 px-4 !py-3.5">
            <TokenLogo src={h.logo} symbol={h.symbol} chain={h.chainId === SOLANA_CHAIN_ID ? 'solana' : chainById(h.chainId)?.dexKey} address={h.mint} />
            <div className="token-identity">
              <div className="truncate text-[15px] font-semibold" title={h.symbol}>{h.symbol}</div>
              <div className="number mt-1 truncate text-xs text-muted">{mask(fmtAmount(h.amount))} · {chainById(h.chainId)?.name || t('未知网络')}</div>
            </div>
            <div className="token-price number shrink-0">
              <div className="text-sm font-semibold" title={mask(h.priceUsd > 0 ? fmtMoney(h.valueUsd) : '--')}>{mask(h.priceUsd > 0 ? (h.valueUsd >= 1e6 ? fmtUsd(h.valueUsd, { compact: true }) : fmtMoney(h.valueUsd)) : '--')}</div>
              <PriceChange value={h.priceUsd > 0 ? h.change24h : undefined} className="mt-1 block text-[13px]" />
            </div>
          </Link>
        ))}
        {hasSnapshot && !error && !positions.length && (
          <div className="page-gutter flex items-center gap-3 py-3">
            <Wallet size={20} strokeWidth={1.5} className="shrink-0 text-muted" />
            <p className="min-w-0 flex-1 text-sm text-muted">{t('暂无资产')}</p>
          </div>
        )}
        {error && !positions.length && <div className="page-gutter py-3 text-sm text-muted">{t('持仓暂不可用')}</div>}
        {positions.length > LIST_MAX && (
          <button onClick={() => setShowAll((v) => !v)} className="page-gutter flex w-full items-center justify-center gap-1 py-2 text-sm text-accent">{showAll ? t('收起') : t('展开全部 {n} 项', { n: positions.length })}</button>
        )}
        </>}
      </section>

      <ReceiveSheet open={sheet === 'receive'} onClose={() => setSheet(null)} address={address} evmAddress={evmAddress} initialNet={diagBtc ? 'btc' : 'evm'} />
      <SendSheet open={sheet === 'send'} onClose={() => setSheet(null)} onDone={() => { setSheet(null); refresh() }} />
      <DayPnlSheet open={sheet === 'pnl'} onClose={() => setSheet(null)} summary={pnl} hidden={hideBalance} walletUsd={balanceKnown ? totalUsd : null} />
      <FeeSheet open={sheet === 'tier'} onClose={() => setSheet(null)} />
    </div>
  )
}

// Since 2026-09-26 all four buttons share one style (dark glass / light pearl); "receive" is no longer singled out
function Action({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button onClick={onClick} className="wallet-action"><span className="wallet-action-icon">{icon}</span><span>{label}</span></button>
}
