// Web top announcement strip (2026-10-01 goat: the FTC banner is removed — "keep this notice feature and wire it to the backend; web announcements will show here from now on").
// The content is the backend lord's "home announcements" (server/src/homeNotices.ts) — the same batch as the scrolling announcement beside the phone app's home logo:
// Only show announcements that are published, past their start time, and before their end time — pinned ones first. If no announcement is active, the whole strip hides.
// Multiple ones rotate every 6 seconds; tapping a title opens the full-text modal (the same NoticeDialog as the app, body rendered as plain text); the "×" on the right dismisses that one,
// Remembered locally (by announcement id) — an announcement that only changed its title won't pop again; new announcements show as usual. Re-pulled every 5 minutes while the page stays open.
// Palette uses only the web build's own dark and neutral colors (goat: the old FTC banner green clashed with the web background).
import { useEffect, useMemo, useState } from 'react'
import { Megaphone, X } from 'lucide-react'
import { NoticeDialog } from '@/components/HomeBrand'
import { CACHE_MS, loadHomeNotices, type HomeNotice } from '@/lib/homeNotices'
import { t } from '@/lib/i18n'

const HIDDEN_KEY = '0x4.desk.hiddenNotices'
const ROTATE_MS = 6000

function readHidden(): number[] {
  try { const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => Number.isInteger(x)) : [] } catch { return [] }
}
function saveHidden(ids: number[]) {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids.slice(-50))) } catch { /* Private mode can't write — just dismissed for this session */ }
}

export default function DeskNotices() {
  const [all, setAll] = useState<HomeNotice[]>([])
  const [hidden, setHidden] = useState<number[]>(() => readHidden())
  const [index, setIndex] = useState(0)
  const [open, setOpen] = useState<number | null>(null)

  // Pull once on entry, then every 5 minutes (a request is only really sent when the cache expires)
  useEffect(() => {
    let alive = true
    const pull = () => { void loadHomeNotices().then((l) => { if (alive) setAll(l) }) }
    pull()
    const id = window.setInterval(pull, CACHE_MS)
    return () => { alive = false; window.clearInterval(id) }
  }, [])

  const list = useMemo(() => all.filter((n) => !hidden.includes(n.id)), [all, hidden])
  const count = list.length
  const i = count ? index % count : 0
  const cur = list[i]

  // Multiple ones rotate; pause while the modal is open
  useEffect(() => {
    if (count < 2 || open !== null) return
    const id = window.setTimeout(() => setIndex((n) => (n + 1) % count), ROTATE_MS)
    return () => window.clearTimeout(id)
  }, [count, i, open])

  if (!cur) return null
  const dismiss = () => { const next = [...hidden, cur.id]; setHidden(next); saveHidden(next); setIndex(0) }
  return (
    <div className="desk-notice" role="region" aria-label={t('官方公告')}>
      <button type="button" className="desk-notice-main" onClick={() => setOpen(i)} aria-label={t('官方公告：{title}', { title: cur.title })}>
        <Megaphone size={14} strokeWidth={2} aria-hidden="true" className="desk-notice-icon" />
        <span key={cur.id} className="desk-notice-title">{cur.title}</span>
        {count > 1 && <span className="desk-notice-count number" aria-hidden="true">{i + 1}/{count}</span>}
      </button>
      <button type="button" className="desk-notice-close" onClick={dismiss} aria-label={t('收起这条公告')}><X size={14} strokeWidth={2} /></button>
      <NoticeDialog notices={list} index={open} onIndex={setOpen} />
    </div>
  )
}
