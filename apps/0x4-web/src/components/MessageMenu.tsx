// Small menu popping on chat-bubble long-press (reply / copy / delete), hugging the bubble; tap empty space or Esc to close.
// Built on toast-solid; light / dark themes both follow CSS variables.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem { key: string; label: string; icon?: ReactNode; danger?: boolean; onSelect: () => void }
/** The bubble's on-screen position */
export interface MenuAnchor { top: number; bottom: number; left: number; right: number }

export default function MessageMenu({ anchor, items, note, onClose, label }: { anchor: MenuAnchor | null; items: MenuItem[]; note?: string; onClose: () => void; label: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // Render first to measure, then decide below vs above the bubble, never overflowing left/right
  useLayoutEffect(() => {
    if (!anchor || !box.current) { setPos(null); return }
    const { offsetWidth: w, offsetHeight: h } = box.current
    const vw = window.innerWidth, vh = window.innerHeight, gap = 6, edge = 12
    const center = (anchor.left + anchor.right) / 2
    const left = Math.min(Math.max(edge, center - w / 2), vw - w - edge)
    const below = anchor.bottom + gap
    const top = below + h <= vh - edge ? below : Math.max(edge, anchor.top - h - gap)
    setPos({ top, left })
  }, [anchor, items.length, note])

  useEffect(() => {
    if (!anchor) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    box.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    return () => window.removeEventListener('keydown', onKey)
  }, [anchor, items, onClose])

  if (!anchor) return null
  return createPortal(
    <div className="fixed inset-0 z-[80]" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }} onContextMenu={(e) => e.preventDefault()}>
      <div ref={box} role="menu" aria-label={label} style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
        className="toast-solid absolute min-w-44 max-w-[80vw] overflow-hidden rounded-2xl border border-line py-1 text-[15px] shadow-xl">
        {note && <div className="px-4 pb-1.5 pt-2 text-xs text-muted">{note}</div>}
        {items.map((it) => (
          <button key={it.key} role="menuitem" onClick={it.onSelect}
            className={`flex min-h-11 w-full items-center gap-3 px-4 text-left active:bg-card2 hover:bg-card ${it.danger ? 'text-down' : 'text-fg'}`}>
            {it.icon}<span>{it.label}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  )
}

/**
 * Long-press (500ms) or right-click opens the menu; double-tap goes to onDouble. Finger movement beyond 10px counts as scroll, cancelling the long-press.
 * The returned handlers spread directly onto the bubble element.
 */
export function useLongPress(onLong: (a: MenuAnchor) => void, onDouble?: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const cancel = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  const fire = (el: Element) => { const r = el.getBoundingClientRect(); onLong({ top: r.top, bottom: r.bottom, left: r.left, right: r.right }) }
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return
      const el = e.currentTarget
      start.current = { x: e.clientX, y: e.clientY }
      cancel()
      timer.current = setTimeout(() => { timer.current = null; navigator.vibrate?.(10); fire(el) }, 500)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel()
    },
    onPointerUp: cancel, onPointerLeave: cancel, onPointerCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); cancel(); fire(e.currentTarget) },
    onDoubleClick: onDouble,
  }
}
