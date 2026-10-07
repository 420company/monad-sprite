// 快捷转账：从我的平台余额直接转给对方余额，秒到、免手续费（类似币安内部转账）
import { useState } from 'react'
import { Send } from 'lucide-react'
import Sheet from './Sheet'
import Button from './Button'
import Avatar from './Avatar'
import { Input, Label } from './Field'
import { toast } from './Toast'
import { TopupSheet, useGiftWallet } from './GiftSheet'
import { api } from '@/lib/social'
import { fmtUsd } from '@/lib/format'
import { displayName } from '@/store/social'
import { t } from '@/lib/i18n'
import UserName from './UserName'
import { errorText } from '@/lib/errors'

export default function TransferSheet({ open, onClose, to, context, onDone }: { open: boolean; onClose: () => void; to: { address: string; nickname?: string | null; avatar?: string | null }; context?: string; onDone?: (usd: number, note: string) => void }) {
  const { wallet, reload } = useGiftWallet()
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [topup, setTopup] = useState(false)
  const usd = Number(amount)
  const enough = !!wallet && wallet.balance >= usd
  const send = async () => {
    if (!(usd >= 0.1)) return toast.error(t('最少 $0.1'))
    if (!enough) return setTopup(true)
    setBusy(true)
    try {
      await api('/api/credits/transfer', { method: 'POST', body: JSON.stringify({ to: to.address, amount: usd, note: note.trim() || undefined, context }) })
      toast.success(t('已转 {amount} 给 {name}', { amount: fmtUsd(usd), name: displayName(to) })); onDone?.(usd, note.trim()); onClose()
    } catch (e) { const m = errorText(e, t('转账失败')); if (m.includes('余额不足')) setTopup(true); else toast.error(m) } finally { setBusy(false) }
  }
  return (
    <Sheet open={open} onClose={onClose} title={t('转账')}>
      <div className="flex items-center gap-3"><Avatar address={to.address} src={to.avatar} name={to.nickname} size={44} /><div><div className="font-semibold"><UserName address={to.address} name={displayName(to)} /></div><div className="text-xs text-muted">{t('从余额转出，即时到账，无手续费')}</div></div></div>
      <div className="mt-4"><Label>{t('金额（美元）')}</Label><Input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10" autoFocus /></div>
      <div className="mt-1 flex gap-2">{[1, 5, 10, 50].map((v) => <button key={v} onClick={() => setAmount(String(v))} className="flex-1 rounded-xl bg-card2 py-1.5 text-sm font-semibold">${v}</button>)}</div>
      <div className="mt-3"><Label>{t('留言（可选）')}</Label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('请你喝杯咖啡')} maxLength={50} /></div>
      <div className="mt-2 text-xs text-muted">{t('我的余额 {balance}', { balance: wallet ? fmtUsd(wallet.balance) : '--' })}{!enough && usd > 0 && <button onClick={() => setTopup(true)} className="ml-2 text-accent">{t('去充值')}</button>}</div>
      <Button size="lg" className="mt-4 w-full" loading={busy} disabled={!(usd >= 0.1)} onClick={send}><Send size={16} /> {enough || !usd ? t('转账 {amount}', { amount: usd ? fmtUsd(usd) : '' }) : t('余额不足，先充值')}</Button>
      <TopupSheet open={topup} onClose={() => { setTopup(false); reload() }} wallet={wallet} need={Math.max(0, usd - (wallet?.balance || 0))} />
    </Sheet>
  )
}
