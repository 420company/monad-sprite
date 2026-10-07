// Home top bar, left: cat logo + official scrolling announcements (2026-09-29 goat: the "0x4" text that used to sit right of the logo becomes the scrolling announcement).
// With no active announcement (or not yet pulled / pull failed), still show "0x4".
// With announcements, show only the title: multiple ones rotate; a title longer than the strip pauses first, then scrolls smoothly to the end; with the OS "reduce motion" on, no scrolling — switch one by one, truncating long ones with an ellipsis.
// Tap to open a centered modal with the full text (body rendered as plain text, line breaks preserved, never as HTML); multiple ones can be flipped through inside the modal.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { ChevronLeft, ChevronRight, Megaphone } from 'lucide-react'
import Sheet from './Sheet'
import { useHomeNotices, type HomeNotice } from '@/lib/homeNotices'
import { locale, t } from '@/lib/i18n'

/** Minimum dwell per item; when a title needs scrolling: pause 1.2s first, scroll to the end at 36 px/s, pause 1.6s */
const HOLD_MS = 4200
const LEAD_MS = 1200
const TAIL_MS = 1600
const SPEED = 36

function reducedMotion(): boolean {
  try { return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

export default function HomeBrand() {
  const notices = useHomeNotices()
  return <HomeBrandView notices={notices} />
}

export function HomeBrandView({ notices }: { notices: HomeNotice[] }) {
  return (
    <div className="home-brand">
      <img src={`${import.meta.env.BASE_URL}icons/cat.svg`} alt="" width={34} height={34} className="shrink-0" />
      {notices.length
        ? <><h1 className="sr-only">0x4</h1><NoticeTicker notices={notices} /></>
        : <BrandWordmark />}
    </div>
  )
}

/**
 * The "0x4" wordmark shown when there's no announcement (2026-09-29 goat: regular fonts look too plain — pixel font feels more web3).
 * Pixelify Sans 600 (bundled in the app); the 0 on screen is this font's built-in pixel "Ø",
 * echoing the slashed 0 on the cat-head logo. Screen readers hear "0x4" (aria-label); the drawn glyphs stay out of the reader.
 */
export function BrandWordmark() {
  return <h1 className="brand-wordmark" aria-label="0x4"><span aria-hidden="true">Øx4</span></h1>
}

export function NoticeTicker({ notices }: { notices: HomeNotice[] }) {
  const [index, setIndex] = useState(0)
  const [open, setOpen] = useState<number | null>(null)
  const [scroll, setScroll] = useState(0)          // How far the current item needs to scroll (pixels); 0 = fits
  const view = useRef<HTMLSpanElement>(null)
  const text = useRef<HTMLSpanElement>(null)
  const reduce = useRef(reducedMotion())
  const count = notices.length
  const i = count ? index % count : 0
  const cur = notices[i]

  // The announcement list changed (e.g. one was taken down): an out-of-range index restarts from the top
  useEffect(() => { if (index >= count) setIndex(0) }, [index, count])

  // Measure whether the title overflows the strip
  const measure = useCallback(() => {
    const v = view.current, s = text.current
    if (!v || !s) return
    const over = Math.ceil(s.scrollWidth - v.clientWidth)
    setScroll(!reduce.current && over > 2 ? over : 0)
  }, [])
  useLayoutEffect(() => { measure() }, [measure, i, cur?.title])
  useEffect(() => {
    const v = view.current
    if (!v || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure())
    ro.observe(v)
    return () => ro.disconnect()
  }, [measure])

  // Carousel: no switching with only one item; pause while the modal is open
  useEffect(() => {
    if (count < 2 || open !== null) return
    const stay = scroll ? LEAD_MS + (scroll / SPEED) * 1000 + TAIL_MS : HOLD_MS
    const timer = setTimeout(() => setIndex((n) => (n + 1) % count), Math.max(HOLD_MS, stay))
    return () => clearTimeout(timer)
  }, [count, i, scroll, open])

  if (!cur) return null
  const style = scroll ? { '--notice-dist': `-${scroll}px`, '--notice-dur': `${(scroll / SPEED).toFixed(2)}s`, '--notice-lead': `${LEAD_MS}ms` } as CSSProperties : undefined
  return (
    <>
      <button type="button" className="notice-ticker" onClick={() => setOpen(i)}
        aria-label={t('官方公告：{title}', { title: cur.title })} data-tooltip={t('查看公告')}>
        <span className="notice-ticker-icon" aria-hidden="true"><Megaphone size={12} strokeWidth={2.3} /></span>
        <span ref={view} className="notice-ticker-view" data-overflow={scroll > 0 || undefined} aria-hidden="true">
          <span key={`${cur.id}-${i}`} ref={text} className={`notice-ticker-text${scroll ? ' is-scrolling' : ''}`} style={style}>{cur.title}</span>
        </span>
      </button>
      <NoticeDialog notices={notices} index={open} onIndex={setOpen} />
    </>
  )
}

/** Full-announcement modal; closed when index is null */
export function NoticeDialog({ notices, index, onIndex }: { notices: HomeNotice[]; index: number | null; onIndex: (i: number | null) => void }) {
  const count = notices.length
  const n = index === null ? null : notices[Math.min(index, count - 1)]
  const at = n ? new Date(n.publishedAt) : null
  return (
    <Sheet open={n !== null} onClose={() => onIndex(null)} title={t('官方公告')} center>
      {n && at && <article className="notice-article">
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <span className="notice-chip"><Megaphone size={11} strokeWidth={2.4} />{t('0x4 官方')}</span>
          {n.pinned && <span className="notice-chip notice-chip-pin">{t('已置顶')}</span>}
          <time dateTime={at.toISOString()} className="number ml-auto">{at.toLocaleString(locale(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
        </div>
        <h3 className="mt-3 break-words text-[17px] font-semibold leading-snug">{n.title}</h3>
        <div className="notice-body mt-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-fg/90">{n.body}</div>
        {count > 1 && index !== null && <nav className="mt-5 flex items-center justify-between border-t border-line pt-3" aria-label={t('切换公告')}>
          <button type="button" className="icon-button" disabled={index <= 0} onClick={() => onIndex(index - 1)} aria-label={t('上一条')}><ChevronLeft size={20} /></button>
          <span className="number text-[13px] text-muted">{index + 1} / {count}</span>
          <button type="button" className="icon-button" disabled={index >= count - 1} onClick={() => onIndex(index + 1)} aria-label={t('下一条')}><ChevronRight size={20} /></button>
        </nav>}
      </article>}
    </Sheet>
  )
}
