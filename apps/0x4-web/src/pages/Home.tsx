// 资产页：自选和持仓并排成两个标签（2026-09-27 goat：持仓放在自选下面看不到、拉很长），钱包、收款和多链发送仍使用现有接线。
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

/** 首页每个标签最多先显示几行，持仓多了点「展开全部」 */
const LIST_MAX = 6

export default function Home() {
  const { address, evmAddress, vault } = useWallet()
  const { backedUp, hideBalance, toggleHideBalance } = useSettings()
  const { holdings, btc, totalUsd, loading, error, refresh, lastUpdated } = usePortfolio()
  const [sheet, setSheet] = useState<'receive' | 'send' | 'pnl' | 'tier' | null>(null)
  const nav = useNavigate()
  // 仅诊断构建（VITE_DIAG=1）：meme.wallet.app://?receive=btc 或构建时 VITE_DIAG_OPEN=receive-btc 直接打开比特币收款页，
  // 模拟器验收截图用（无界面模拟器点不了深链确认框）；正式构建里恒为 false
  const loc = useLocation()
  const diagBtc = import.meta.env.VITE_DIAG === '1' && (new URLSearchParams(loc.search).get('receive') === 'btc' || import.meta.env.VITE_DIAG_OPEN === 'receive-btc')
  useEffect(() => { if (diagBtc) setSheet('receive') }, [diagBtc])
  const favorites = useFavorites((s) => s.items)
  // 默认看自选；没有自选就看持仓。选过的标签记在本机
  const [tab, setTab] = useState<'fav' | 'hold'>(() => { try { const v = localStorage.getItem('0x4.homeTab'); if (v === 'fav' || v === 'hold') return v } catch { /* 无痕模式 */ } return useFavorites.getState().items.length ? 'fav' : 'hold' })
  const pickTab = (k: 'fav' | 'hold') => { setTab(k); try { localStorage.setItem('0x4.homeTab', k) } catch { /* 无痕模式 */ } }
  const [showAll, setShowAll] = useState(false)
  const { cache, loadTokens } = useMarket()

  useEffect(() => {
    const byChain = new Map<string, string[]>()
    favorites.forEach((f) => byChain.set(f.chain, [...(byChain.get(f.chain) || []), f.address]))
    byChain.forEach((addrs, chain) => loadTokens(addrs, chain))
  }, [favorites, loadTokens])

  // 手动刷新才显示转圈和「正在更新」；每 30 秒的后台刷新悄悄进行，不让界面每半分钟闪一次（2026-09-25 goat 反馈）
  const [manual, setManual] = useState(false)
  const refreshNow = () => { setManual(true); Promise.resolve(refresh()).finally(() => setManual(false)) }
  const showBusy = loading && manual

  useEffect(() => {
    if (Date.now() - usePortfolio.getState().lastUpdated > 15_000) refresh()
    const timer = setInterval(refresh, 30_000)
    return () => clearInterval(timer)
  }, [refresh, address])

  // 今日盈亏（2026-09-29）：每次余额刷新完记一次；合约部分服务器读，60 秒内不重复问
  const socialReady = useSocial((s) => s.status === 'ready')
  const { ledger, perp } = useDayPnl()
  useEffect(() => { void useDayPnl.getState().update() }, [lastUpdated, address, socialReady])
  // 地址下的勋章要当前账户的等级（接口失败不显示）
  useEffect(() => { if (socialReady) void useFees.getState().load() }, [socialReady, address])
  const pnl = summarize(ledger, PERP_ENABLED ? perp : null, Date.now())

  // 比特币持仓单独存（见 store/portfolio），在这里并进列表按价值排序
  const positions = (btc ? [...holdings, btc].sort((a, b) => b.valueUsd - a.valueUsd) : holdings).filter((h) => h.amount > 0)
  const shownPositions = showAll ? positions : positions.slice(0, LIST_MAX)
  const hasSnapshot = lastUpdated > 0
  const unpriced = positions.filter((h) => !(h.priceUsd > 0)).length
  // 金额未知时显示缺失态；部分代币无报价时明确这是已估值部分。
  const balanceKnown = hasSnapshot && (positions.length === 0 || unpriced < positions.length)
  // 合约账户读得到时，总资产含合约账户权益（和今日盈亏同一个口径：现货 + 合约）
  const grandTotal = totalUsd + (pnl?.perp?.equity || 0)
  const balance = balanceKnown ? (grandTotal >= 1e6 ? fmtUsd(grandTotal, { compact: true }) : fmtMoney(grandTotal)) : '--'
  const mask = (value: string) => hideBalance ? '****' : value
  const updated = hasSnapshot ? new Date(lastUpdated).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : null
  const firstLoad = !hasSnapshot && !error

  // 首页显示 / 复制 EVM 地址（BNB Chain、Ethereum 等共用）；以前显示 Solana 地址，导入 EVM 私钥的用户
  // 看到一串陌生地址以为导错了钱包（2026-09-25 goat 反馈）。Solana 地址在「收款」里切到 Solana 查看。
  const shownAddr = evmAddress || address || ''
  const copy = async () => {
    if (!shownAddr) return
    try { await copyText(shownAddr); toast.success(t('地址已复制')) }
    catch { toast.error(t('复制失败，请在收款页查看地址')) }
  }


  return (
    <div className="safe-top">
      <header className="page-header page-gutter">
        {/* logo 右边：有官方公告时滚动显示标题（点开看全文），没有时显示 0x4（2026-09-29）。
            网页版（手机浏览器从「我 → 我的资产」进来）：顶栏已经有 0x4 和铃铛，这里只写页面标题，不再重复一套（2026-10-07） */}
        {WEB_SURFACE ? <h1 className="page-title">{t('我的资产')}</h1> : <HomeBrand />}
        <div className="account-tools">
          {/* 扫码：登录电脑端（Meet / Cyber Eden / 管理后台）。手机 App 和手机浏览器才有；2026-09-28 起全 App 只留这一个入口 */}
          <MeetScan />
          {!WEB_SURFACE && <BellButton />}
          <button onClick={() => nav('/activity')} className="icon-button" aria-label={t('活动记录')} data-tooltip={t('活动记录')}><Clock size={20} /></button>
          <button onClick={refreshNow} disabled={showBusy} className="icon-button" aria-label={t('刷新资产')} data-tooltip={t('刷新资产')}><RefreshCw size={19} className={showBusy ? 'animate-spin' : ''} /></button>
        </div>
      </header>

      {/* 资产卡：真毛玻璃大卡片 */}
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
          {/* 地址正下方：账户勋章（普通账户 / VIP），点开看等级和费率 */}
          <span className="ml-auto shrink-0 self-start pl-2"><AccountBadge onOpen={() => setSheet('tier')} /></span>
        </div>
        {balanceKnown && <DayPnlLine summary={pnl} hidden={hideBalance} onOpen={() => setSheet('pnl')} />}
        <div className="mt-2 min-h-5 text-[13px] text-muted" role="status">
          {error ? <span className="text-warning">{updated ? t('暂时无法更新余额 · 上次更新 {time}', { time: updated }) : t('暂时无法更新余额')}</span> : firstLoad ? t('正在更新资产') : showBusy ? t('正在更新') : unpriced > 0 ? t('{n} 项资产暂无报价', { n: unpriced }) : t('已更新 {time}', { time: updated ?? '' })}
        </div>
        {error && <Button size="sm" variant="ghost" className="mt-1 -ml-3" disabled={loading} onClick={refreshNow}><RefreshCw size={14} />{t('重试')}</Button>}
      </section>

      {/* 有几个按钮分几格：iOS 上架版没有「合约」只剩 3 个，仍按 4 格排会全挤在左边（2026-10-02 goat） */}
      <section className={`page-gutter mt-4 grid gap-2 ${PERP_ENABLED ? 'grid-cols-4' : 'grid-cols-3'}`} aria-label={t('钱包操作')}>
        <Action icon={<ArrowDownToLine size={20} />} label={t('收款')} onClick={() => setSheet('receive')} />
        <Action icon={<ArrowUpFromLine size={20} />} label={t('发送')} onClick={() => setSheet('send')} />
        <Action icon={<Repeat size={20} />} label={t('闪兑')} onClick={() => nav('/swap')} />
        {PERP_ENABLED && <Action icon={<TrendingUp size={20} />} label={t('合约')} onClick={() => nav('/perp')} />}
      </section>

      {/* 果蝇是主打特色，放在操作区正下方；样式跟新设计走（描边行，不用渐变卡片） */}
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

      {/* 燃料费预警：还有币的链燃料费不够时提醒 / 自动补（2026-09-27） */}
      <GasWatch onOpenFuel={() => nav('/settings?open=fuel')} />

      {/* 自选 / 持仓两个标签（2026-09-27 goat）：首页就这两块行情，点标签切换，不再上下排一长串 */}
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
          <Link key={`${h.chainId}:${h.mint}`} to={h.chainId === BTC_CHAIN_ID ? `/swap?from=${BTC_CHAIN_ID}:bitcoin` /* 比特币闪兑（2026-09-30）：点 BTC 直接去兑换，预选卖出 BTC */ : h.chainId !== SOLANA_CHAIN_ID && isNative(h.mint) ? '/swap' : `/token/${chainById(h.chainId)?.dexKey || 'solana'}/${h.mint}`} {...(h.chainId !== BTC_CHAIN_ID ? pressPrefetchHandlers({ chain: chainById(h.chainId)?.dexKey || 'solana', address: h.mint }) : {})} className="holding-row list-row glass-lite mx-4 mb-2.5 !min-h-0 rounded-[22px] !border-b-0 px-4 !py-3.5">
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

// 2026-09-26 起四个钮同一套样式（深色玻璃 / 浅色珠光），不再单独突出「收款」
function Action({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button onClick={onClick} className="wallet-action"><span className="wallet-action-icon">{icon}</span><span>{label}</span></button>
}
