// Web spot order panel (right column 340px, modeled on Jupiter's swap panel). Quotes, gas checks, and signed order placement all reuse the mobile buy/sell sheet's logic
// (components/TradeSheet's useTradeForm) — only the desktop UI lives here:
// · The payment asset is a dropdown panel attached to the button (AssetPicker), not the mobile full-height sheet
// · The primary button is always tappable (2026-09-29 goat: tapping buy gave no hint or response, just a button flicker):
//   no wallet → needWallet(); no amount → focus the amount box and write the "enter amount" hint under it; insufficient balance, quotes pending, quote failure, insufficient gas — each states its reason directly
import { useEffect, useRef, useState } from 'react'
import { ArrowDown, Check, ChevronDown, Clock, ExternalLink, LoaderCircle, RefreshCw, Wallet } from 'lucide-react'
import TokenLogo from '@/components/TokenLogo'
import FuelGauge from '@/components/FuelGauge'
import { useTradeForm, type Side } from '@/components/TradeSheet'
import { SOLANA_CHAIN_ID, chainById, chainName } from '@/lib/chains'
import { describeProblem, topUpUsd } from '@/lib/gas'
import { spotFeeLabel } from '@/lib/fees'
import { fmtAmount, fmtMoney, fmtUsd, fromBaseUnits } from '@/lib/format'
import { errorText } from '@/lib/errors'
import { toast } from '@/components/Toast'
import { t } from '@/lib/i18n'
import type { MarketToken } from '@/lib/types'
import { needWallet } from '../walletGate'
import AssetPicker from './AssetPicker'

export default function SpotOrderForm({ token, side, connected, onDone }: { token: MarketToken; side: Side; connected: boolean; onDone: () => void }) {
  const f = useTradeForm({ open: true, side, token })
  const payBtn = useRef<HTMLButtonElement>(null)
  const amountInput = useRef<HTMLInputElement>(null)
  const [picking, setPicking] = useState(false)
  /** Why the primary button can't place an order, written under the amount box; cleared when the amount / asset changes */
  const [hint, setHint] = useState('')
  useEffect(() => { setHint('') }, [f.amount, f.payWith, side])

  // Keep the amount when switching buy / sell (2026-09-29 alignment: switching doesn't rebuild the panel, the amount survives).
  // The buy box holds the "payment asset" amount while the sell box holds the "token" amount — different units, so copying the number raw would turn 5 USDT into 5 BTCB,
  // so convert via USD value: pre-switch amount × then-price = value; once the new price arrives, divide back by it to refill; leave blank when no price.
  // (useTradeForm clears the amount first when side changes; this effect is declared after it, so it runs later in the same pass)
  const prev = useRef({ side, amt: 0, price: 0 })
  const [carryUsd, setCarryUsd] = useState<number | null>(null)
  useEffect(() => {
    if (prev.current.side === side) return
    const usd = prev.current.amt > 0 && prev.current.price > 0 ? prev.current.amt * prev.current.price : 0
    setCarryUsd(usd > 0 ? usd : null)
  }, [side])
  useEffect(() => {
    if (carryUsd === null || !(f.payPrice > 0)) return
    const v = carryUsd / f.payPrice
    const places = v >= 1000 ? 2 : v >= 1 ? 4 : Math.min(10, 2 - Math.floor(Math.log10(v)) + 4)
    f.setAmount(String(Number(v.toFixed(places))))
    setCarryUsd(null)
  }, [carryUsd, f.payPrice]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { prev.current = { side, amt: f.amt, price: f.payPrice } })

  const tokenChain = chainById(token.chainId)
  const payToken = f.isBuy
    ? (f.payWith ? { symbol: f.payWith.symbol, logo: f.payWith.logo, chainId: f.payWith.chainId, address: f.payWith.address } : { symbol: 'SOL', logo: chainById(SOLANA_CHAIN_ID)?.native.logo, chainId: SOLANA_CHAIN_ID, address: 'SOL' })
    : { symbol: token.symbol, logo: token.logo, chainId: token.chainId, address: token.address }
  const getToken = f.isBuy
    ? { symbol: token.symbol, logo: token.logo, chainId: token.chainId, address: token.address }
    : { symbol: f.receiveSymbol, logo: tokenChain?.native.logo, chainId: token.chainId, address: 'native' }
  const usd = f.amt > 0 && f.payPrice > 0 ? f.amt * f.payPrice : 0
  const out = f.currentQuote && f.outAmount !== null ? f.outAmount : null
  const over = connected && f.amt > f.payBalance

  const submit = () => {
    if (!connected) { needWallet(); return }
    if (f.busy) return
    if (!(f.amt > 0)) { setHint(t('请输入数量')); amountInput.current?.focus(); return }
    if (f.amt > f.payBalance) { setHint(t('余额不足，可用 {amount} {symbol}', { amount: fmtAmount(f.payBalance), symbol: f.paySymbol })); amountInput.current?.focus(); return }
    if (f.metadataError) { setHint(t('无法读取代币精度，暂不能交易')); return }
    if (f.quoteErr) { setHint(f.quoteErr); f.setRetry((v) => v + 1); return }
    if (f.quoting || !f.currentQuote) { setHint(t('正在获取报价，请稍候')); return }
    if (f.blockingGas.length) { setHint(describeProblem(f.blockingGas[0])); return }
    void f.confirm()
  }

  const label = f.busy ? f.phaseText
    : !connected ? t('连接 0x4 Wallet')
      : over ? t('余额不足')
        : f.amt > 0 && f.quoting ? t('获取报价中…')
          : f.isBuy ? t('买入 {symbol}', { symbol: token.symbol }) : t('卖出 {symbol}', { symbol: token.symbol })

  if (f.result) {
    return (
      <div className="tx-done">
        <span className="tx-done-ic">{f.result.crossChain ? <ArrowDown size={20} /> : <Check size={20} />}</span>
        <b>{f.result.crossChain ? t('跨链交易已发出') : t('交易已确认')}</b>
        {f.result.crossChain && <p>{t('通常 1 ~ 3 分钟到账，可在「活动」页跟踪进度')}</p>}
        <a href={f.resultLink} target="_blank" rel="noreferrer" className="tx-link">{t('查看交易')}<ExternalLink size={12} /></a>
        <button type="button" className="tx-btn tx-btn-lg is-pearl" onClick={onDone}>{t('完成')}</button>
      </div>
    )
  }

  return (
    <div className="tx-spot-form">
      <fieldset disabled={f.busy} className="tx-fieldset">
        {/* Pay */}
        <div className="tx-box-label">
          <span>{f.isBuy ? t('支付') : t('卖出')}</span>
          {connected && <button type="button" className="tx-avail" onClick={() => f.setPct(100)} title={t('全部')}>{t('可用 {amount} {symbol}', { amount: fmtAmount(f.payBalance), symbol: f.paySymbol })}</button>}
        </div>
        <div className={`tx-box ${hint ? 'is-bad' : ''}`}>
          <div className="tx-box-row">
            <input ref={amountInput} className="tx-box-input tx-num" type="number" min="0" step="any" inputMode="decimal" value={f.amount}
              onChange={(e) => f.setAmount(e.target.value)} placeholder="0" aria-label={f.isBuy ? t('支付数量') : t('卖出数量')} aria-invalid={!!hint || over} aria-describedby="tx-spot-hint" />
            {f.isBuy
              ? <button ref={payBtn} type="button" className="tx-asset is-pick" onClick={() => setPicking((v) => !v)} aria-expanded={picking} aria-haspopup="dialog" aria-label={t('选择支付资产')}>
                <TokenLogo src={payToken.logo} symbol={payToken.symbol} size={20} />
                <span className="tx-asset-t"><b>{payToken.symbol}</b><small>{chainName(payToken.chainId)}</small></span>
                <ChevronDown size={14} aria-hidden="true" />
              </button>
              : <span className="tx-asset"><TokenLogo src={payToken.logo} symbol={payToken.symbol} size={20} chain={token.chain} address={token.address} /><span className="tx-asset-t"><b>{payToken.symbol}</b><small>{chainName(token.chainId)}</small></span></span>}
          </div>
          <div className="tx-box-sub tx-num">{usd > 0 ? `≈ ${fmtMoney(usd)}` : '≈ $0.00'}</div>
        </div>
        <p id="tx-spot-hint" className="tx-hint" role="alert">{hint}</p>
        <div className="tx-pcts" role="group" aria-label={t('按余额比例')}>
          {[25, 50, 75, 100].map((p) => <button key={p} type="button" onClick={() => { if (!connected) { needWallet(); return } f.setPct(p) }} className={f.pct === p ? 'on' : ''}>{p === 100 ? t('全部') : `${p}%`}</button>)}
        </div>
      </fieldset>

      <div className="tx-swap-arrow" aria-hidden="true"><ArrowDown size={14} /></div>

      {/* Receive */}
      <div className="tx-box-label"><span>{t('获得（预计）')}</span></div>
      <div className="tx-box is-read">
        <div className="tx-box-row">
          <span className={`tx-box-out tx-num ${out === null ? 'mute' : ''}`} role="status">
            {f.quoting ? <LoaderCircle size={16} className="tx-spin-ic" aria-label={t('报价中')} /> : out !== null ? fmtAmount(out) : f.roughOut !== null ? `≈ ${fmtAmount(f.roughOut)}` : '0'}
          </span>
          <span className="tx-asset"><TokenLogo src={getToken.logo} symbol={getToken.symbol} size={20} chain={f.isBuy ? token.chain : undefined} address={f.isBuy ? token.address : undefined} /><span className="tx-asset-t"><b>{getToken.symbol}</b><small>{chainName(getToken.chainId)}</small></span></span>
        </div>
      </div>

      <dl className="tx-kv">
        <div><dt>{t('价格')}</dt><dd className="tx-num">{token.priceUsd > 0 ? `1 ${token.symbol} ≈ ${fmtUsd(token.priceUsd)}` : '--'}</dd></div>
        <div><dt>{t('滑点上限')}</dt><dd className="tx-num">{(f.slippageBps / 100).toFixed(2)}%</dd></div>
        {f.currentQuote && f.jupQuote && <>
          <div><dt>{t('价格影响')}</dt><dd className={`tx-num ${f.impact > 5 ? 'down' : f.impact > 1 ? 'warn' : ''}`}>{f.impact.toFixed(2)}%</dd></div>
          <div><dt>{t('最少获得')}</dt><dd className="tx-num">{fmtAmount(fromBaseUnits(f.jupQuote.otherAmountThreshold, f.receiveDecimals))} {f.receiveSymbol}</dd></div>
          {f.jupQuote.feeAccount && <div><dt>{t('手续费')}</dt><dd>{spotFeeLabel(f.fees, 'jupiter')}</dd></div>}
        </>}
        {f.currentQuote && f.summary && <>
          <div><dt>{t('手续费')}</dt><dd>{spotFeeLabel(f.fees, 'lifi')}</dd></div>
          {f.payBtc && <div><dt>{t('比特币到账')}</dt><dd>{t('约 10~30 分钟')}</dd></div>}
          <div><dt>{t('最少获得')}</dt><dd className="tx-num">{fmtAmount(fromBaseUnits(f.summary.toAmountMin, f.receiveDecimals))} {f.receiveSymbol}</dd></div>
          <div><dt>{t('预计耗时')}</dt><dd className="tx-num"><Clock size={11} aria-hidden="true" />{f.summary.seconds < 60 ? t('{n} 秒', { n: f.summary.seconds }) : t('{n} 分钟', { n: Math.ceil(f.summary.seconds / 60) })}</dd></div>
          <div><dt>{t('费用 + Gas')}</dt><dd className="tx-num">{fmtMoney(f.summary.feeUsd + f.summary.gasUsd)}</dd></div>
        </>}
      </dl>

      {(f.quoteErr || f.metadataError) && !hint && (
        <div className="tx-note warn" role="status">
          <span>{f.metadataError ? t('无法读取代币精度，暂不能交易') : f.quoteErr}</span>
          <button type="button" className="tx-icon-btn" disabled={f.busy} onClick={() => f.setRetry((v) => v + 1)} aria-label={t('重试报价')}><RefreshCw size={14} /></button>
        </div>
      )}
      {f.currentQuote && f.impact > 5 && <div className="tx-note down">{t('价格影响超过 5%，请减小金额。')}</div>}
      {f.gasProblems.map((p) => (
        <div key={p.chainId} className="tx-note warn" role="status">
          <FuelGauge level="low" size={16} className="text-muted" />
          <span>{describeProblem(p)}{p.refillable && f.autoRefuel ? t('，下单时会先自动补充') : ''}</span>
          {p.refillable && !f.autoRefuel && <button type="button" className="tx-link" disabled={f.refuel.busyChain === p.chainId} onClick={() => f.refuel.run(p.chainId, topUpUsd(p)).then(() => toast.success(t('已补充，几秒后到账'))).catch((e) => toast.error(errorText(e, t('补充失败'))))}>{f.refuel.busyChain === p.chainId ? t('补充中…') : t('从 BNB 补充')}</button>}
        </div>
      ))}

      <button type="button" className={`tx-btn tx-btn-lg tx-submit ${!connected ? 'is-pearl' : f.isBuy ? 'is-up' : 'is-down'}`} onClick={submit} aria-busy={f.busy || undefined} aria-describedby="tx-spot-hint">
        {f.busy ? <LoaderCircle size={16} className="tx-spin-ic" aria-hidden="true" /> : !connected ? <Wallet size={16} aria-hidden="true" /> : null}
        <span>{label}</span>
      </button>
      {!connected && <p className="tx-fine">{t('私钥只保存在 0x4 浏览器插件里，网页拿不到。')}</p>}

      <AssetPicker open={picking && !f.busy} anchor={payBtn} onClose={() => setPicking(false)} onSelect={(x) => f.selectPay(x)}
        onlyHoldings={f.holdings.length > 0} exclude={{ chainId: token.chainId, address: token.address, symbol: token.symbol, name: token.name, decimals: token.decimals ?? 18 }}
        current={f.payWith} />
    </div>
  )
}
