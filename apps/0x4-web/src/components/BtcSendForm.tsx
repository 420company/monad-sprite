// 发送比特币：地址校验（只认主网）、金额（可全部发送）、手续费三档、预估费用，签名后显示 txid 和确认进度
import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, ExternalLink } from 'lucide-react'
import Button from '@/components/Button'
import { Input, Label } from '@/components/Field'
import { toast } from '@/components/Toast'
import { alertError } from '@/components/AlertDialog'
import { BTC_CHAIN } from '@/lib/chains'
import { BtcPlanError, SATS, checkBtcAddress, formatBtc, parseBitcoinUri, parseBtc, shortBtc, type BtcSendPlan, type Utxo } from '@/lib/btc'
import { confirmations, getBtcUtxos, getFeeRates, getTipHeight, getTxStatus, type FeeRates } from '@/lib/btcApi'
import { planFor, sendBtc } from '@/lib/btcSend'
import { ensureUnlocked } from '@/lib/vault/gate'
import { copyText } from '@/lib/native'
import { fmtUsd } from '@/lib/format'
import { useWallet } from '@/store/wallet'
import { usePortfolio } from '@/store/portfolio'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'

type Speed = 'fast' | 'normal' | 'slow'
const SPEEDS: { id: Speed; label: string; eta: string }[] = [
  { id: 'fast', label: '快', eta: '约 10 分钟' },
  { id: 'normal', label: '标准', eta: '约 1 小时' },
  { id: 'slow', label: '省', eta: '约 1 天' },
]
/** 确认进度条按 6 次算满（交易所常用的门槛） */
const FULL_CONF = 6

export default function BtcSendForm({ priceUsd }: { priceUsd: number }) {
  const btcAddress = useWallet((s) => s.btcAddress)
  const [utxos, setUtxos] = useState<Utxo[] | null>(null)
  const [fees, setFees] = useState<FeeRates | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [max, setMax] = useState(false)
  const [speed, setSpeed] = useState<Speed>('normal')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<{ txid: string; plan: BtcSendPlan } | null>(null)

  useEffect(() => {
    if (!btcAddress) return
    let alive = true
    Promise.all([getBtcUtxos(btcAddress), getFeeRates()])
      .then(([u, f]) => { if (alive) { setUtxos(u); setFees(f) } })
      .catch((e) => { if (alive) setLoadErr(errorText(e, t('操作失败'))) })
    return () => { alive = false }
  }, [btcAddress])

  const balance = utxos ? utxos.reduce((s, u) => s + u.value, 0) : 0
  const dest = checkBtcAddress(to)
  const addrErr = !to ? null : dest.ok ? null : dest.reason === 'testnet' ? t('请输入比特币主网地址') : t('不是合法的比特币地址')

  let sats: bigint | null = null
  let amountErr: string | null = null
  if (!max && amount) {
    try { sats = parseBtc(amount) } catch (e) { amountErr = errorText(e, t('操作失败'))}
  }

  // 预估：地址对、金额填了、UTXO 和费率都到了才算
  const quote = useMemo(() => {
    if (!btcAddress || !utxos || !fees || !dest.ok || (!max && !sats)) return null
    try {
      return { plan: planFor({ from: btcAddress, to: dest.address, amount: max ? 'max' : sats!, feeRate: fees[speed], utxos }), err: null }
    } catch (e) {
      return { plan: null, err: e instanceof BtcPlanError || errorText(e, t('操作失败'))}
    }
  }, [btcAddress, utxos, fees, dest.ok, dest.ok ? dest.address : '', max, sats, speed]) // eslint-disable-line react-hooks/exhaustive-deps

  const setAll = () => { setMax(true); setAmount('') }
  const onAmount = (v: string) => { setMax(false); setAmount(v) }
  const onTo = (v: string) => {
    // 粘贴 / 扫出来的 bitcoin: 链接：拆出地址，带了金额就顺手填上
    const u = parseBitcoinUri(v)
    setTo(u.address.trim())
    if (u.amount && !amount) onAmount(u.amount)
  }

  const submit = async () => {
    if (!btcAddress || !quote?.plan || !dest.ok || !fees) return
    setBusy(true)
    try {
      // 「动钱才验证」：锁着先弹验证面板；验过之后签名器才可用
      await ensureUnlocked(t('确认发送比特币'))
      const signer = useWallet.getState().btc
      if (!signer) throw new Error(t('比特币密钥不可用，请锁定后重新解锁钱包'))
      const r = await sendBtc(signer, { from: btcAddress, to: dest.address, amount: max ? 'max' : sats!, feeRate: fees[speed], utxos: utxos! })
      setSent({ txid: r.txid, plan: r.plan })
      toast.success(t('已广播'))
      // 不关弹层：要留在这里看 txid 和确认进度；余额在后台刷新
      void usePortfolio.getState().refresh()
    } catch (e) {
      alertError(e, t('发送失败'))
    } finally {
      setBusy(false)
    }
  }

  if (!btcAddress) return <div className="py-6 text-center text-sm text-muted">{t('先在「收款 → Bitcoin」生成比特币地址')}</div>
  if (sent) return <Sent txid={sent.txid} plan={sent.plan} priceUsd={priceUsd} />

  const usd = (s: bigint) => (priceUsd > 0 ? fmtUsd((Number(s) / SATS) * priceUsd) : '')
  const plan = quote?.plan

  return (
    <div className="space-y-4">
      <div>
        <Label>{t('接收地址')}</Label>
        <Input value={to} onChange={(e) => onTo(e.target.value)} placeholder={t('比特币地址（bc1… / 1… / 3…）')} spellCheck={false} autoCapitalize="off" autoCorrect="off" />
        {addrErr && <div className="mt-1 text-xs text-down">{addrErr}</div>}
      </div>
      <div>
        <div className="flex items-center justify-between"><Label>{t('数量（BTC）')}</Label><span className="mb-1.5 text-xs text-muted">{utxos ? t('可用 {amount} BTC', { amount: formatBtc(balance) }) : loadErr ? '' : t('读取余额…')}</span></div>
        <div className="relative">
          <Input type="text" inputMode="decimal" value={max ? (plan ? formatBtc(plan.amount) : '') : amount} onChange={(e) => onAmount(e.target.value.trim())} placeholder={max ? t('全部') : '0.00000000'} />
          <button className={`absolute right-3 top-3 text-xs font-semibold ${max ? 'text-muted' : 'text-accent'}`} onClick={setAll}>{t('全部')}</button>
        </div>
        {amountErr && <div className="mt-1 text-xs text-down">{amountErr}</div>}
        {!amountErr && sats && priceUsd > 0 && <div className="mt-1 text-xs text-muted">≈ {usd(sats)}</div>}
      </div>
      <div>
        <Label>{t('手续费')}</Label>
        <div className="grid grid-cols-3 gap-2">
          {SPEEDS.map((s) => (
            <button key={s.id} onClick={() => setSpeed(s.id)} disabled={!fees} className={`rounded-xl px-2 py-2 text-center ${speed === s.id ? 'bg-accent text-bg' : 'bg-card2'}`}>
              <div className="text-sm font-semibold">{t(s.label)}</div>
              <div className={`mt-0.5 text-[11px] ${speed === s.id ? 'text-bg/70' : 'text-muted'}`}>{fees ? t('{n} sat/vB', { n: String(fees[s.id]) }) : '--'}</div>
              <div className={`text-[11px] ${speed === s.id ? 'text-bg/70' : 'text-muted'}`}>{t(s.eta)}</div>
            </button>
          ))}
        </div>
        {plan && (
          <div className="mt-2 text-xs text-muted">
            {t('预估手续费 {sat} sat', { sat: String(plan.fee) })}{priceUsd > 0 ? `（≈ ${usd(plan.fee)}）` : ''}
            {max && <span> · {t('对方收到 {amount} BTC', { amount: formatBtc(plan.amount) })}</span>}
          </div>
        )}
        {quote?.err && <div className="mt-1 text-xs text-down">{quote.err}</div>}
        {loadErr && <div className="mt-1 text-xs text-down">{t('比特币数据读取失败：{reason}', { reason: loadErr })}</div>}
      </div>
      <Button size="lg" className="w-full" disabled={!plan || busy} loading={busy} onClick={submit}>{t('确认发送')}</Button>
    </div>
  )
}

/** 广播之后：txid、浏览器链接、确认进度（每 20 秒查一次，满 6 次停） */
function Sent({ txid, plan, priceUsd }: { txid: string; plan: BtcSendPlan; priceUsd: number }) {
  const [conf, setConf] = useState(0)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    let alive = true
    let timer = 0
    const tick = async () => {
      try {
        const [st, tip] = await Promise.all([getTxStatus(txid), getTipHeight()])
        if (!alive) return
        const n = confirmations(st, tip)
        setConf(n)
        if (n >= FULL_CONF) return
      } catch { /* 刚广播时节点可能还没同步到，下一轮再查 */ }
      if (alive) timer = window.setTimeout(tick, 20_000)
    }
    void tick()
    return () => { alive = false; window.clearTimeout(timer) }
  }, [txid])
  const copy = () => copyText(txid).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) })
  return (
    <div className="space-y-4">
      <div className="glass-lite rounded-2xl px-4 py-4">
        <div className="text-sm font-semibold">{t('已发送 {amount} BTC', { amount: formatBtc(plan.amount) })}</div>
        <div className="mt-1 text-xs text-muted">{t('手续费 {sat} sat', { sat: String(plan.fee) })}{priceUsd > 0 ? `（≈ ${fmtUsd((Number(plan.fee) / SATS) * priceUsd)}）` : ''}</div>
        <button onClick={copy} className="mt-3 flex items-center gap-1.5 font-mono text-xs text-muted" aria-label={t('复制交易哈希')}>
          {shortBtc(txid)}{copied ? <Check size={13} className="text-accent" /> : <Copy size={13} />}
        </button>
      </div>
      <div>
        <div className="flex items-center justify-between text-xs"><span className="text-muted">{t('确认进度')}</span><span className="font-semibold">{conf === 0 ? t('等待打包') : t('{n}/{full} 次确认', { n: String(Math.min(conf, FULL_CONF)), full: String(FULL_CONF) })}</span></div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-card2"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(Math.min(conf, FULL_CONF) / FULL_CONF) * 100}%` }} /></div>
        {conf === 0 && <div className="mt-1.5 text-[11px] text-muted">{t('比特币约 10 分钟出一个块，手续费越低等待越久')}</div>}
      </div>
      <a href={BTC_CHAIN.explorerTx(txid)} target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-line bg-card2 text-sm font-semibold">
        <ExternalLink size={15} />{t('在区块浏览器查看')}
      </a>
    </div>
  )
}
