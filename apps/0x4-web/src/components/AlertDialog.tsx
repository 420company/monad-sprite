// Centered alert dialog: for failed trades / operations — title + reason + suggestion + one button; no cramming long English strings into the top notification bar
import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { CircleAlert, CircleCheck, Info } from 'lucide-react'
import { friendlyError } from '@/lib/errors'
import { t } from '@/lib/i18n'

interface AlertState { open: boolean; kind: 'error' | 'info' | 'success'; title: string; message: string; hint?: string; show: (a: Omit<AlertState, 'open' | 'show' | 'close' | 'error'>) => void; error: (e: unknown, fallbackTitle?: string) => void; close: () => void }
export const useAlert = create<AlertState>((set) => ({
  open: false, kind: 'error', title: '', message: '', hint: undefined,
  show: (a) => set({ ...a, open: true }),
  error: (e, fallbackTitle) => { const f = friendlyError(e, fallbackTitle); set({ open: true, kind: 'error', title: f.title, message: f.message, hint: f.hint }) },
  close: () => set({ open: false }),
}))
/** Call directly from anywhere: alertError(error, message) */
export const alertError = (e: unknown, fallbackTitle?: string) => useAlert.getState().error(e, fallbackTitle)

export function AlertHost() {
  const { open, kind, title, message, hint, close } = useAlert()
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) (typeof d.showModal === 'function' ? d.showModal() : d.setAttribute('open', '')); if (!open && d.open) d.close() }, [open])
  const Icon = kind === 'error' ? CircleAlert : kind === 'success' ? CircleCheck : Info
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); close() }} onClick={(e) => { if (e.target === e.currentTarget) close() }}
      className="m-auto w-[calc(100%-3rem)] max-w-sm rounded-2xl border border-line bg-card p-0 text-fg shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-[alert-in_.22s_cubic-bezier(.16,1,.3,1)]">
      {open && <div className="p-5">
        <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${kind === 'error' ? 'bg-down/15 text-down' : kind === 'success' ? 'bg-up/15 text-up' : 'bg-card2 text-muted'}`}><Icon size={26} /></div>
        <h2 className="mt-4 text-center text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-center text-sm leading-relaxed text-muted">{message}</p>
        {hint && <p className="mt-2 rounded-lg bg-card2 px-3 py-2 text-center text-xs leading-relaxed text-fg">{hint}</p>}
        <button onClick={close} autoFocus className="ui-button mt-5 min-h-12 w-full bg-accent text-base text-bg">{t('知道了')}</button>
      </div>}
    </dialog>
  )
}
