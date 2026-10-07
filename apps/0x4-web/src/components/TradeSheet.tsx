// Buy / sell sheet (supports tokens on any chain)
// Buy:
//   - Solana token + paying with SOL → Jupiter aggregator, settles in seconds
//   - everything else (any asset on any chain buying any chain's token) → LI.FI routing, bridge + swap in one tx
// Sell:
//   - Solana tokens → SOL (Jupiter)
//   - EVM tokens → the chain's native coin (LI.FI)
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, ChevronDown, Clock, ExternalLink, RefreshCw } from 'lucide-react'
import Button from '@/components/Button'
import Sheet from '@/components/Sheet'
import TokenLogo from '@/components/TokenLogo'
import TokenPicker, { type PickedToken } from '@/components/TokenPicker'
import { Input } from '@/components/Field'
import { toast } from '@/components/Toast'
import { alertError } from '@/components/AlertDialog'
import { useMarket } from '@/store/market'
import { usePortfolio } from '@/store/portfolio'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'
import { useBridge } from '@/store/bridge'
import { useFavorites } from '@/store/favorites'
import { executeSwap, getQuote, type JupQuote } from '@/lib/jupiter'
import { executeLifiStep, getLifiQuote, summarizeStep, type ExecPhase, type LiFiStep } from '@/lib/lifi'
import { execPhaseText, signerOf } from '@/lib/execPhase'
import { isBtcChain, swapAddressFor } from '@/lib/btcSwap'
import { explorerTx, getMintDecimals } from '@/lib/rpc'
import { getErc20Decimals, getEvmTokenBalance } from '@/lib/evm'
import { NATIVE_SOL, SOLANA_CHAIN_ID, chainById, chainName, isStable, isNative, isGasToken, sameAddr, type ChainToken } from '@/lib/chains'
import { findHolding, holdingToToken } from '@/lib/tokens'

const BSC_USDT = '0x55d398326f99059fF775485246999027B3197955'
import { fmtAmount, fmtMoney, fromBaseUnits, toBaseUnits } from '@/lib/format'
import { SOL_MINT } from '@/lib/mock'
import type { MarketToken } from '@/lib/types'
import { reportTrade } from '@/lib/trades'
import { t } from '@/lib/i18n'
import { currentFees, jupiterFee, reportFeeReceipt, spotFeeLabel, useFees } from '@/lib/fees'
import FuelGauge from '@/components/FuelGauge'
import { BSC as GAS_BSC, checkGas, describeProblem, gasRule, nativeUsd, topUpUsd, type GasProblem } from '@/lib/gas'
import { useRefuel } from '@/lib/useRefuel'
import { errorText } from '@/lib/errors'

export type Side = 'buy' | 'sell'

export interface TradeFormInput { open: boolean; side: Side; token: MarketToken; onFilled?: (tx: string) => void; /** Prefill a percentage of balance on open (sell half to take principal at 2x = 50) */ initialPct?: number; /** Prefill by USD amount on open (sprite requests "buy ~$10"; 2026-10-05 goat: the amount used to be 0 after confirming, forcing manual entry) */ initialUsd?: number }

/**
 * All buy/sell state and logic (payment asset, decimals, balance, quotes, gas checks, order placement).
 * Shared between the mobile sheet (TradeSheet below) and the web trading terminal's order panel (src/desktop/trade/SpotOrderForm.tsx, 2026-09-29) — same logic, different UI.
 */
export function useTradeForm({ open, side, token, onFilled, initialPct, initialUsd }: TradeFormInput) {
  const fees = useFees((s) => s.fees)
  const { wallet, evmAccount, address, evmAddress, btcAddress, btc, kind } = useWallet()
  const { solBalance, holdings, refresh } = usePortfolio()
  const { slippageBps, rpcUrl } = useSettings()
  const solPrice = useMarket((s) => s.solPrice)
  const addTransfer = useBridge((s) => s.add)
  const favorites = useFavorites((s) => s.items)

  const isBuy = side === 'buy'
  const isSolToken = token.chainId === SOLANA_CHAIN_ID
  const tokenChain = chainById(token.chainId)
  const holding = holdings.find((h) => h.chainId === token.chainId && sameAddr(h.mint, token.address))
  const favDecimals = favorites.find((f) => f.chain === token.chain && sameAddr(f.address, token.address))?.decimals

  const [amount, setAmount] = useState('')
  const [decimals, setDecimals] = useState<number | null>(holding?.decimals ?? favDecimals ?? token.decimals ?? null)
  /** Payment asset: null means SOL on Solana (Jupiter) */
  const [payWith, setPayWith] = useState<PickedToken | null>(null)
  const [picking, setPicking] = useState(false)
  const [evmBalance, setEvmBalance] = useState<number | null>(null)
  const [jupQuote, setJupQuote] = useState<JupQuote | null>(null)
  const [lifiQuote, setLifiQuote] = useState<LiFiStep | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [quoteErr, setQuoteErr] = useState<string | null>(null)
  const [phase, setPhase] = useState<ExecPhase | 'idle'>('idle')
  const [result, setResult] = useState<{ sig: string; crossChain: boolean; fromChain: number } | null>(null)
  const [quotedFor, setQuotedFor] = useState('')
  const [metadataError, setMetadataError] = useState(false)
  const [retry, setRetry] = useState(0)
  const busy = phase !== 'idle'

  // Whether buying routes via LI.FI: non-Solana token, or paying with a non-SOL asset
  const useLifiBuy = isBuy && (!isSolToken || !!payWith)
  const useLifiSell = !isBuy && !isSolToken
  const useLifi = useLifiBuy || useLifiSell
  const amt = Number(amount)
  const tokenBalance = holding?.amount ?? evmBalance ?? 0
  // Gas reserve (2026-09-27): with auto-top-up on, paying with BNB must not touch the reserved portion
  const { autoRefuel, gasReserveUsd } = useSettings()
  const payIsBnb = !!payWith && payWith.chainId === GAS_BSC && isNative(payWith.address)
  const bnbPx = payWith?.priceUsd || 0
  const reservedNative = isBuy && autoRefuel && payIsBnb && bnbPx > 0 ? gasReserveUsd / bnbPx : 0
  const payBalance = isBuy
    ? payWith ? Math.max(0, (findHolding(holdings, payWith)?.amount ?? payWith.amount ?? 0) - reservedNative) : Math.max(0, solBalance - 0.01)
    : tokenBalance
  const valid = Number.isFinite(amt) && amt > 0 && amt <= payBalance
  const paySymbol = isBuy ? (payWith?.symbol ?? 'SOL') : token.symbol
  const payPrice = isBuy ? (payWith ? payWith.priceUsd || (isStable(payWith.symbol) ? 1 : 0) : solPrice) : token.priceUsd
  const receiveSymbol = isBuy ? token.symbol : isSolToken ? 'SOL' : tokenChain?.native.symbol ?? ''
  const receiveDecimals = isBuy ? decimals ?? 0 : isSolToken ? 9 : 18
  const quoteKey = JSON.stringify([side, token.chainId, token.address, amount, payWith?.chainId, payWith?.address, decimals, slippageBps, address, evmAddress])
  const currentQuote = quotedFor === quoteKey && valid && !quoting && !metadataError
  // Pre-order gas check: the payment chain and the bought token's chain (needed for future sells); each missing piece is reported by name
  const payChainId = isBuy ? (payWith?.chainId ?? SOLANA_CHAIN_ID) : token.chainId
  const gasProblems = useMemo(() => {
    if (!open || !(amt > 0)) return [] as GasProblem[]
    const payToken = isBuy ? (payWith?.address ?? NATIVE_SOL) : token.address
    const bundled = isBuy && token.chainId !== SOLANA_CHAIN_ID && payChainId !== token.chainId   // Cross-chain buys of EVM tokens swap in some destination-chain gas along the way
    return checkGas({ holdings, pay: { chainId: payChainId, token: payToken, usd: isBuy ? amt * payPrice : 0, balanceUsd: isBuy ? (payBalance + reservedNative) * payPrice : 0 }, targetChainId: isBuy ? token.chainId : payChainId, bundledTargetGas: bundled, reserveUsd: autoRefuel ? gasReserveUsd : 0 })
      .filter((p) => p.kind === 'gas')   // Insufficient payment balance is already flagged on the button
  }, [open, amt, isBuy, payWith, token.chainId, token.address, payChainId, holdings, payPrice, payBalance, reservedNative, autoRefuel, gasReserveUsd])
  const blockingGas = gasProblems.filter((p) => p.chainId === payChainId && !(autoRefuel && p.refillable))
  const refuel = useRefuel()

  // Reset on open. Buys default to paying with USDT on BSC (2026-09-25 goat): use it when there's balance;
  // otherwise the highest-value holding; when there's nothing at all, still show BSC USDT (balance 0) so users know what to top up
  useEffect(() => {
    if (!open) return
    setAmount(''); setJupQuote(null); setLifiQuote(null); setQuoteErr(null); setResult(null); setPhase('idle'); setPicking(false); setQuotedFor('')
    if (isBuy) {
      const usable = holdings.filter((h) => h.valueUsd > 0.5 && !(h.chainId === token.chainId && sameAddr(h.mint, token.address)))
      const bscUsdt = usable.find((h) => h.chainId === 56 && sameAddr(h.mint, BSC_USDT))
      const best = bscUsdt ?? usable.sort((a, b) => b.valueUsd - a.valueUsd)[0]
      const fallback = chainById(56)?.tokens.find((x) => sameAddr(x.address, BSC_USDT))
      setPayWith(best ? holdingToToken(best) : fallback ? { ...fallback, amount: 0 } : null)
    } else setPayWith(null)
  }, [open, side, token.chainId, token.address]) // eslint-disable-line react-hooks/exhaustive-deps

  // Decimals: Solana reads the mint, EVM reads decimals()
  useEffect(() => {
    if (!open) return
    let alive = true
    const known = holding?.decimals ?? favDecimals ?? token.decimals
    setMetadataError(false)
    if (known !== undefined) { setDecimals(known); return }
    setDecimals(null)
    const p = isSolToken ? getMintDecimals(rpcUrl, token.address) : getErc20Decimals(token.chainId, token.address)
    p.then(value => { if (alive) setDecimals(value) }).catch(() => { if (alive) setMetadataError(true) })
    return () => { alive = false }
  }, [open, holding?.decimals, favDecimals, token.decimals, isSolToken, rpcUrl, token.address, token.chainId, retry])

  // When an EVM token is outside the holdings scan range, read its balance once separately before selling
  useEffect(() => {
    setEvmBalance(null)
    if (!open || isBuy || isSolToken || holding || !evmAddress || decimals === null) return
    let alive = true
    getEvmTokenBalance(token.chainId, evmAddress, token.address).then(b => { if (alive) setEvmBalance(Number(b) / 10 ** decimals) }).catch(() => {})
    return () => { alive = false }
  }, [open, isBuy, isSolToken, holding, evmAddress, token.chainId, token.address, decimals])

  // Quotes (debounced)
  useEffect(() => {
    if (busy) return
    setJupQuote(null); setLifiQuote(null); setQuoteErr(null); setQuotedFor(''); setQuoting(false)
    if (!open || result || !valid || decimals === null || metadataError) return
    if (useLifiBuy && !payWith) { setQuoteErr(t('请先选择支付资产')); return }
    let alive = true
    setQuoting(true)
    const timer = setTimeout(async () => {
      try {
        if (useLifi) {
          const from: ChainToken = isBuy ? payWith! : { chainId: token.chainId, address: token.address, symbol: token.symbol, name: token.name, decimals }
          const to: ChainToken = isBuy
            ? { chainId: token.chainId, address: token.address, symbol: token.symbol, name: token.name, decimals }
            : tokenChain!.native
          // Each chain uses its own address (bc1q when paying with BTC, lib/btcSwap.ts)
          const fromAddr = swapAddressFor(from.chainId, { address, evmAddress, btcAddress })
          const toAddr = swapAddressFor(to.chainId, { address, evmAddress, btcAddress })
          if (!fromAddr || !toAddr) throw new Error(t('缺少地址'))
          // When the destination is an EVM chain with no native coin there, swap in ~$3 of gas too, or the received tokens can't be sold
          // Swaps starting from Bitcoin can't bundle gas (the cross-chain service's BTC route doesn't take that parameter)
          const needGas = !isBtcChain(from.chainId) && to.chainId !== SOLANA_CHAIN_ID && from.chainId !== to.chainId && !holdings.some((h) => h.chainId === to.chainId && isGasToken(to.chainId, h.mint) && h.amount > 0)
          const gasUnits = needGas && payPrice > 0 ? toBaseUnits((3 / payPrice).toFixed(from.decimals), from.decimals) : undefined
          const fees = await currentFees()
          const quote = await getLifiQuote({
            fromChain: from.chainId, fromToken: from.address, toChain: to.chainId, toToken: to.address,
            fromAmount: toBaseUnits(amount, from.decimals), fromAddress: fromAddr, toAddress: toAddr, slippage: slippageBps / 10_000, order: 'FASTEST', fromAmountForGas: gasUnits,
            feeBps: fees.evmBps, integrator: fees.lifiIntegrator,
          })
          if (alive) { setLifiQuote(quote); setQuotedFor(quoteKey) }
        } else {
          const inputMint = isBuy ? SOL_MINT : token.address, outputMint = isBuy ? token.address : SOL_MINT
          const quote = await getQuote({ inputMint, outputMint, amount: toBaseUnits(amount, isBuy ? 9 : decimals), slippageBps, fee: jupiterFee(await currentFees(), inputMint, outputMint) })
          if (alive) { setJupQuote(quote); setQuotedFor(quoteKey) }
        }
      } catch (e) {
        const msg = errorText(e, '')
        if (alive) setQuoteErr(useLifi && (msg.includes('404') || msg.includes('No ')) ? t('暂无可用路线，请更换支付资产或金额') : msg || t('获取报价失败'))
      } finally {
        if (alive) setQuoting(false)
      }
    }, 500)
    return () => { alive = false; clearTimeout(timer) }
  }, [open, busy, result, amount, valid, decimals, metadataError, isBuy, useLifi, useLifiBuy, payWith, token, tokenChain, slippageBps, address, evmAddress, holdings, payPrice, quoteKey, retry])

  const summary = useMemo(() => (lifiQuote ? summarizeStep(lifiQuote) : null), [lifiQuote])
  const outAmount = jupQuote ? fromBaseUnits(jupQuote.outAmount, receiveDecimals) : summary ? fromBaseUnits(summary.toAmount, receiveDecimals) : null
  const impact = jupQuote ? Number(jupQuote.priceImpactPct) * 100 : 0
  const receivePrice = isBuy ? token.priceUsd : isSolToken ? solPrice : 0
  // Pick the amount as a percentage of available balance (replaces the old 0.1 / 0.5 / 1 / 2 quick buttons)
  const pct = payBalance > 0 && amt > 0 ? Math.min(100, Math.round((amt / payBalance) * 100)) : 0
  const setPct = (p: number) => {
    if (payBalance <= 0) return
    const places = isBuy ? (payWith && isStable(payWith.symbol) ? 2 : 6) : Math.min(decimals ?? 6, 6)
    const v = p >= 100 ? payBalance : (payBalance * p) / 100
    setAmount(p <= 0 ? '' : String(Math.floor(v * 10 ** places) / 10 ** places))
  }
  // Prefill percentage: fill once when the balance arrives; the user edits after that
  const prefilled = useRef(false)
  useEffect(() => { if (!open) prefilled.current = false }, [open])
  useEffect(() => {
    if (!open || prefilled.current) return
    if (initialPct) { if (payBalance > 0) { prefilled.current = true; setPct(initialPct) } return }
    // Prefill by USD: for buys, wait until the payment asset settles (cleared on open, then BSC USDT is picked) and a price exists; fill the balance when it's short, and fill the amount even at zero so the button flags insufficient balance
    if (initialUsd && initialUsd > 0 && payPrice > 0 && (!isBuy || payWith)) {
      prefilled.current = true
      const want = initialUsd / payPrice
      const v = payBalance > 0 ? Math.min(want, payBalance) : want
      const places = isBuy ? (payWith && isStable(payWith.symbol) ? 2 : 6) : Math.min(decimals ?? 6, 6)
      setAmount(String(Math.floor(v * 10 ** places) / 10 ** places))
    }
  }, [open, initialPct, initialUsd, payBalance, payPrice, payWith]) // eslint-disable-line react-hooks/exhaustive-deps
  // Before quotes arrive, rough-estimate the receivable amount from the spot price (once quotes arrive, "estimated receive" wins)
  const roughOut = isBuy && amt > 0 && payPrice > 0 && token.priceUsd > 0 ? (amt * payPrice) / token.priceUsd : null

  const confirm = async () => {
    if (!currentQuote || busy || result || blockingGas.length) return
    try {
      // With gas auto-top-up on: shortfalls are covered from the BNB reserve first; shortfalls on the payment chain must wait for the top-up to land before ordering
      if (autoRefuel) {
        for (const p of gasProblems.filter((x) => x.refillable)) {
          setPhase('signing')
          toast.success(t('正在为 {chain} 补充燃料费…', { chain: chainById(p.chainId)?.name || '' }))
          await refuel.run(p.chainId, topUpUsd(p))
          if (p.chainId === payChainId) {
            for (let i = 0; i < 12 && nativeUsd(usePortfolio.getState().holdings, p.chainId) < gasRule(p.chainId).minUsd; i++) {
              await new Promise((res) => setTimeout(res, 4000)); await usePortfolio.getState().refresh()
            }
          }
        }
      }
      if (useLifi) {
        if (!lifiQuote) return
        setPhase('signing')
        const hash = await executeLifiStep(lifiQuote, { solana: wallet, evm: evmAccount, solanaRpc: rpcUrl, btc }, setPhase)
        const fromChain = lifiQuote.action.fromChainId
        const cross = fromChain !== lifiQuote.action.toChainId
        addTransfer({ txHash: hash, fromChain, toChain: lifiQuote.action.toChainId, fromSymbol: paySymbol, toSymbol: receiveSymbol, fromAmount: amt, toAmount: outAmount || 0, tool: lifiQuote.tool })
        setResult({ sig: hash, crossChain: cross, fromChain })
        reportFeeReceipt('lifi', hash)
        reportTrade({ side: isBuy ? 'buy' : 'sell', chainId: token.chainId, token: token.address, symbol: token.symbol, name: token.name, logo: token.logo, qty: isBuy ? outAmount || 0 : amt, usd: isBuy ? amt * payPrice : (outAmount || 0) * receivePrice, marketCap: token.marketCap ?? token.fdv, tx: hash }); onFilled?.(hash)
        toast.success(cross ? t('已发出，等待跨链到账') : isBuy ? t('买入成功') : t('卖出成功'))
      } else {
        if (!jupQuote || !wallet) return
        setPhase('signing')
        const sig = await executeSwap(rpcUrl, wallet, jupQuote)
        setResult({ sig, crossChain: false, fromChain: SOLANA_CHAIN_ID })
        reportFeeReceipt('jupiter', sig)
        // Trading is social: filled trades are reported, auto-generating a "buy / sell" post and counting toward PnL
        reportTrade({ side: isBuy ? 'buy' : 'sell', chainId: token.chainId, token: token.address, symbol: token.symbol, name: token.name, logo: token.logo, qty: isBuy ? outAmount || 0 : amt, usd: isBuy ? amt * payPrice : (outAmount || 0) * receivePrice, marketCap: token.marketCap ?? token.fdv, tx: sig }); onFilled?.(sig)
        toast.success(isBuy ? t('买入成功') : t('卖出成功'))
      }
      setTimeout(refresh, 3000)
    } catch (e) {
      alertError(e, t('交易失败'))
    } finally {
      setPhase('idle')
    }
  }

  // Web explicitly says "confirm in the 0x4 extension window", then "sent, awaiting on-chain confirmation" after broadcast (lib/execPhase.ts, 2026-10-05)
  const progress = phase === 'idle' ? null : execPhaseText(phase, signerOf(kind))
  const phaseText = progress?.main ?? ''
  const phaseHint = phase !== 'sent' ? progress?.hint : undefined
  const resultLink = result ? (result.crossChain && !isBtcChain(result.fromChain) ? `https://scan.li.fi/tx/${result.sig}` : result.fromChain === SOLANA_CHAIN_ID ? explorerTx(result.sig) : chainById(result.fromChain)?.explorerTx(result.sig) || '#') : '#'

  /** Payment asset picked (shared by the mobile token picker sheet / web dropdown panel): Solana token + SOL on Solana selected → back to the Jupiter path */
  const selectPay = (picked: PickedToken) => {
    if (isSolToken && picked.chainId === SOLANA_CHAIN_ID && picked.address === NATIVE_SOL) setPayWith(null)
    else setPayWith(picked)
    setAmount('')
  }

  return {
    fees, holdings, holding, isBuy, isSolToken, tokenChain, amount, setAmount, decimals, payWith, setPayWith, selectPay, picking, setPicking,
    jupQuote, lifiQuote, quoting, quoteErr, phase, result, metadataError, setRetry, busy, amt, payBalance, valid, paySymbol, payPrice,
    receiveSymbol, receiveDecimals, currentQuote, gasProblems, blockingGas, refuel, autoRefuel, slippageBps, summary, outAmount, impact,
    receivePrice, pct, setPct, roughOut, confirm, phaseText, phaseHint, resultLink,
    /** Paying with BTC (selling BTC): only the service's flat fee applies; arrival takes ~10–30 min (2026-09-30 BTC instant swap) */
    payBtc: isBuy && !!payWith && isBtcChain(payWith.chainId),
  }
}
export type TradeForm = ReturnType<typeof useTradeForm>

export default function TradeSheet({ open, side, token, onClose, onFilled, initialPct, initialUsd, inline = false }: { open: boolean; side: Side; token: MarketToken; onClose: () => void; onFilled?: (tx: string) => void; /** Prefill a percentage of balance on open (sell half to take principal at 2x = 50) */ initialPct?: number; initialUsd?: number
  /** Web trading terminal (2026-09-29): rendered directly in the right-column order panel, no sheet; logic is exactly the same as the sheet */
  inline?: boolean }) {
  const {
    fees, holdings, isBuy, isSolToken, amount, setAmount, payWith, setPayWith, selectPay, picking, setPicking,
    jupQuote, lifiQuote, quoting, quoteErr, result, metadataError, setRetry, busy, amt, payBalance, paySymbol, payPrice,
    receiveSymbol, receiveDecimals, currentQuote, gasProblems, blockingGas, refuel, autoRefuel, slippageBps, summary, outAmount, impact,
    pct, setPct, roughOut, confirm, phaseText, phaseHint, resultLink, payBtc,
  } = useTradeForm({ open, side, token, onFilled, initialPct, initialUsd })
  const amountId = useId()
  // Web with an EVM-only external wallet (MetaMask etc.) trading Solana tokens: no Solana address exists, so show a one-liner + get-0x4-Wallet prompt (same as the widescreen trading terminal, 2026-09-30)
  const noSolana = useWallet((w) => w.kind === 'external' && !w.wallet)
  if (noSolana && isSolToken && !result) {
    const notice = (
      <div className="py-8 text-center">
        <p className="text-sm text-muted">{t('这个币在 Solana 上，用 0x4 Wallet 就能买卖')}</p>
        {/* Dynamic import: the mobile app bundle excludes the web wallet-connect code */}
        <Button className="mt-5 w-full" onClick={() => void import('@/desktop/walletGate').then((m) => m.getOx4Wallet())}>{t('获取 0x4 Wallet')}</Button>
      </div>
    )
    return inline ? notice : <Sheet open={open} onClose={onClose} half title={isBuy ? t('买入 {symbol}', { symbol: token.symbol }) : t('卖出 {symbol}', { symbol: token.symbol })}>{notice}</Sheet>
  }

  const body = (
    <>
      {result ? (
        <div className="py-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-up/15 text-up">{result.crossChain ? <ArrowRight size={26} /> : <Check size={26} />}</div>
          <div className="text-lg font-semibold">{result.crossChain ? t('跨链交易已发出') : t('交易已确认')}</div>
          {result.crossChain && <p className="mt-1 text-sm text-muted">{t('通常 1 ~ 3 分钟到账，可在「活动」页跟踪进度')}</p>}
          <a href={resultLink} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-accent underline">{t('查看交易')} <ExternalLink size={12} /></a>
          <Button className="mt-6 w-full" onClick={onClose}>{t('完成')}</Button>
        </div>
      ) : (
        <div className="space-y-5">
          <fieldset disabled={busy} className="min-w-0 space-y-5 disabled:opacity-60">
          {isBuy && (
            <div>
              <div className="mb-2 text-sm text-muted">{t('支付资产')}</div>
              <div className="flex flex-wrap gap-2">
                {isSolToken && (
                  <button onClick={() => { setPayWith(null); setAmount('') }} aria-pressed={!payWith} className={`flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium ${!payWith ? 'border-accent text-accent' : 'border-line text-muted'}`}>
                    SOL
                  </button>
                )}
                <button onClick={() => setPicking(true)} aria-label={t('选择支付资产')} className={`flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium ${payWith ? 'border-accent text-fg' : 'border-line text-muted'}`}>
                  {payWith ? <><TokenLogo src={payWith.logo} symbol={payWith.symbol} size={22} /><span className="min-w-0 truncate">{payWith.symbol} · {chainName(payWith.chainId)}</span></> : t('选择资产')}
                  <ChevronDown size={16} className="shrink-0" />
                </button>
              </div>
            </div>
          )}

          <div className="border-y border-line py-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <label htmlFor={amountId}>{isBuy ? t('支付数量') : t('卖出数量')}</label>
              <span className="number break-all">{t('可用 {amount} {symbol}', { amount: fmtAmount(payBalance), symbol: paySymbol })}</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Input id={amountId} type="number" min="0" step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" aria-invalid={amt > payBalance} disabled={busy} className="ui-field-bare number min-w-0 flex-1 px-0 text-3xl font-semibold" />
              <span className="max-w-[40%] break-all text-sm font-semibold">
                {paySymbol}
              </span>
            </div>
            <div className="number mt-1 flex flex-wrap justify-between gap-x-3 text-xs text-muted">
              <span>{amt > 0 && payPrice > 0 ? `≈ ${fmtMoney(amt * payPrice)}` : '--'}</span>
              {roughOut !== null && <span>{t('约可买 {amount} {symbol}', { amount: fmtAmount(roughOut), symbol: token.symbol })}</span>}
            </div>
          </div>

          <div aria-label={t('按余额比例')}>
            <input type="range" min={0} max={100} step={1} value={pct} onChange={(e) => setPct(Number(e.target.value))} disabled={payBalance <= 0}
              className="pct-slider w-full" aria-valuetext={`${pct}%`} />
            <div className="mt-1 flex justify-between text-[11px] text-muted">
              {[0, 25, 50, 75, 100].map((p) => (
                <button key={p} type="button" onClick={() => setPct(p)} className={`number min-w-8 rounded px-1 py-0.5 ${pct === p ? 'font-semibold text-fg' : ''}`}>{p === 100 ? t('全部') : `${p}%`}</button>
              ))}
            </div>
          </div>
          </fieldset>

          <div className="text-sm [&>div]:gap-4 [&>div>span:first-child]:shrink-0 [&>div>span:last-child]:min-w-0 [&>div>span:last-child]:break-words [&>div>span:last-child]:text-right">
            <div className="flex justify-between"><span className="text-muted">{t('预计获得')}</span>
              <span className="number font-semibold" role="status">
                {quoting ? t('报价中') : currentQuote && outAmount !== null ? `${fmtAmount(outAmount)} ${receiveSymbol}` : '--'}
              </span>
            </div>
            <div className="mt-2 flex justify-between"><span className="text-muted">{t('滑点上限')}</span><span>{(slippageBps / 100).toFixed(2)}%</span></div>
            {/* 2026-09-28 goat: don't show which venues a swap routes through (path / routing) — useless to users; show only arrival amount, fees, and time */}
            {currentQuote && jupQuote && (
              <>
                <div className="mt-2 flex justify-between"><span className="text-muted">{t('价格影响')}</span><span className={impact > 5 ? 'text-down' : impact > 1 ? 'text-yellow-400' : ''}>{impact.toFixed(2)}%</span></div>
                <div className="mt-2 flex justify-between"><span className="text-muted">{t('最少获得')}</span><span className="number">{fmtAmount(fromBaseUnits(jupQuote.otherAmountThreshold, receiveDecimals))} {receiveSymbol}</span></div>
                {jupQuote.feeAccount && <div className="mt-2 flex justify-between"><span className="text-muted">{t('手续费')}</span><span>{spotFeeLabel(fees, 'jupiter')}</span></div>}
              </>
            )}
            {currentQuote && summary && (
              <>
                <div className="mt-2 flex justify-between"><span className="text-muted">{t('手续费')}</span><span>{spotFeeLabel(fees, 'lifi')}</span></div>
                {payBtc && <div className="mt-2 flex justify-between"><span className="text-muted">{t('比特币到账')}</span><span>{t('约 10~30 分钟')}</span></div>}
                <div className="mt-2 flex justify-between"><span className="text-muted">{t('最少获得')}</span><span className="number">{fmtAmount(fromBaseUnits(summary.toAmountMin, receiveDecimals))} {receiveSymbol}</span></div>
                <div className="mt-2 flex justify-between"><span className="text-muted">{t('预计耗时')}</span><span className="flex items-center gap-1"><Clock size={12} />{summary.seconds < 60 ? t('{n} 秒', { n: summary.seconds }) : t('{n} 分钟', { n: Math.ceil(summary.seconds / 60) })}</span></div>
                <div className="mt-2 flex justify-between"><span className="text-muted">{t('费用 + Gas')}</span><span className="number">{fmtMoney(summary.feeUsd + summary.gasUsd)}</span></div>
              </>
            )}
            {(quoteErr || metadataError) && <div className="mt-3 flex items-center justify-between text-sm text-warning" role="status"><span>{metadataError ? t('无法读取代币精度，暂不能交易') : quoteErr}</span><button className="icon-button" disabled={busy} onClick={() => setRetry(value => value + 1)} aria-label={t('重试报价')}><RefreshCw size={18} /></button></div>}
          </div>

          {currentQuote && impact > 5 && <div className="border-l-2 border-down pl-3 text-sm text-down">{t('价格影响超过 5%，请减小金额。')}</div>}
          {gasProblems.map((p) => (
            <div key={p.chainId} className="flex items-center gap-2.5 text-sm text-warning" role="status">
              <FuelGauge level="low" size={20} className="text-muted" />
              <span className="min-w-0 flex-1">{describeProblem(p)}{p.refillable && autoRefuel ? t('，下单时会先自动补充') : ''}</span>
              {p.refillable && !autoRefuel && <button disabled={refuel.busyChain === p.chainId} className="shrink-0 text-xs font-semibold text-accent disabled:opacity-50" onClick={() => refuel.run(p.chainId, topUpUsd(p)).then(() => toast.success(t('已补充，几秒后到账'))).catch((e) => toast.error(errorText(e, t('补充失败'))))}>{refuel.busyChain === p.chainId ? t('补充中…') : t('从 BNB 补充')}</button>}
            </div>
          ))}

          <Button size="lg" variant={isBuy ? 'up' : 'down'} className="w-full" disabled={!currentQuote || (!jupQuote && !lifiQuote) || busy || blockingGas.length > 0} loading={busy} onClick={confirm}>
            {busy ? phaseText : !amt ? t('输入数量') : amt > payBalance ? t('余额不足') : quoting ? t('获取报价中') : isBuy ? t('买入 {symbol}', { symbol: token.symbol }) : t('卖出 {symbol}', { symbol: token.symbol })}
          </Button>
          {busy && <div role="status" className="space-y-1 text-center text-sm"><p className="font-medium">{phaseText}</p>{phaseHint && <p className="text-xs text-muted">{phaseHint}</p>}</div>}
        </div>
      )}

      <TokenPicker
        open={open && picking && !busy}
        onClose={() => setPicking(false)}
        title={t('选择支付资产')}
        onlyHoldings={holdings.length > 0}
        onSelect={selectPay}
      />
    </>
  )
  if (inline) return <div className="trade-inline">{body}</div>
  return (
    <Sheet open={open} onClose={onClose} dismissible={!busy} half title={isBuy ? t('买入 {symbol}', { symbol: token.symbol }) : t('卖出 {symbol}', { symbol: token.symbol })}>
      {body}
    </Sheet>
  )
}
