// 电脑端居中模态框（docs/WEB_DESIGN.md 第 2 节：确认、表单用居中弹窗，宽 440，圆角 14，遮罩 rgb(0 0 0 / .6)，不模糊背景）。
// 用原生 <dialog> 的 showModal：背后的页面自动不可操作、焦点关在弹窗里、Esc 关闭都由浏览器负责。
import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { t } from '@/lib/i18n'

export default function Modal({ open, onClose, title, children, dismissible = true, width = 440 }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode
  /** 处理中（签名、上链）不许关 */
  dismissible?: boolean
  width?: number
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const latest = useRef({ onClose, dismissible })
  latest.current = { onClose, dismissible }

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="tx-modal"
      style={{ width: `min(${width}px, calc(100vw - 32px))` }}
      aria-label={title}
      onCancel={(e) => { e.preventDefault(); if (latest.current.dismissible) latest.current.onClose() }}
      onClick={(e) => { if (e.target === e.currentTarget && latest.current.dismissible) latest.current.onClose() }}
    >
      {open && <div className="tx-modal-in">
        <header className="tx-modal-head">
          <h2>{title}</h2>
          <button type="button" className="tx-icon-btn" onClick={() => { if (dismissible) onClose() }} disabled={!dismissible} aria-label={t('关闭')}><X size={16} /></button>
        </header>
        <div className="tx-modal-body">{children}</div>
      </div>}
    </dialog>
  )
}
