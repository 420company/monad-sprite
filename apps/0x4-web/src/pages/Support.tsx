// Contact support ("Me → Help → Contact support"): my ticket list, new ticket, ticket thread page.
// Support replies from the lord.420.meme admin; replies go through the notification center + system push, opening straight into this thread page (ref = ticket:<id>).
// Images via the existing /api/upload (compressed locally first), max 3 per message.
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Headset, Image as ImageIcon, LoaderCircle, Plus, RefreshCw, Send, X } from 'lucide-react'
import Button from '@/components/Button'
import Sheet from '@/components/Sheet'
import PostImages from '@/components/PostImages'
import { Input, Label, Textarea } from '@/components/Field'
import { toast } from '@/components/Toast'
import { api, SOCIAL_API } from '@/lib/social'
import { compressForUpload } from '@/lib/imageCompress'
import { absUrl, thumbOf, type PostImage } from '@/lib/postImage'
import { timeAgo } from '@/lib/format'
import { useSocial } from '@/store/social'
import { t } from '@/lib/i18n'
import { useBack } from '@/lib/useBack'
import { errorText } from '@/lib/errors'

export type TicketStatus = 'open' | 'pending' | 'resolved' | 'closed'
export interface Ticket { id: string; category: string; title: string; status: TicketStatus; unread: number; createdAt: number; updatedAt: number; lastText?: string | null }
interface TicketMessage { id: number; fromStaff: boolean; text: string; images: PostImage[]; createdAt: number }

export const CATEGORIES: [string, string][] = [['account', '账户'], ['funds', '充值提现'], ['trade', '交易'], ['report', '举报'], ['other', '其他']]
/** New-ticket categories (2026-09-29 goat: keep only account, report, other). CATEGORIES keeps all; old tickets' categories still display */
const NEW_TICKET_CATEGORIES = CATEGORIES.filter(([k]) => k === 'account' || k === 'report' || k === 'other')
export const categoryLabel = (c: string) => t(CATEGORIES.find(([k]) => k === c)?.[1] ?? '其他')
const STATUS_LABEL: Record<TicketStatus, string> = { open: '待客服处理', pending: '客服已回复', resolved: '已解决', closed: '已关闭' }
const statusTone = (s: TicketStatus) => (s === 'pending' ? 'text-accent' : s === 'open' ? 'text-warning' : 'text-muted')
const MAX_IMAGES = 3

function Header({ title, onBack, action }: { title: string; onBack: () => void; action?: React.ReactNode }) {
  return <header className="page-header page-gutter">
    <div className="flex min-w-0 items-center gap-1"><button onClick={onBack} className="icon-button -ml-2" aria-label={t('返回')}><ArrowLeft size={22} /></button><h1 className="truncate text-xl font-bold">{title}</h1></div>
    {action}
  </header>
}

/** Pick + upload images (max 3), same compression as posting */
function useImagePicker() {
  const [images, setImages] = useState<PostImage[]>([])
  const [uploading, setUploading] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const pick = async (list: FileList | null) => {
    const files = [...(list || [])].slice(0, MAX_IMAGES - images.length)
    if (!files.length || uploading) return
    if (files.some((f) => !f.type.startsWith('image/'))) return toast.error(t('请选择图片文件'))
    setUploading(true)
    try {
      for (const f of files) {
        const fd = new FormData(); fd.append('file', await compressForUpload(f))
        const r = await api<{ url: string; thumb?: string; width?: number; height?: number }>('/api/upload', { method: 'POST', body: fd })
        setImages((cur) => (cur.length >= MAX_IMAGES ? cur : [...cur, { url: r.url, thumb: r.thumb, w: r.width, h: r.height }]))
      }
    } catch (e) { toast.error(errorText(e, t('上传失败'))) } finally { setUploading(false) }
  }
  const field = <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { void pick(e.target.files); e.target.value = '' }} />
  const thumbs = images.length > 0 && <div className="flex flex-wrap gap-2">{images.map((img, i) => (
    <div key={img.url + i} className="relative h-16 w-16"><img src={absUrl(thumbOf(img), SOCIAL_API)} alt={t('待发送图片')} className="h-full w-full rounded-lg bg-card object-cover" />
      <button type="button" onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-bg text-fg shadow" aria-label={t('移除图片')}><X size={14} /></button></div>
  ))}</div>
  return { images, setImages, uploading, open: () => input.current?.click(), field, thumbs, full: images.length >= MAX_IMAGES }
}

export default function Support() {
  const nav = useNavigate()
  // Back: return to the previous page when there is one (its state/scroll restored); push / deep-link opens go to /settings
  const back = useBack('/settings')
  const status = useSocial((s) => s.status)
  const [list, setList] = useState<Ticket[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (status !== 'ready') return
    let alive = true
    setFailed(false)
    api<Ticket[]>('/api/tickets').then((l) => { if (alive) setList(l) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [status, retry])

  return (
    <div className="pb-10">
      <Header title={t('联系客服')} onBack={back} action={<button onClick={() => setCreating(true)} disabled={status !== 'ready'} className="icon-button" aria-label={t('新建工单')} data-tooltip={t('新建工单')}><Plus size={21} /></button>} />
      <div className="page-gutter">
        <p className="text-sm text-muted">{t('如果您遇到任何疑问，请联系我们。')}</p>
        <Button className="mt-4 w-full" disabled={status !== 'ready'} onClick={() => setCreating(true)}><Plus size={17} />{t('新建工单')}</Button>
        <h2 className="section-title mt-7">{t('我的工单')}</h2>
        {status !== 'ready' ? <p className="py-6 text-center text-sm text-muted">{t('连接社交服务后可以联系客服')}</p>
          : failed && !list ? <div className="status-notice mt-2" role="status"><span className="flex-1">{t('暂时无法加载')}</span><button className="icon-button" onClick={() => setRetry((n) => n + 1)} aria-label={t('重试')}><RefreshCw size={18} /></button></div>
          : !list ? <div className="mt-2 space-y-2"><div className="skeleton h-16" /><div className="skeleton h-16" /></div>
          : !list.length ? <div className="empty-state" role="status"><Headset size={24} strokeWidth={1.5} /><p className="text-sm text-muted">{t('还没有工单')}</p></div>
          : <div className="mt-1 divide-y divide-line/60 border-y border-line/60">{list.map((tk) => (
            <button key={tk.id} onClick={() => nav(`/support/${tk.id}`)} className="flex w-full items-start gap-3 py-3.5 text-left">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="truncate text-[15px] font-semibold">{tk.title}</span>{tk.unread > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label={t('有新回复')} />}</div>
                <div className="mt-1 truncate text-[13px] text-muted">{categoryLabel(tk.category)} · {tk.lastText || ''}</div>
              </div>
              <div className="shrink-0 text-right"><div className={`text-xs font-medium ${statusTone(tk.status)}`}>{t(STATUS_LABEL[tk.status])}</div><div className="mt-1 text-[11px] text-muted">{timeAgo(tk.updatedAt)}</div></div>
            </button>
          ))}</div>}
      </div>
      <NewTicketSheet open={creating} onClose={() => setCreating(false)} onCreated={(tk) => { setCreating(false); nav(`/support/${tk.id}`) }} />
    </div>
  )
}

function NewTicketSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (t: Ticket) => void }) {
  const [category, setCategory] = useState('')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const pics = useImagePicker()
  const ready = !!category && !!title.trim() && !!text.trim() && !pics.uploading
  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    try {
      const tk = await api<Ticket>('/api/tickets', { method: 'POST', body: JSON.stringify({ category, title, text, images: pics.images }) })
      setCategory(''); setTitle(''); setText(''); pics.setImages([])
      toast.success(t('已提交，客服回复后会通知你'))
      onCreated(tk)
    } catch (e) { toast.error(errorText(e, t('提交失败'))) } finally { setBusy(false) }
  }
  return (
    <Sheet open={open} onClose={onClose} title={t('新建工单')} dismissible={!busy}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <div>
          <Label>{t('问题分类')}</Label>
          <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label={t('问题分类')}>
            {NEW_TICKET_CATEGORIES.map(([k, l]) => <button type="button" key={k} role="radio" aria-checked={category === k} onClick={() => setCategory(k)} className={`min-h-10 rounded-full px-4 text-sm ${category === k ? 'bg-accent font-semibold text-bg' : 'bg-card2 text-fg'}`}>{t(l)}</button>)}
          </div>
        </div>
        <div><Label htmlFor="ticket-title">{t('标题')}</Label><Input id="ticket-title" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder={t('一句话说明问题')} /></div>
        <div><Label htmlFor="ticket-text">{t('描述')}</Label><Textarea id="ticket-text" value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} placeholder={t('请描述发生了什么？什么时候？您遇到的问题？')} /></div>
        <div className="space-y-2">
          {pics.thumbs}
          <button type="button" onClick={pics.open} disabled={pics.full || pics.uploading} className="text-action">{pics.uploading ? <LoaderCircle size={15} className="animate-spin" /> : <ImageIcon size={15} />}{t('添加截图（最多 {n} 张）', { n: MAX_IMAGES })}</button>
          {pics.field}
        </div>
        <p className="text-xs text-muted">{t('客服不会向你索要助记词或私钥，也不会让你转账到任何地址。')}</p>
        <Button type="submit" className="w-full" loading={busy} disabled={!ready}>{t('提交')}</Button>
      </form>
    </Sheet>
  )
}

export function SupportTicket() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const status = useSocial((s) => s.status)
  const [data, setData] = useState<(Ticket & { messages: TicketMessage[] }) | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading')
  const [retry, setRetry] = useState(0)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const pics = useImagePicker()
  const back = () => ((window.history.state as { idx?: number } | null)?.idx ? nav(-1) : nav('/support'))

  useEffect(() => {
    if (status !== 'ready') return
    let alive = true
    api<Ticket & { messages: TicketMessage[] }>(`/api/tickets/${encodeURIComponent(id)}`)
      .then((d) => { if (alive) { setData(d); setState('ok') } })
      .catch((e) => { if (alive) setState((e as { status?: number }).status === 404 ? 'missing' : 'error') })
    return () => { alive = false }
  }, [id, status, retry])

  const send = async () => {
    if (busy || pics.uploading || (!text.trim() && !pics.images.length)) return
    setBusy(true)
    try {
      const m = await api<TicketMessage>(`/api/tickets/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify({ text, images: pics.images }) })
      setData((d) => d && { ...d, status: 'open', messages: [...d.messages, m] })
      setText(''); pics.setImages([])
    } catch (e) { toast.error(errorText(e, t('发送失败'))) } finally { setBusy(false) }
  }
  const close = async () => {
    if (!data || !confirm(t('关闭这个工单？关闭后不能再回复，有新问题可以新建。'))) return
    try { await api(`/api/tickets/${encodeURIComponent(id)}/close`, { method: 'POST' }); setData({ ...data, status: 'closed' }) } catch (e) { toast.error(errorText(e, t('操作失败'))) }
  }
  const closed = data?.status === 'closed'

  return (
    <div className="flex min-h-full flex-col pb-4">
      <Header title={data?.title || t('工单')} onBack={back} action={data && !closed ? <Button size="sm" variant="secondary" onClick={() => void close()}>{t('关闭工单')}</Button> : undefined} />
      {state === 'loading' && <div className="page-gutter space-y-3"><div className="skeleton h-16" /><div className="skeleton h-24" /></div>}
      {state === 'missing' && <div className="empty-state"><p className="text-sm text-muted">{t('工单不存在')}</p></div>}
      {state === 'error' && <div className="page-gutter status-notice"><span className="flex-1">{t('暂时无法加载')}</span><button className="icon-button" onClick={() => setRetry((n) => n + 1)} aria-label={t('重试')}><RefreshCw size={18} /></button></div>}
      {data && <>
        <div className="page-gutter text-xs text-muted">{categoryLabel(data.category)} · <span className={statusTone(data.status)}>{t(STATUS_LABEL[data.status])}</span> · {t('提交于 {time}', { time: timeAgo(data.createdAt) })}</div>
        <div className="page-gutter mt-4 flex-1 space-y-3">
          {data.messages.map((m) => (
            <div key={m.id} className={`flex ${m.fromStaff ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${m.fromStaff ? 'bg-card2' : 'bg-accent/15'}`}>
                {m.fromStaff && <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-accent"><Headset size={12} />{t('0x4 客服')}</div>}
                {m.text && <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{m.text}</p>}
                {m.images.length > 0 && <PostImages images={m.images} className={m.text ? 'mt-2' : ''} />}
                <div className="mt-1 text-right text-[10px] text-muted">{timeAgo(m.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>
        {closed ? <p className="page-gutter mt-6 text-center text-sm text-muted">{t('工单已关闭，有新问题请新建工单')}</p> : (
          <form className="page-gutter mt-5 space-y-2" onSubmit={(e) => { e.preventDefault(); void send() }}>
            {pics.thumbs}
            <div className="flex items-end gap-2">
              <button type="button" onClick={pics.open} disabled={pics.full || pics.uploading} className="icon-button" aria-label={t('添加图片')}>{pics.uploading ? <LoaderCircle size={20} className="animate-spin" /> : <ImageIcon size={20} />}</button>
              {pics.field}
              <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} rows={1} className="!min-h-11 flex-1" placeholder={t('补充说明…')} aria-label={t('回复内容')} />
              <button type="submit" disabled={busy || (!text.trim() && !pics.images.length)} className="icon-button text-accent disabled:opacity-40" aria-label={t('发送')}>{busy ? <LoaderCircle size={20} className="animate-spin" /> : <Send size={20} />}</button>
            </div>
          </form>
        )}
      </>}
    </div>
  )
}
