// 举报弹层（2026-10-02 goat，上架要求）：全站只有一个，挂在 App 里；任何地方调 lib/safety 的 openReport() 打开。
// 选原因、可以补一句说明、可以顺手把对方拉黑。举报存成客服工单，客服能看到被举报的原文。
import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import Sheet from '@/components/Sheet'
import Button from '@/components/Button'
import { toast } from '@/components/Toast'
import { REPORT_REASONS, submitReport, useBlocks, useReport, type ReportKind, type ReportReason } from '@/lib/safety'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'

const titleOf = (kind: ReportKind) => ({ post: t('举报这条动态'), comment: t('举报这条评论'), user: t('举报这个用户'), room: t('举报这场直播'), meeting: t('举报这场会议'), dm: t('举报这个私信对象'), group_message: t('举报这条群消息') })[kind]

export default function ReportSheet() {
  const target = useReport((s) => s.target)
  const close = useReport((s) => s.close)
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [text, setText] = useState('')
  const [block, setBlock] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (target) { setReason(null); setText(''); setBlock(false) } }, [target])

  const submit = async () => {
    if (!target || !reason || busy) return
    setBusy(true)
    try {
      const r = await submitReport(target, reason, text, block)
      if (r.blocked) void useBlocks.getState().load()
      toast.success(r.blocked ? t('已举报并拉黑，客服会尽快处理') : t('已举报，客服会尽快处理'))
      close()
    } catch (e) { toast.error(errorText(e, t('举报失败'))) } finally { setBusy(false) }
  }

  return (
    <Sheet open={!!target} onClose={close} title={target ? titleOf(target.kind) : t('举报')} dismissible={!busy}>
      <p className="text-sm text-muted">{target?.kind === 'dm' ? t('私信是加密的，客服看不到聊天内容。请在下面写清楚对方做了什么。') : t('选一个原因。客服会看到被举报的内容，核实后处理。')}</p>
      <div className="mt-4 divide-y divide-line/60 border-y border-line/60" role="radiogroup" aria-label={t('举报原因')}>
        {REPORT_REASONS.map((r) => (
          <button key={r.key} type="button" role="radio" aria-checked={reason === r.key} onClick={() => setReason(r.key)} className="flex min-h-12 w-full items-center justify-between gap-3 py-2.5 text-left text-[15px] active:bg-card">
            <span>{t(r.label)}</span>
            {reason === r.key && <Check size={18} className="shrink-0 text-accent" aria-hidden="true" />}
          </button>
        ))}
      </div>
      <label className="mt-4 block">
        <span className="ui-label">{t('补充说明（选填）')}</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={3} className="ui-field mt-1 w-full resize-none" placeholder={t('发生了什么')} />
      </label>
      {target?.kind !== 'meeting' && (
        <label className="mt-3 flex min-h-11 items-center gap-2.5 text-sm">
          <input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
          <span>{t('同时拉黑对方：互相看不到动态和评论，对方不能再给我发私信')}</span>
        </label>
      )}
      <Button className="mt-5 w-full" size="lg" variant="danger" disabled={!reason} loading={busy} onClick={() => void submit()}>{t('提交举报')}</Button>
    </Sheet>
  )
}
