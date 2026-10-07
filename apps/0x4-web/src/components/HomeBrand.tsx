// 首页顶栏左边：猫 logo + 官方滚动公告（2026-09-29 goat：原来 logo 右边的「0x4」文字位置改成滚动公告）。
// 没有生效的公告（或还没拉到、拉失败）时照旧显示「0x4」。
// 有公告时只显示标题：多条轮流切换，标题比条子长就先停一下再平滑滚到末尾；系统开了「减弱动态效果」就不滚，逐条切换、超长的用省略号。
// 点一下打开居中弹窗看全文（正文按纯文本显示，保留换行，绝不当 HTML），多条可以在弹窗里前后翻。
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { ChevronLeft, ChevronRight, Megaphone } from 'lucide-react'
import Sheet from './Sheet'
import { useHomeNotices, type HomeNotice } from '@/lib/homeNotices'
import { locale, t } from '@/lib/i18n'

/** 每条至少停留多久；标题要滚动时：先停 1.2 秒、按每秒 36 像素滚到末尾、再停 1.6 秒 */
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
 * 没有公告时的「0x4」字标（2026-09-29 goat：常规字体太普通，换像素字体更有 web3 感）。
 * 字体 Pixelify Sans 600（打包在 App 里）；画面上的 0 用这款字体自带的像素「Ø」，
 * 呼应猫头 logo 上带斜线的 0。读屏读「0x4」（aria-label），画出来的字不进读屏。
 */
export function BrandWordmark() {
  return <h1 className="brand-wordmark" aria-label="0x4"><span aria-hidden="true">Øx4</span></h1>
}

export function NoticeTicker({ notices }: { notices: HomeNotice[] }) {
  const [index, setIndex] = useState(0)
  const [open, setOpen] = useState<number | null>(null)
  const [scroll, setScroll] = useState(0)          // 当前这条要滚动的距离（像素），0 = 放得下
  const view = useRef<HTMLSpanElement>(null)
  const text = useRef<HTMLSpanElement>(null)
  const reduce = useRef(reducedMotion())
  const count = notices.length
  const i = count ? index % count : 0
  const cur = notices[i]

  // 公告列表变了（比如被下架）：序号越界就从头开始
  useEffect(() => { if (index >= count) setIndex(0) }, [index, count])

  // 量一下标题有没有超出条子
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

  // 轮播：只有一条时不切换；弹窗开着时停住
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

/** 公告全文弹窗；index 为 null 时关着 */
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
