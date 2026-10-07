// Monad testnet bonding-curve token detail (added 2026-10-07 for hackathon)
// Price comes from on-chain getPrice() — no DexScreener (curve tokens have no DEX pairs); buys/sells call the Launcher directly
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ArrowLeft, Copy, ExternalLink, RefreshCw } from 'lucide-react'
import Button from '@/components/Button'
import TokenLogo from '@/components/TokenLogo'
import { toast } from '@/components/Toast'
import { t } from '@/lib/i18n'
import { fmtAmount, shortAddr } from '@/lib/format'
import { copyText } from '@/lib/native'
import { useBack } from '@/lib/useBack'
import { isWalletConnected, useWallet } from '@/store/wallet'
import { needWallet } from '@/desktop/walletGate'
import { chainById } from '@/lib/chains'
import { getEvmTokenBalance } from '@/lib/evm'
import {
  MONAD_TESTNET_ID,
  getLauncherToken,
  getLauncherPrice,
  quoteLauncherBuy,
  quoteLauncherSell,
  buyLauncherToken,
  sellLauncherToken,
  type LauncherToken,
} from '@/lib/monadLauncher'

const WEI = 1e18

export default function MonadToken() {
  const { address = '' } = useParams()
  const goBack = useBack('/discover')
  const connected = useWallet(isWalletConnected)
  const evmAccount = useWallet((s) => s.evmAccount)

  const [info, setInfo] = useState<LauncherToken | null>(null)
  const [price, setPrice] = useState<bigint | null>(null)
  const [loading, setLoading] = useState(true)
  const [buyAmt, setBuyAmt] = useState('')
  const [sellAmt, setSellAmt] = useState('')
  const [buyQuote, setBuyQuote] = useState<bigint | null>(null)
  const [sellQuote, setSellQuote] = useState<bigint | null>(null)
  const [busy, setBusy] = useState<'buy' | 'sell' | null>(null)
  const [balance, setBalance] = useState<bigint | null>(null)

  const refresh = useCallback(async () => {
    if (!address) return
    try {
      const [i, p] = await Promise.all([getLauncherToken(address), getLauncherPrice(address)])
      setInfo(i)
      setPrice(p)
    } catch {
      /* keep previous values */
    } finally {
      setLoading(false)
    }
    if (evmAccount) {
      getEvmTokenBalance(MONAD_TESTNET_ID, evmAccount.address, address).then(setBalance).catch(() => {})
    }
  }, [address, evmAccount])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 15_000)
    return () => clearInterval(timer)
  }, [refresh])

  // Buy quote (debounced)
  useEffect(() => {
    const v = parseFloat(buyAmt)
    if (!v || v <= 0 || !address) { setBuyQuote(null); return }
    const t = setTimeout(() => {
      quoteLauncherBuy(address, BigInt(Math.floor(v * WEI))).then(setBuyQuote).catch(() => setBuyQuote(null))
    }, 400)
    return () => clearTimeout(t)
  }, [buyAmt, address])

  // Sell quote (debounced)
  useEffect(() => {
    const v = parseFloat(sellAmt)
    if (!v || v <= 0 || !address) { setSellQuote(null); return }
    const t = setTimeout(() => {
      quoteLauncherSell(address, BigInt(Math.floor(v * WEI))).then(setSellQuote).catch(() => setSellQuote(null))
    }, 400)
    return () => clearTimeout(t)
  }, [sellAmt, address])

  const doBuy = async () => {
    if (!evmAccount || !needWallet()) return
    const v = parseFloat(buyAmt)
    if (!v || v <= 0) return
    setBusy('buy')
    try {
      await buyLauncherToken(evmAccount, address, BigInt(Math.floor(v * WEI)))
      toast.success(t('买入成功'))
      setBuyAmt('')
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('买入失败'))
    } finally {
      setBusy(null)
    }
  }

  const doSell = async () => {
    if (!evmAccount || !needWallet()) return
    const v = parseFloat(sellAmt)
    if (!v || v <= 0) return
    setBusy('sell')
    try {
      await sellLauncherToken(evmAccount, address, BigInt(Math.floor(v * WEI)))
      toast.success(t('卖出成功'))
      setSellAmt('')
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('卖出失败'))
    } finally {
      setBusy(null)
    }
  }

  const back = <button onClick={goBack} className="icon-button -ml-2" aria-label={t('返回')}><ArrowLeft size={21} /></button>
  const chainInfo = chainById(MONAD_TESTNET_ID)
  const explorer = chainInfo?.viem?.blockExplorers?.default.url

  if (loading) {
    return (
      <div className="safe-top">
        <header className="page-header page-gutter">{back}<h1 className="section-title mr-auto">{t('代币')}</h1></header>
        <div className="page-gutter space-y-4"><div className="skeleton h-16" /><div className="skeleton h-60" /></div>
      </div>
    )
  }

  if (!info) {
    return (
      <div className="safe-top">
        <header className="page-header page-gutter">{back}<h1 className="section-title mr-auto">{t('代币')}</h1></header>
        <div className="empty-state page-gutter" role="status">
          <p className="text-sm text-muted">{t('该地址不是 Monad 测试网 Launcher 发行的代币')}</p>
          <p className="mt-2 font-mono text-xs text-muted">{shortAddr(address)}</p>
        </div>
      </div>
    )
  }

  const priceMon = price !== null ? Number(price) / WEI : null
  // Market cap in MON = current price × total supply
  const mcapMon = priceMon !== null && info ? priceMon * (Number(info.supply) / WEI) : null

  return (
    <div className="safe-top pb-24">
      <div className="mx-auto max-w-2xl">
        <header className="page-gutter flex min-h-20 items-center gap-2 py-3">
          {back}
          <TokenLogo symbol={info.symbol} size={36} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">{info.symbol}</h1>
            <p className="truncate text-xs text-muted">{chainInfo?.name || 'Monad Testnet'} · {info.name}</p>
          </div>
          <span className="rounded-full bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent">{t('bonding curve')}</span>
          <button onClick={() => copyText(address).then(() => toast.success(t('合约地址已复制')))} className="icon-button" aria-label={t('复制合约地址')}>
            <Copy size={18} />
          </button>
        </header>

        <section className="page-gutter py-3" aria-label={t('代币价格')}>
          <div className="number break-all text-[32px] leading-tight font-semibold">
            {priceMon !== null ? `${fmtAmount(priceMon, 6)} MON` : '--'}
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm text-muted">
            <button className="icon-button" onClick={refresh} aria-label={t('刷新')}><RefreshCw size={16} /></button>
            <span>{t('链上实时价格')}</span>
          </div>
        </section>

        <section className="page-gutter mt-2" aria-label={t('市场数据')}>
          <dl className="grid grid-cols-2 gap-x-5">
            {[
              [t('市值'), mcapMon !== null ? `${fmtAmount(mcapMon, 4)} MON` : '--'],
              [t('发行量'), fmtAmount(Number(info.supply) / WEI, 0)],
              [t('储备 MON'), fmtAmount(Number(info.reserve) / WEI, 4)],
              [t('我的持仓'), balance !== null ? `${fmtAmount(Number(balance) / WEI, 4)} ${info.symbol}` : '--'],
            ].map(([k, v]) => (
              <div key={k} className="min-w-0 border-b border-line py-3">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="number mt-1 break-words text-sm font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Bonding curve visual — pump.fun style */}
        <section className="page-gutter mt-4" aria-label={t('价格曲线')}>
          <div className="rounded-2xl bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold">{t('Bonding Curve')}</span>
              <span className="text-xs text-muted">{t('买入推高价格，卖出沿曲线赎回')}</span>
            </div>
            <BondingCurveChart supply={Number(info.supply) / WEI} />
          </div>
        </section>

        {!connected ? (
          <p className="page-gutter mt-6 text-sm text-muted">{t('连接钱包后可买卖')}</p>
        ) : (
          <section className="page-gutter mt-6 space-y-4" aria-label={t('买卖')}>
            <div className="rounded-2xl bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold text-up">{t('买入')}</h2>
              <div className="mb-2 flex gap-1.5">
                {['0.1', '0.5', '1', '5'].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setBuyAmt(v)}
                    className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${
                      buyAmt === v ? 'bg-up/20 text-up' : 'bg-background text-muted hover:text-fg'
                    }`}
                  >
                    {v} MON
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={buyAmt}
                  onChange={(e) => setBuyAmt(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="0.0"
                  inputMode="decimal"
                  className="number min-w-0 flex-1 rounded-xl bg-background px-3 py-2.5 text-[15px] outline-none ring-primary/30 focus:ring-2"
                />
                <span className="flex items-center text-sm text-muted">MON</span>
              </div>
              {buyQuote !== null && (
                <p className="mt-2 text-sm text-muted">≈ {fmtAmount(Number(buyQuote) / WEI, 4)} {info.symbol}</p>
              )}
              <Button variant="up" className="mt-3 w-full" disabled={busy !== null || !buyAmt} onClick={doBuy}>
                {busy === 'buy' ? t('上链中…') : t('买入')}
              </Button>
            </div>

            <div className="rounded-2xl bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold text-down">{t('卖出')}</h2>
              <div className="flex gap-2">
                <input
                  value={sellAmt}
                  onChange={(e) => setSellAmt(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="0.0"
                  inputMode="decimal"
                  className="number min-w-0 flex-1 rounded-xl bg-background px-3 py-2.5 text-[15px] outline-none ring-primary/30 focus:ring-2"
                />
                <span className="flex items-center text-sm text-muted">{info.symbol}</span>
              </div>
              {sellQuote !== null && (
                <p className="mt-2 text-sm text-muted">≈ {fmtAmount(Number(sellQuote) / WEI, 6)} MON</p>
              )}
              <Button variant="down" className="mt-3 w-full" disabled={busy !== null || !sellAmt} onClick={doSell}>
                {busy === 'sell' ? t('上链中…') : t('卖出')}
              </Button>
            </div>
          </section>
        )}

        <section className="page-gutter mt-6" aria-label={t('合约地址')}>
          <div className="flex items-center gap-3 rounded-2xl border border-accent/35 bg-accent/10 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold text-accent">{t('代币合约')}</div>
              <div className="mt-1 break-all font-mono text-[13px] font-semibold leading-snug select-all" translate="no">{address}</div>
            </div>
          </div>
          {explorer && (
            <a href={`${explorer}/token/${address}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-primary">
              {t('在 Monad 浏览器查看')} <ExternalLink size={14} />
            </a>
          )}
        </section>

        <p className="page-gutter mt-4 text-xs leading-relaxed text-muted">
          {t('该代币由 MemeLauncher bonding curve 发行：买入推高价格，卖出沿曲线赎回。卖出无需授权（合约直接销毁）。')}
        </p>
      </div>
    </div>
  )
}

/** Simple bonding-curve visualization: price rises with supply (SVG, no deps) */
function BondingCurveChart({ supply }: { supply: number }) {
  const W = 320
  const H = 120
  const P = 12
  const pts: string[] = []
  for (let i = 0; i <= 40; i++) {
    const x = (i / 40) * (W - 2 * P) + P
    const y = H - P - Math.pow(i / 40, 1.8) * (H - 2 * P)
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  const t = 0.85
  const curX = P + t * (W - 2 * P)
  const curY = H - P - Math.pow(t, 1.8) * (H - 2 * P)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Bonding curve">
      <defs>
        <linearGradient id="bcurve" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={`${P},${H - P} ${pts.join(' ')} ${W - P},${H - P}`} fill="url(#bcurve)" />
      <polyline points={pts.join(' ')} fill="none" stroke="var(--color-primary)" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={curX} cy={curY} r="5" fill="var(--color-primary)" stroke="#fff" strokeWidth="2" />
      <text x={P} y={H - 1} fontSize="9" fill="var(--color-muted)">{supply > 0 ? 'supply →' : 'be the first buy'}</text>
    </svg>
  )
}

/** Route split: monad-testnet renders the bonding-curve view, everything else falls back to the original Token page */
export function TokenRouter({ fallback }: { fallback: React.ReactNode }) {
  const { chain } = useParams()
  if (chain === 'monad-testnet') return <MonadToken />
  return <>{fallback}</>
}
