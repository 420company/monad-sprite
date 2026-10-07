// 聊天气泡长按弹出的小菜单（回复 / 复制 / 删除），贴在气泡旁边；点空白处或按 Esc 关闭。
// 用 toast-solid 打底，亮 / 暗主题都跟着 CSS 变量走。
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem { key: string; label: string; icon?: ReactNode; danger?: boolean; onSelect: () => void }
/** 气泡在屏幕上的位置 */
export interface MenuAnchor { top: number; bottom: number; left: number; right: number }

export default function MessageMenu({ anchor, items, note, onClose, label }: { anchor: MenuAnchor | null; items: MenuItem[]; note?: string; onClose: () => void; label: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // 先渲染出来量尺寸，再决定放在气泡下方还是上方，左右不出屏
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
 * 长按（500ms）或右键打开菜单，双击走 onDouble。手指移动超过 10px 视为滚动，取消长按。
 * 返回的处理器直接展开到气泡元素上。
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
