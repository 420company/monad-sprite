// 电脑端下拉面板（docs/WEB_DESIGN.md 第 2 节：下拉 / 选择器用贴着触发按钮的弹出面板，电脑端不用手机底部弹层）。
// · 贴着触发按钮：默认在按钮下方，下方放不下而上方更宽敞时翻到上方；左右不出屏幕，高度不超过可用空间（面板里自己滚）
// · 点面板外、按 Esc 关闭；Esc 关闭后焦点回到触发按钮；窗口缩放 / 页面滚动时跟着按钮重新定位
// · 挂在 body 上（portal），不受交易终端各面板 overflow: hidden 的裁剪
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

interface Place { top?: number; bottom?: number; left: number; width: number; maxHeight: number }

export default function Popover({ open, anchor, onClose, width = 360, align = 'start', maxHeight = 520, label, className = '', children }: {
  open: boolean
  anchor: RefObject<HTMLElement | null>
  onClose: () => void
  width?: number
  /** start：左边和按钮左边对齐；end：右边和按钮右边对齐 */
  align?: 'start' | 'end'
  maxHeight?: number
  label: string
  className?: string
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<Place | null>(null)
  const close = useRef(onClose)
  close.current = onClose

  useLayoutEffect(() => {
    if (!open) { setPlace(null); return }
    const run = () => {
      const a = anchor.current?.getBoundingClientRect()
      if (!a) return
      const vw = window.innerWidth, vh = window.innerHeight, gap = 6, margin = 8
      const w = Math.min(width, vw - margin * 2)
      const left = Math.max(margin, Math.min(align === 'end' ? a.right - w : a.left, vw - w - margin))
      const below = vh - a.bottom - gap - margin, above = a.top - gap - margin
      const up = below < Math.min(maxHeight, 300) && above > below
      setPlace(up
        ? { bottom: vh - a.top + gap, left, width: w, maxHeight: Math.min(maxHeight, above) }
        : { top: a.bottom + gap, left, width: w, maxHeight: Math.min(maxHeight, below) })
    }
    run()
    window.addEventListener('resize', run)
    window.addEventListener('scroll', run, true)
    return () => { window.removeEventListener('resize', run); window.removeEventListener('scroll', run, true) }
  }, [open, anchor, width, align, maxHeight])

  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      const n = e.target as Node
      if (panel.current?.contains(n) || anchor.current?.contains(n)) return
      close.current()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close.current()
      anchor.current?.focus()
    }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key) }
  }, [open, anchor])

  if (!open || !place) return null
  return createPortal(
    <div ref={panel} role="dialog" aria-label={label} className={`tx-pop ${className}`} style={{ position: 'fixed', ...place }}>
      {children}
    </div>,
    document.body,
  )
}
