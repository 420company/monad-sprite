// 网页版顶部公告条（2026-10-01 goat：FTC 横幅撤掉，「这个通知功能保留并且和后台连上，以后网页版的公告就在这里显示」）。
// 内容就是后台 lord「首页公告」（server/src/homeNotices.ts），和手机 App 首页 logo 旁边的滚动公告是同一批：
// 上架中、到了开始时间、没过结束时间的才显示，置顶在前。没有生效的公告就整条不出现。
// 多条时每 6 秒轮换一次；点标题打开全文弹窗（和 App 同一个 NoticeDialog，正文按纯文本显示）；右边「×」收起这一条，
// 记在本机（按公告 id），同一条公告改了标题也不会再冒出来，新公告照常显示。页面一直开着时每 5 分钟拉一次。
// 配色只用网页版自己的深色和中性色（goat：原来 FTC 横幅的绿色和网页背景不搭）。
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
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids.slice(-50))) } catch { /* 隐私模式写不进去，只是这次会话里收起 */ }
}

export default function DeskNotices() {
  const [all, setAll] = useState<HomeNotice[]>([])
  const [hidden, setHidden] = useState<number[]>(() => readHidden())
  const [index, setIndex] = useState(0)
  const [open, setOpen] = useState<number | null>(null)

  // 进来拉一次，之后每 5 分钟拉一次（缓存过期才真的发请求）
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

  // 多条轮换；弹窗开着时停住
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
