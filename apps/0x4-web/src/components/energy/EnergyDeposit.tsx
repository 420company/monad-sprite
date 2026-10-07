// 充值能量（网页版）：BNB Chain 的 USDT 充进打赏合约，1 USDT = 1 能量，只收整数。
// 0x4 Wallet 和其他钱包都能充（普通的授权 + 合约调用，钱包里确认）。停止充值 / 暂停时按钮不可用并说明原因。
// 充进去的能量只能用来送礼，不能转给别人、不能退、不能提现（充值前写清楚）。
import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import Sheet from '@/components/Sheet'
import Button from '@/components/Button'
import { Input } from '@/components/Field'
import { toast } from '@/components/Toast'
import { depositEnergy, energyNum, usdtOf, useEnergy } from '@/lib/energy'
import { cleanDepositInput, DEPOSIT_QUICK, depositClosedReason, depositTxUrl, parseDepositAmount } from '@/lib/energyDepositCore'
import { errorText } from '@/lib/errors'
import { t } from '@/lib/i18n'
import { useWallet } from '@/store/wallet'
import energyIcon from './energy.webp'

// 数量规则、快捷数量、关着的原因和电脑端会议共用 lib/energyDepositCore.ts
const QUICK = DEPOSIT_QUICK
const explorerTx = depositTxUrl

export default function EnergyDeposit({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { evmAccount } = useWallet()
  const me = useEnergy((s) => s.me)
  const refresh = useEnergy((s) => s.refresh)
  const [amount, setAmount] = useState('')
  const [usdt, setUsdt] = useState<number | null>(null)
  const [step, setStep] = useState<'idle' | 'approving' | 'depositing'>('idle')
  const [hash, setHash] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setHash(null); setStep('idle')
    void refresh().then((m) => { if (m?.enabled && evmAccount) void usdtOf(m, evmAccount.address).then(setUsdt) })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = parseDepositAmount(amount)
  const n = parsed ?? 0
  const valid = parsed !== null
  const closed = depositClosedReason(me)
  const closedText = closed ? t(closed) : null
  const over = usdt !== null && valid && n > usdt

  const submit = async () => {
    if (!evmAccount || !me || !valid) return
    setStep('depositing')
    try {
      const h = await depositEnergy(evmAccount, me, n, () => setStep('approving'))
      setHash(h)
      setAmount('')
      toast.success(t('充值成功，能量约 1 分钟内到账'))
      // 服务器读到链上充值后会推送新余额；这里再主动刷一次，防止推送晚到
      setTimeout(() => void refresh(), 15_000)
      void usdtOf(me, evmAccount.address).then(setUsdt)
    } catch (e) { const m = errorText(e, t('充值失败')); if (m) toast.error(m) } finally { setStep('idle') }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('充值能量')}>
      <div className="flex flex-col gap-4 pb-2" data-testid="energy-deposit">
        <div className="flex items-center gap-3 rounded-2xl bg-card2 px-4 py-3">
          <img src={energyIcon} alt="" className="h-10 w-10 shrink-0" draggable={false} />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">{t('当前能量')}</p>
            <p className="number text-xl font-semibold" data-testid="energy-balance">{energyNum(me?.available).toLocaleString()}</p>
          </div>
          <div className="text-right text-xs text-muted">{t('1 USDT = 1 能量')}</div>
        </div>

        {closedText ? <p className="rounded-xl bg-warning/10 px-3 py-2.5 text-sm text-warning" role="status">{closedText}</p> : <>
          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-xs text-muted">
              <span>{t('充值数量（USDT，只能是整数）')}</span>
              {usdt !== null && <span>{t('钱包可用 {n} USDT', { n: usdt.toLocaleString(undefined, { maximumFractionDigits: 2 }) })}</span>}
            </div>
            <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(cleanDepositInput(e.target.value))} placeholder={t('输入整数，比如 100')} aria-label={t('充值数量')} data-testid="energy-amount" className="number text-lg" />
            <div className="mt-2 flex gap-2">
              {QUICK.map((q) => <button key={q} type="button" onClick={() => setAmount(String(q))} className={`chip-btn flex-1 rounded-xl border px-2 py-1.5 text-sm ${amount === String(q) ? 'border-accent text-accent' : 'border-line text-muted'}`}>{q}</button>)}
            </div>
            {over && <p className="mt-2 text-xs text-down">{t('BNB Chain 上的 USDT 不够')}</p>}
          </div>
          <Button size="lg" className="w-full" disabled={!evmAccount || !valid || over} loading={step !== 'idle'} onClick={() => void submit()} data-testid="energy-deposit-submit">
            {step === 'approving' ? t('正在授权 USDT') : t('充值 {n} 能量', { n: valid ? n.toLocaleString() : '' })}
          </Button>
        </>}

        {hash && (
          <p className="flex items-center justify-center gap-1 text-xs text-muted" role="status">
            {t('已提交，等待链上确认')}
            {explorerTx(me?.chainId, hash) && <a href={explorerTx(me?.chainId, hash)!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent">{t('查看交易')}<ExternalLink size={12} /></a>}
          </p>
        )}
        <ul className="space-y-1 text-xs leading-relaxed text-muted">
          <li>{t('能量只能用来送礼，不能转给别人，也不能退回或提现。')}</li>
          <li>{t('充值走 BNB Chain 的 USDT，需要少量 BNB 付燃料费。')}</li>
        </ul>
      </div>
    </Sheet>
  )
}
