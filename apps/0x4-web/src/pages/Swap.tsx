// Flash swap: swap any token on any chain (same-chain via DEX, cross-chain via bridge), routed by LI.FI aggregation
import { useEffect, useId, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ArrowDownUp, ArrowLeft, ChevronDown, Clock, ExternalLink, RefreshCw } from 'lucide-react'
import Button from '@/components/Button'
import TokenLogo from '@/components/TokenLogo'
import TokenPicker, { type PickedToken } from '@/components/TokenPicker'
import { toast } from '@/components/Toast'
import { alertError } from '@/components/AlertDialog'
import { BTC_CHAIN, CHAINS, SOLANA_CHAIN_ID, chainName, isStable, sameAddr, type ChainToken } from '@/lib/chains'
import { isBtcChain, swapAddressFor } from '@/lib/btcSwap'
import { executeLifiStep, getLifiQuote, summarizeStep, type ExecPhase, type LiFiStep } from '@/lib/lifi'
import { findHolding } from '@/lib/tokens'
import { fmtAmount, fmtMoney, fromBaseUnits, toBaseUnits } from '@/lib/format'
import { usePortfolio } from '@/store/portfolio'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'
import { useBridge } from '@/store/bridge'
import { reportTrade, isReportable } from '@/lib/trades'
import { t } from '@/lib/i18n'
import { useBack } from '@/lib/useBack'
import { currentFees, reportFeeReceipt, spotFeeLabel, useFees } from '@/lib/fees'
import { errorText } from '@/lib/errors'
import { WEB_SURFACE } from '@/lib/surface'
import { execPhaseText, signerOf } from '@/lib/execPhase'
import { explorerTx } from '@/lib/rpc'
import { useWide } from '@/desktop/useWide'

const SOL_NATIVE = CHAINS[0].native
/** When selling BTC with "max", the amount (BTC) reserved for Bitcoin network fees */
const BTC_FEE_RESERVE = 0.0001
// Default pair: BNB on BSC → USDT on BSC (2026-09-25 goat's request, BSC first)
const BSC = CHAINS.find((c) => c.id === 56)!
const BSC_BNB = BSC.native
const BSC_USDT = BSC.tokens.find((x) => sameAddr(x.address, '0x55d398326f99059fF775485246999027B3197955'))!

/** embedded: nested in the web "Spot" page's right column (2026-09-29), no back button, title says "Flash swap & cross-chain";
 *  bare: placed in a web popup (2026-10-02 profile "Flash swap"), no page header at all — the popup has its own title and close */
export default function Swap({ embedded = false, bare = false }: { embedded?: boolean; bare?: boolean } = {}) {
  const fees = useFees((s) => s.fees)
  // Web widescreen opening /swap standalone: a sensibly-sized centered card, not full screen (2026-10-05 goat: "why full screen"); narrow screens follow mobile, embedded-in-spot/popup instances unaffected
  const wide = useWide()
  const deskCard = WEB_SURFACE && wide && !bare && !embedded
  // Back: go back if there is a previous page (its state / scroll get restored); direct opens go to the asset home
  const back = useBack('/')
  const { address, evmAddress, btcAddress, wallet, evmAccount, btc, kind } = useWallet()
  const { holdings, refresh } = usePortfolio()
  const { slippageBps, rpcUrl } = useSettings()
  const addTransfer = useBridge((s) => s.add)
  const transfers = useBridge((s) => s.transfers)

  const [from, setFrom] = useState<ChainToken>(BSC_BNB)
  const [to, setTo] = useState<ChainToken>(BSC_USDT)
  const [amount, setAmount] = useState('')
  const [picking, setPicking] = useState<'from' | 'to' | null>(null)
  const [quote, setQuote] = useState<LiFiStep | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [quoteErr, setQuoteErr] = useState<string | null>(null)
  const [phase, setPhase] = useState<ExecPhase | 'idle' | 'done'>('idle')
  /** Source-chain tx just sent, not yet confirmed: show the block explorer link first (2026-10-05) */
  const [pendingTx, setPendingTx] = useState<string | null>(null)
  const [sentHash, setSentHash] = useState<string | null>(null)
  const [quotedFor, setQuotedFor] = useState('')
  const [retry, setRetry] = useState(0)
  const amountId = useId()
  const busy = phase === 'approving' || phase === 'signing' || phase === 'sent'

  // Arriving with params (e.g. perp page's "flash swap to Arbitrum"): ?from=chainId:address&to=chainId:address — prefill what can be recognized
  const location = useLocation()
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    const pick = (v: string | null): ChainToken | null => {
      if (!v) return null
      // Bitcoin (2026-09-30 Bitcoin flash swap) isn't in CHAINS — recognized separately: ?from=20000000000001:bitcoin
      const [cid, addr] = v.split(':'); const chain = [...CHAINS, BTC_CHAIN].find((c) => c.id === Number(cid)); if (!chain || !addr) return null
      if (sameAddr(addr, chain.native.address)) return chain.native
      const t = chain.tokens.find((x) => sameAddr(x.address, addr)); if (t) return t
      const h = holdings.find((x) => x.chainId === chain.id && sameAddr(x.mint, addr))
      return h ? { chainId: h.chainId, address: h.mint, symbol: h.symbol, name: h.name, decimals: h.decimals, logo: h.logo } : null
    }
    const f = pick(q.get('from')), t = pick(q.get('to'))
    if (f) setFrom(f)
    if (t) setTo(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, holdings.length])

  const fromHolding = findHolding(holdings, from)
  // Solana-originated txs need SOL for fees; with zero SOL don't let the user click all the way through only to get "expired"
  const solBalance = usePortfolio((s) => s.solBalance)
  const needSol = from.chainId === SOLANA_CHAIN_ID && !(from.address === SOL_NATIVE.address) && solBalance < 0.003
  const balance = fromHolding?.amount ?? 0
  const amt = Number(amount)
  const valid = Number.isFinite(amt) && amt > 0 && amt <= balance && !needSol && !(from.chainId === to.chainId && sameAddr(from.address, to.address))
  // Each chain uses its own address: Solana / Bitcoin bc1q / EVM 0x (lib/btcSwap.ts)
  const fromAddr = swapAddressFor(from.chainId, { address, evmAddress, btcAddress })
  const toAddr = swapAddressFor(to.chainId, { address, evmAddress, btcAddress })
  // Involving Bitcoin: external wallets (MetaMask etc.) have no Bitcoin — 0x4 Wallet exclusive; if the 0x4 Wallet hasn't generated a Bitcoin address yet, generate one on the receive page first
  const btcSide = isBtcChain(from.chainId) || isBtcChain(to.chainId)
  const btcBlocked = btcSide && !btcAddress ? (kind === 'external' ? t('比特币兑换是 0x4 Wallet 专属功能') : t('请先在收款页生成比特币地址')) : null
  const fromBtc = isBtcChain(from.chainId)
  const quoteKey = JSON.stringify([amount, from.chainId, from.address, from.decimals, to.chainId, to.address, to.decimals, fromAddr, toAddr, slippageBps])
  const currentQuote = quotedFor === quoteKey && valid && !quoting

  // Quotes (debounced)
  useEffect(() => {
    if (busy) return
    setQuote(null); setQuoteErr(null); setQuotedFor(''); setQuoting(false)
    if (!valid || !fromAddr || !toAddr) return
    let alive = true
    setQuoting(true)
    const timer = setTimeout(async () => {
      try {
        const fees = await currentFees()
        const q = await getLifiQuote({
          fromChain: from.chainId, fromToken: from.address, toChain: to.chainId, toToken: to.address,
          fromAmount: toBaseUnits(amount, from.decimals), fromAddress: fromAddr, toAddress: toAddr, slippage: slippageBps / 10_000,
          feeBps: fees.evmBps, integrator: fees.lifiIntegrator,
        })
        if (alive) { setQuote(q); setQuotedFor(quoteKey) }
      } catch (e) {
        // Selling BTC: the cross-chain service looks up UTXOs by address — just-deposited unconfirmed funds won't be found (2026-09-30 test: 1003 No UTXOs found)
        const noUtxo = e instanceof Error && /UTXO/i.test(e.message)
        if (alive) setQuoteErr(noUtxo ? t('比特币余额暂不可用，请等入账确认后再试') : e instanceof Error && (e.message.includes('404') || e.message.includes('No available')) ? t('暂无可用路线，试试换个币种或金额') : errorText(e, t('报价失败')))
      } finally {
        if (alive) setQuoting(false)
      }
    }, 600)
    return () => { alive = false; clearTimeout(timer) }
  }, [busy, amount, valid, from, to, fromAddr, toAddr, slippageBps, quoteKey, retry])

  const summary = useMemo(() => (quote ? summarizeStep(quote) : null), [quote])
  // Price: the token's own → from holdings (URL-preselected native coins like BTC carry no price) → stables at 1
  const priceOf = (t: ChainToken) => t.priceUsd || findHolding(holdings, t)?.priceUsd || (isStable(t.symbol) ? 1 : 0)
  const outAmount = summary ? fromBaseUnits(summary.toAmount, to.decimals) : null

  const flip = () => { setFrom(to); setTo(from); setAmount('') }

  const confirm = async () => {
    if (!quote || !currentQuote || busy) return
    try {
      setPhase('signing'); setPendingTx(null)
      const hash = await executeLifiStep(quote, { solana: wallet, evm: evmAccount, solanaRpc: rpcUrl, btc }, setPhase, setPendingTx)
      setSentHash(hash)
      setPhase('done')
      reportFeeReceipt('lifi', hash)
      addTransfer({
        txHash: hash, fromChain: from.chainId, toChain: to.chainId, fromSymbol: from.symbol, toSymbol: to.symbol,
        fromAmount: amt, toAmount: outAmount || 0, tool: quote.tool,
      })
      toast.success(summary?.crossChain ? t('已发出，等待跨链到账') : t('闪兑成功'))
      // If the from / to token is an altcoin, record as sell / buy
      if (isReportable(from)) reportTrade({ side: 'sell', chainId: from.chainId, token: from.address, symbol: from.symbol, name: from.name, logo: from.logo, qty: amt, usd: summary?.fromAmountUsd || amt * priceOf(from), tx: hash })
      if (isReportable(to)) reportTrade({ side: 'buy', chainId: to.chainId, token: to.address, symbol: to.symbol, name: to.name, logo: to.logo, qty: outAmount || 0, usd: summary?.toAmountUsd || (outAmount || 0) * priceOf(to), tx: hash + ':in' })
      setAmount('')
      setTimeout(refresh, 3000)
    } catch (e) {
      setPhase('idle')
      alertError(e, t('闪兑失败'))
    }
  }

  const sent = sentHash ? transfers.find((t) => t.txHash === sentHash) : undefined
  // Progress: web explicitly says "please confirm in the 0x4 extension window", after sending "sent, waiting for on-chain confirmation" (lib/execPhase.ts)
  const progress = busy ? execPhaseText(phase as ExecPhase, signerOf(kind)) : null
  const pendingLink = pendingTx ? (from.chainId === SOLANA_CHAIN_ID ? explorerTx(pendingTx) : CHAINS.find((c) => c.id === from.chainId)?.explorerTx(pendingTx)) : undefined
  const btnText = progress ? progress.main : !amt ? t('输入金额') : amt > balance ? t('余额不足') : quoting ? t('获取最优路线…') : quoteErr ? t('无可用路线') : summary?.crossChain ? t('确认跨链闪兑') : t('确认闪兑')

  return (
    <div className={deskCard ? 'desk-swap wc-panel' : bare ? '' : 'safe-top'}>
      {/* Flash swap isn't a bottom tab; entering from the asset home / coin details: give it a top-left back button (previously none — you could only leave via bottom tabs) */}
      {!bare && <header className="page-header page-gutter"><div className="flex items-center gap-1">{!embedded && <button onClick={back} className="icon-button -ml-2" aria-label={t('返回')} data-tooltip={t('返回')}><ArrowLeft size={21} /></button>}<h1 className="page-title">{embedded ? t('闪兑与跨链') : t('闪兑')}</h1></div></header>}
      <div className="page-gutter">
      <fieldset disabled={busy} className="min-w-0 disabled:opacity-60">

      {/* Pay */}
      <section className="py-2" aria-label={t('支付资产')}>
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={amountId} className="text-sm text-muted">{t('支付')}</label>
          <TokenButton t={from} onClick={() => { setPicking('from') }} label={t('选择支付代币')} />
        </div>
        <input id={amountId} type="number" min="0" step="any" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value) }} placeholder="0" disabled={busy} aria-invalid={amt > balance} aria-describedby={`${amountId}-balance`} className="number mt-4 min-h-14 w-full min-w-0 rounded bg-transparent text-[36px] font-semibold placeholder:text-muted" />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span className="number">{priceOf(from) && amt > 0 ? `≈ ${fmtMoney(amt * priceOf(from))}` : '--'}</span>
          <span id={`${amountId}-balance`} className="number">{t('余额 {amount}', { amount: fmtAmount(balance) })}{balance > 0 && <button className="ml-2 min-h-11 px-2 font-medium text-accent" onClick={() => setAmount(String(fromBtc ? Math.max(0, Math.floor((balance - BTC_FEE_RESERVE) * 1e8) / 1e8) : balance))}>{t('最大')}</button>}</span>
        </div>
      </section>

      <div className="my-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-line" /><button onClick={flip} disabled={busy} className="icon-button bg-card2 text-fg" aria-label={t('交换支付与接收资产')} title={t('交换资产')}><ArrowDownUp size={18} /></button><div className="h-px flex-1 bg-line" />
      </div>

      {/* Receive */}
      <section className="border-b border-line pb-6" aria-label={t('接收资产')}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted">{t('预计收到')}</span>
          <TokenButton t={to} onClick={() => { setPicking('to') }} label={t('选择目标代币')} />
        </div>
        <div className="number mt-4 flex min-h-14 items-center break-all text-[36px] font-semibold" role="status">{quoting ? <span className="skeleton inline-block h-9 w-32" aria-label={t('正在获取报价')} /> : currentQuote && outAmount !== null ? fmtAmount(outAmount, 6) : <span className="text-muted">--</span>}</div>
        <div className="number mt-2 text-xs text-muted">{currentQuote && summary ? `≈ ${fmtMoney(summary.toAmountUsd)}` : '--'}</div>
      </section>
      </fieldset>

      {/* Trade details. 2026-09-28 goat: don't show which platforms the swap routes through — useless to users */}
      {currentQuote && summary && (
        <div className="mt-5 space-y-3 text-sm" aria-label={t('交易详情')}>
          <Line k={t('预计耗时')} v={<span className="flex items-center gap-1"><Clock size={12} />{summary.seconds < 60 ? t('{n} 秒', { n: summary.seconds }) : t('{n} 分钟', { n: Math.ceil(summary.seconds / 60) })}</span>} />
          <Line k={t('最少到账')} v={`${fmtAmount(fromBaseUnits(summary.toAmountMin, to.decimals), 6)} ${to.symbol}`} />
          {/* Selling BTC carries no platform fee, only the service's fixed fee (lib/btcSwap.ts header) */}
          <Line k={t('手续费')} v={spotFeeLabel(fees, 'lifi')} />
          <Line k={t('桥 / 协议费')} v={fmtMoney(summary.feeUsd)} />
          <Line k={fromBtc ? t('比特币网络手续费') : t('预计 Gas')} v={fmtMoney(summary.gasUsd)} />
          {btcSide && <Line k={t('比特币到账')} v={t('约 10~30 分钟')} />}
          <Line k={t('滑点上限')} v={`${(slippageBps / 100).toFixed(2)}%`} />
          {summary.crossChain && <div className="pt-1 text-xs text-muted">{t('从 {from} 到 {to}，到账后会自动出现在资产页。', { from: chainName(from.chainId), to: chainName(to.chainId) })}</div>}
        </div>
      )}
      {btcBlocked && <div className="mt-4 rounded-lg border border-warning/30 px-3 py-2.5 text-sm text-warning" role="status">{btcBlocked}</div>}
      {needSol && <div className="mt-4 rounded-lg border border-warning/30 px-3 py-2.5 text-sm text-warning" role="status">{t('从 Solana 发起交易需要 SOL 付手续费，当前只有 {amount} SOL。先往 Solana 地址充入至少 0.01 SOL。', { amount: solBalance.toFixed(4) })}</div>}
      {quoteErr && <div className="mt-4 flex items-center gap-3 text-sm text-warning" role="status"><span className="min-w-0 flex-1 break-words">{quoteErr}</span><button className="icon-button" onClick={() => setRetry(value => value + 1)} aria-label={t('重试报价')}><RefreshCw size={18} /></button></div>}

      <Button size="lg" className="mt-6 w-full" disabled={!currentQuote || !quote || busy} loading={busy} onClick={confirm}>
        {btnText}
      </Button>
      {progress && (
        <div role="status" className="mt-3 space-y-1 text-center text-sm">
          <p className="font-medium">{progress.main}</p>
          {progress.hint && <p className="text-xs text-muted">{progress.hint}</p>}
          {phase === 'sent' && pendingLink && <a href={pendingLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent">{t('在区块浏览器查看')}<ExternalLink size={12} /></a>}
        </div>
      )}

      {/* Progress of the just-sent order */}
      {sent && (
        <div className="mt-5 border-y border-line py-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="min-w-0 break-words font-semibold">{fmtAmount(sent.fromAmount)} {sent.fromSymbol} → {sent.toSymbol}</span>
            <StatusPill status={sent.status} />
          </div>
          <div className="mt-1 text-xs text-muted">{sent.substatus || (sent.status === 'PENDING' ? t('等待链上确认…') : '')}</div>
          <div className="mt-2 flex gap-3 text-xs">
            {sent.explorerLink && <a href={sent.explorerLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-accent">{t('查看进度')} <ExternalLink size={12} /></a>}
            {sent.receivingTxLink && <a href={sent.receivingTxLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-accent">{t('到账交易')} <ExternalLink size={12} /></a>}
          </div>
        </div>
      )}

      <TokenPicker open={!busy && picking === 'from'} onClose={() => setPicking(null)} title={t('选择支付代币')} onlyHoldings={holdings.length > 0} exclude={to} onSelect={(t) => { setFrom(t); setAmount('') }} />
      <TokenPicker open={!busy && picking === 'to'} onClose={() => setPicking(null)} title={t('选择目标代币')} exclude={from} onSelect={(t: PickedToken) => setTo(t)} />
      </div>
    </div>
  )
}

function TokenButton({ t, onClick, label }: { t: ChainToken; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} aria-label={label} className="flex min-h-12 min-w-0 max-w-[70%] items-center gap-2 rounded-lg border border-line bg-card py-1.5 pl-2 pr-3 active:bg-line">
      <TokenLogo src={t.logo} symbol={t.symbol} size={28} />
      <div className="min-w-0 text-left leading-tight">
        <div className="truncate text-sm font-semibold">{t.symbol}</div>
        <div className="mt-1 truncate text-xs text-muted">{chainName(t.chainId)}</div>
      </div>
      <ChevronDown size={16} className="shrink-0 text-muted" />
    </button>
  )
}

function Line({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex items-baseline justify-between gap-4"><span className="shrink-0 text-muted">{k}</span><span className="number min-w-0 break-words text-right font-medium">{v}</span></div>
}

export function StatusPill({ status }: { status: 'PENDING' | 'DONE' | 'FAILED' }) {
  const map = { PENDING: ['进行中', 'bg-yellow-400/15 text-yellow-400'], DONE: ['已完成', 'bg-up/15 text-up'], FAILED: ['失败', 'bg-down/15 text-down'] } as const
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${map[status][1]}`}>{t(map[status][0])}</span>
}
