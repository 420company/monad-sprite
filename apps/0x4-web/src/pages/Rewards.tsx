// Rewards (reserved): invite codes and points. Rules undecided — the UI puts the entry and data structures in place first
import { useEffect, useState } from 'react'
import { ArrowLeft, Copy, Gift } from 'lucide-react'
import Button from '@/components/Button'
import { Input, Label } from '@/components/Field'
import { toast } from '@/components/Toast'
import { api } from '@/lib/social'
import { copyText } from '@/lib/native'
import { t } from '@/lib/i18n'
import { useBack } from '@/lib/useBack'
import { errorText } from '@/lib/errors'

interface Me { enabled: boolean; code: string; inviter: string | null; invitees: number; points: number; ledger: { amount: number; reason: string; created_at: number }[] }

export default function Rewards() {
  // Back: return to the previous page when there is one (its state / scroll restored); opened directly from a push / deep link goes to /settings
  const back = useBack('/settings')
  const [me, setMe] = useState<Me | null>(null)
  const [code, setCode] = useState('')
  const load = () => api<Me>('/api/rewards/me').then(setMe).catch(() => {})
  useEffect(() => { load() }, [])
  const bind = async () => {
    try { await api('/api/rewards/bind', { method: 'POST', body: JSON.stringify({ code }) }); toast.success(t('已绑定邀请人')); setCode(''); load() } catch (e) { toast.error(errorText(e, t('绑定失败'))) }
  }
  return (
    <div className="safe-top px-4 pt-4">
      <div className="flex items-center gap-2"><button onClick={back} className="-ml-2 rounded-full p-2 text-muted"><ArrowLeft size={22} /></button><h1 className="text-2xl font-bold">{t('奖励')}</h1></div>
      <div className="mt-4 rounded-3xl bg-gradient-to-br from-social to-[#3b40b3] p-5 text-white">
        <div className="flex items-center gap-2 text-sm text-white/80"><Gift size={16} /> {t('我的积分')}</div>
        <div className="mt-1 text-4xl font-black">{me?.points ?? 0}</div>
        <div className="mt-1 text-xs text-white/70">{me?.enabled ? t('积分规则已启用') : t('奖励规则即将公布，邀请关系会先记录下来')}</div>
      </div>
      <div className="mt-4 rounded-2xl bg-card p-4">
        <Label>{t('我的邀请码')}</Label>
        <div className="flex items-center gap-2"><span className="flex-1 rounded-xl bg-card2 px-3 py-2 font-mono text-lg font-bold tracking-widest">{me?.code || '--'}</span><Button size="sm" variant="secondary" onClick={() => me && copyText(me.code).then(() => toast.success(t('已复制')))}><Copy size={14} /></Button></div>
        <div className="mt-2 text-xs text-muted">{t('已邀请 {n} 人', { n: me?.invitees ?? 0 })}</div>
      </div>
      {!me?.inviter && (
        <div className="mt-4 rounded-2xl bg-card p-4">
          <Label>{t('填写邀请码')}</Label>
          <div className="flex gap-2"><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={t('8 位邀请码')} maxLength={8} /><Button disabled={code.length < 8} onClick={bind}>{t('绑定')}</Button></div>
        </div>
      )}
      {me?.ledger.length ? <div className="mt-4"><h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t('积分记录')}</h2>{me.ledger.map((l, i) => <div key={i} className="flex justify-between py-1.5 text-sm"><span>{l.reason}</span><span>+{l.amount}</span></div>)}</div> : null}
    </div>
  )
}
