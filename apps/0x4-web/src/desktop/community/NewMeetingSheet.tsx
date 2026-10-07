// New-meeting sheet (split from MeetingsView on 2026-10-03: shared by the meetings page's "new meeting" and the stream header's "create stream → meeting").
// Options: meeting name, request-to-join / password / public meeting; enter the meeting right after creation.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Video } from 'lucide-react'
import Sheet from '@/components/Sheet'
import { toast } from '@/components/Toast'
import { api } from '@/lib/social'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'
import { useSocial, displayName } from '@/store/social'
import type { Meeting } from '@/meet/links'
import { accessBody, accessOk, DEFAULT_ACCESS, MeetAccessFields, type MeetAccess } from '@/meet/access'

export default function NewMeetingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate()
  const me = useSocial((s) => s.me)
  const [title, setTitle] = useState('')
  const [access, setAccess] = useState<MeetAccess>(DEFAULT_ACCESS)
  const [busy, setBusy] = useState(false)
  const myName = me ? displayName(me) : ''
  const create = async () => {
    if (busy || !accessOk(access)) return
    setBusy(true)
    try {
      const m = await api<Meeting>('/api/meet/meetings', { method: 'POST', body: JSON.stringify({ title: title.trim() || t('{name} 的会议', { name: myName }), ...accessBody(access) }) })
      onClose(); setTitle(''); setAccess(DEFAULT_ACCESS)
      nav(`/meet/${m.id}`)
    } catch (e) { toast.error(errorText(e, t('创建失败'))) } finally { setBusy(false) }
  }
  return (
    <Sheet open={open} center onClose={onClose} title={t('新建会议')} dismissible={!busy}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void create() }}>
        <label className="flex flex-col gap-2 text-[13px] text-muted">{t('会议名称')}
          <span className="wc-input"><input maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('{name} 的会议', { name: myName })} autoFocus /></span>
        </label>
        <MeetAccessFields value={access} onChange={setAccess} inputWrap={(input) => <span className="wc-input">{input}</span>} />
        <button type="submit" className="wc-btn is-primary is-lg is-block" disabled={busy || !accessOk(access)} aria-busy={busy}><Video size={16} />{busy ? t('正在创建') : t('创建并进入')}</button>
      </form>
    </Sheet>
  )
}
