// Desktop centered modal (docs/WEB_DESIGN.md section 2: confirmations and forms use centered dialogs, 440 wide, 14 radius, rgb(0 0 0 / .6) scrim, no background blur).
// Uses the native <dialog>'s showModal: the page behind is automatically inoperable, focus is trapped in the dialog, and Esc dismissal is handled by the browser.
import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { t } from '@/lib/i18n'

export default function Modal({ open, onClose, title, children, dismissible = true, width = 440 }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode
  /** Can't be closed while processing (signing / on-chain) */
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
