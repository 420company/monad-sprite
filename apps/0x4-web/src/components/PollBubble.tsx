// 群内投票气泡与发起投票弹层
import { useState } from 'react'
import { ChartBar, Plus, X } from 'lucide-react'
import Sheet from './Sheet'
import Button from './Button'
import { Input, Label } from './Field'
import { toast } from './Toast'
import { api } from '@/lib/social'
import { locale, t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'

export interface PollInfo { id: string; question: string; options: { text: string; votes: number }[]; total: number; endsAt: number | null; myVote: number | null }

export function PollBubble({ poll, onUpdate }: { poll: PollInfo; onUpdate: (p: PollInfo) => void }) {
  const [busy, setBusy] = useState(false)
  const ended = !!poll.endsAt && poll.endsAt < Date.now()
  const vote = async (i: number) => {
    setBusy(true)
    try { onUpdate(await api<PollInfo>(`/api/polls/${poll.id}/vote`, { method: 'POST', body: JSON.stringify({ option: i }) })) } catch (e) { toast.error(errorText(e, t('投票失败'))) } finally { setBusy(false) }
  }
  return (
    <div className="my-2 w-[280px] rounded-2xl bg-card p-3">
      <div className="mb-2 flex items-start gap-1.5 text-sm font-semibold"><ChartBar size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" /><span className="min-w-0">{poll.question}</span></div>
      {poll.options.map((o, i) => {
        const pct = poll.total ? Math.round((o.votes / poll.total) * 100) : 0
        const chosen = poll.myVote === i
        return (
          <button key={i} disabled={busy || ended} onClick={() => vote(i)} className={`relative mb-1.5 w-full overflow-hidden rounded-xl border px-3 py-2 text-left text-sm ${chosen ? 'border-accent' : 'border-line'}`}>
            <span className="absolute inset-y-0 left-0 bg-accent/15" style={{ width: `${pct}%` }} />
            <span className="relative flex justify-between"><span>{o.text}</span><span className="text-xs text-muted">{o.votes} · {pct}%</span></span>
          </button>
        )
      })}
      <div className="text-[11px] text-muted">{t('{n} 人投票', { n: poll.total })}{ended ? t(' · 已结束') : poll.endsAt ? t(' · {time} 截止', { time: new Date(poll.endsAt).toLocaleString(locale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }) : ''}</div>
    </div>
  )
}

export function PollSheet({ open, onClose, groupId }: { open: boolean; onClose: () => void; groupId: string }) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [hours, setHours] = useState('24')
  const [busy, setBusy] = useState(false)
  const valid = question.trim() && options.filter((o) => o.trim()).length >= 2
  const submit = async () => {
    setBusy(true)
    try {
      await api(`/api/groups/${groupId}/polls`, { method: 'POST', body: JSON.stringify({ question, options: options.filter((o) => o.trim()), hours: Number(hours) || undefined }) })
      toast.success(t('投票已发起')); onClose(); setQuestion(''); setOptions(['', ''])
    } catch (e) { toast.error(errorText(e, t('发起失败'))) } finally { setBusy(false) }
  }
  return (
    <Sheet open={open} onClose={onClose} title={t('发起投票')}>
      <div className="space-y-3">
        <div><Label>{t('问题')}</Label><Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t('今晚冲哪个？')} maxLength={200} /></div>
        <Label>{t('选项')}</Label>
        {options.map((o, i) => (
          <div key={i} className="flex gap-2">
            <Input value={o} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} placeholder={t('选项 {n}', { n: i + 1 })} maxLength={60} />
            {options.length > 2 && <button onClick={() => setOptions(options.filter((_, j) => j !== i))} className="text-muted"><X size={18} /></button>}
          </div>
        ))}
        {options.length < 8 && <button onClick={() => setOptions([...options, ''])} className="flex items-center gap-1 text-sm text-accent"><Plus size={14} /> {t('加一个选项')}</button>}
        <div><Label>{t('持续时间（小时，留空不限）')}</Label><Input type="number" value={hours} onChange={(e) => setHours(e.target.value)} /></div>
        <Button size="lg" className="w-full" disabled={!valid} loading={busy} onClick={submit}>{t('发起')}</Button>
      </div>
    </Sheet>
  )
}
