// Desktop dropdown panel (docs/WEB_DESIGN.md §2: dropdowns / pickers use popovers hugging the trigger button; desktop never uses phone bottom sheets).
// - Hugs the trigger: below by default, flips above when there's no room below but more above; never leaves the screen horizontally, never taller than available space (scrolls internally)
// - Closes on outside-tap or Esc; focus returns to the trigger after Esc; repositions with the button on window resize / page scroll
// - Mounted on body (portal), immune to the trade terminal panels' overflow: hidden clipping
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

interface Place { top?: number; bottom?: number; left: number; width: number; maxHeight: number }

export default function Popover({ open, anchor, onClose, width = 360, align = 'start', maxHeight = 520, label, className = '', children }: {
  open: boolean
  anchor: RefObject<HTMLElement | null>
  onClose: () => void
  width?: number
  /** start: left edge aligns with the button's left; end: right edge aligns with the button's right */
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
