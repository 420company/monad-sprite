// 网页版「我的资产」（/portfolio，钱包胶囊菜单进来；网页版的 / 也落到这里。2026-09-29 goat：「我点个人中心，又是给的手机预览版本的界面」）。
// 版式参考专业交易所的资产页（docs/WEB_DESIGN.md）：
//   上面一块：总资产大数字 + 今日盈亏 + 更新状态，右上操作（收款 · 发送 · 闪兑 · 合约），下面各链地址（点一下复制），再下面三格小统计；
//   下面页签表：资产（代币、网络、数量、价格、价值、24h）· 合约仓位 · 活动记录。
// 余额、今日盈亏、活动记录、合约账户全部复用手机首页 / 活动页 / 合约页的 store 和函数（usePortfolio、useDayPnl、useActivityTimeline、loadAccount），
// 不另写一套；收款 / 发送用手机的业务组件，外壳在网页版宽屏下是居中模态框（components/Sheet）。
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
/** 持仓点进去：比特币没有行情页；EVM 链原生币去现货（闪兑）；其余去币详情 */
// 比特币闪兑（2026-09-30）：BTC 这一行点进兑换，预选卖出 BTC
const holdingPath = (h: Holding) => h.chainId === BTC_CHAIN_ID ? `/swap?from=${BTC_CHAIN_ID}:bitcoin` : h.chainId !== SOLANA_CHAIN_ID && isNative(h.mint) ? '/spot' : `/token/${chainById(h.chainId)?.dexKey || 'solana'}/${h.mint}`

export default function PortfolioDesk() {
  const nav = useNavigate()
  const { address, evmAddress, btcAddress } = useWallet()
  const external = useExternalWallet()
  const { hideBalance, toggleHideBalance } = useSettings()
  const { holdings, btc, totalUsd, loading, error, refresh, lastUpdated } = usePortfolio()
  const [modal, setModal] = useState<'receive' | 'send' | 'swap' | 'pnl' | 'tier' | null>(null)
  const [tab, setTab] = usePageState<Tab>('desk.portfolio.tab', 'assets', oneOf('assets', 'perp', 'activity'))
  // 从别处跳过来指定页签（/activity → /portfolio?tab=activity）
  const [params] = useSearchParams()
  useEffect(() => { const q = params.get('tab'); if (q === 'assets' || q === 'perp' || q === 'activity') setTab(q) }, [params]) // eslint-disable-line react-hooks/exhaustive-deps

  // 和手机首页同一套刷新：进来超过 15 秒没更新就刷，之后每 30 秒悄悄刷；手动刷新才转圈
  const [manual, setManual] = useState(false)
  const refreshNow = () => { setManual(true); Promise.resolve(refresh()).finally(() => setManual(false)) }
  useEffect(() => {
    if (Date.now() - usePortfolio.getState().lastUpdated > 15_000) refresh()
    const timer = setInterval(refresh, 30_000)
    return () => clearInterval(timer)
  }, [refresh, address, evmAddress])

  // 今日盈亏（现货 + 合约，和首页同一个口径）与账户种类
  const socialReady = useSocial((s) => s.status === 'ready')
  const { ledger, perp } = useDayPnl()
  useEffect(() => { void useDayPnl.getState().update() }, [lastUpdated, address, socialReady])
  useEffect(() => { if (socialReady) void useFees.getState().load() }, [socialReady, address])
  const pnl = summarize(ledger, perp, Date.now())
  const fees = useFees((s) => s.fees)
  const vip = fees.vip
  const feesFor = useFees((s) => (s.loadedAt > 0 ? s.account : null))
  const meAddr = useSocial((s) => s.me?.address)

  // 比特币持仓单独存（store/portfolio），在这里并进列表按价值排序
  const positions = useMemo(() => (btc ? [...holdings, btc].sort((a, b) => b.valueUsd - a.valueUsd) : holdings).filter((h) => h.amount > 0), [holdings, btc])
  const hasSnapshot = lastUpdated > 0
  const unpriced = positions.filter((h) => !(h.priceUsd > 0)).length
  const balanceKnown = hasSnapshot && (positions.length === 0 || unpriced < positions.length)
  // 合约账户读得到时，总资产含合约账户权益（和今日盈亏同一个口径：现货 + 合约）
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

      {/* 概览 */}
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
            {/* 闪兑在本页弹窗里做（2026-10-02 goat：以前跳去现货页，点了不像闪兑）：任意币换任意币，同链 / 跨链都行 */}
            <button type="button" className="wc-btn" onClick={() => setModal('swap')}><Repeat size={15} />{t('闪兑')}</button>
            <button type="button" className="wc-btn" onClick={() => nav('/perp')}><TrendingUp size={15} />{t('合约')}</button>
          </div>
        </div>
        {addrs.length > 0 && (
          <div className="wc-pf-addrs">
            {addrs.map((a) => <button key={a.k} type="button" className="wc-addr" onClick={() => copyAddr(a.v)} title={a.v} aria-label={t('复制 {chain} 地址', { chain: a.k })}><em>{a.k}</em><code>{midShort(a.v)}</code><Copy size={12} aria-hidden="true" /></button>)}
            {/* 外部钱包没有比特币：比特币是 0x4 Wallet 专属，点了去获取（2026-09-30） */}
            {external && <button type="button" className="wc-addr is-ox4" onClick={getOx4Wallet}><em>Bitcoin</em><span>{t('0x4 Wallet 专属')}</span></button>}
          </div>
        )}
        <dl className="wc-pf-stats" style={{ borderTop: '1px solid var(--w-line)' }}>
          <div><dt>{t('钱包资产')}</dt><dd>{balanceKnown ? mask(money(totalUsd)) : '--'}<small>{t('{n} 项资产', { n: hasSnapshot ? positions.length : '--' })}</small></dd></div>
          <div><dt>{t('合约账户')}</dt><dd>{perpEquity !== null ? mask(money(perpEquity)) : '--'}<small>{perpEquity !== null ? t('保证金用 BNB Chain 上的 USDT') : t('未开通或暂时读不到')}</small></dd></div>
          {/* 第三格：累计交易额和升 VIP 的门槛（服务器核对过的交易额，/api/fees/me）；今日盈亏已经在大数字下面，不重复 */}
          <div><dt>{t('累计交易额')}</dt><dd>{feesFor === meAddr && meAddr ? mask(money(fees.volume.spot + fees.volume.perp)) : '--'}<small>{vip ? t('已是 VIP，手续费更低') : t('现货满 {a} 或合约满 {b} 自动升级 VIP', { a: fmtUsd(fees.target.spot, { compact: true }), b: fmtUsd(fees.target.perp, { compact: true }) })}</small></dd></div>
        </dl>
      </section>

      {/* 页签表 */}
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

/** 资产表：代币、网络、数量、价格、价值、24h；点一行去行情 / 现货 */
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

/** 合约仓位：打开这个页签才去读（要合约代理签名），和合约页同一个接口与「还没开通」判断 */
function PerpPositions({ mask }: { mask: (s: string) => string }) {
  const nav = useNavigate()
  const { evmAccount, keysUnlocked } = useWallet()
  const [acc, setAcc] = useState<PerpAccount | null>(null)
  const [noAccount, setNoAccount] = useState(false)
  // 交易密钥还没授权（网页版插件）：账户可能已经有钱、有小精灵开的仓，只是读不到。原来和「还没开通」混在一起，说成「合约账户未开启」（2026-10-05 goat 存了 20 USDT 后看到这句）
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
        // NO_AGENT / only be used after deposit：这个钱包还没在交易所开通合约账户，是新用户的正常状态，不是故障
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
  // 0x4 插件锁着（2026-10-06 起插件锁了网页不登出）：读合约账户要插件签名，不自动弹解锁
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

/** 活动记录：和手机活动页同一条时间线（useActivityTimeline），按链筛选，点一行去区块浏览器 */
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
