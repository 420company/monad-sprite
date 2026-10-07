// Notifications share one timer; switching between the page and the top-level overlay doesn't double-time or double-announce.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { CircleCheck, CircleAlert, Info, X } from 'lucide-react'
import { hapticResult } from '@/lib/native'
import { t } from '@/lib/i18n'
import { toastErrorText } from '@/lib/errors'

interface ToastItem { id: number; text: string; kind: 'info' | 'error' | 'success' }
interface ToastState { items: ToastItem[]; push: (text: string, kind?: ToastItem['kind']) => void; remove: (id: number) => void }

let seq = 1
const timers = new Map<number, { remaining: number; started: number; timer?: ReturnType<typeof setTimeout>; paused: Set<string> }>()
function schedule(id: number) {
  const state = timers.get(id)
  if (!state || state.paused.size) return
  state.started = Date.now()
  state.timer = setTimeout(() => useToast.getState().remove(id), state.remaining)
}
function pause(id: number, reason: string, on: boolean) {
  const state = timers.get(id)
  if (!state) return
  if (on && !state.paused.has(reason)) {
    if (!state.paused.size) { clearTimeout(state.timer); state.remaining = Math.max(0, state.remaining - (Date.now() - state.started)) }
    state.paused.add(reason)
  } else if (!on && state.paused.delete(reason) && !state.paused.size) schedule(id)
}
export const useToast = create<ToastState>()((set, get) => ({
  items: [],
  push(text, kind = 'info') {
    const id = seq++
    // Only one toast at a time: when a new one arrives, the old one dismisses immediately (2026-09-26 goat: rapid actions stacked two or three, the new arriving before the old vanished).
    // Success / info: 2.5s; errors stay 6s for extra reading time
    for (const old of get().items) get().remove(old.id)
    timers.set(id, { remaining: kind === 'error' ? 6000 : 2500, started: Date.now(), paused: new Set(document.hidden ? ['document'] : []) })
    set({ items: [...get().items, { id, text, kind }] })
    schedule(id)
  },
  remove(id) {
    clearTimeout(timers.get(id)?.timer)
    timers.delete(id)
    set({ items: get().items.filter((t) => t.id !== id) })
  },
}))

export const toast = {
  // The native shell also gives one haptic feedback: one for success, one for failure; a no-op on web
  info: (t: string) => { hapticResult('info'); useToast.getState().push(t, 'info') },
  // Errors are filtered uniformly: user-cancelled ones don't pop; ones carrying raw tx data are swapped for a readable one-liner (lib/errors toastErrorText)
  error: (t: string) => { const text = toastErrorText(t); if (text === null) return; hapticResult('error'); useToast.getState().push(text, 'error') },
  success: (t: string) => { hapticResult('success'); useToast.getState().push(t, 'success') },
}

export function ToastHost() {
  const items = useToast((s) => s.items)
  const root = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(true)

  useLayoutEffect(() => {
    // Sheets only mount their own ToastHost at the top layer; page mount points must also leave the accessibility tree.
    const update = () => setVisible(!!root.current?.closest('dialog') || !document.querySelector('dialog[open]'))
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'], childList: true })
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const update = () => { for (const id of timers.keys()) pause(id, 'document', document.hidden) }
    document.addEventListener('visibilitychange', update)
    update()
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return (
    <div ref={root} data-toast-host aria-hidden={!visible || undefined} className="pointer-events-none fixed inset-0 z-[100] flex max-h-dvh flex-col items-center justify-center gap-2 overflow-y-auto px-4">
      {visible && items.map(t => <ToastMessage key={t.id} item={t} />)}
    </div>
  )
}

function ToastMessage({ item }: { item: ToastItem }) {
  const source = useId()
  const { id, text, kind } = item
  useEffect(() => () => { pause(id, source + 'hover', false); pause(id, source + 'focus', false) }, [id, source])
  const Icon = kind === 'error' ? CircleAlert : kind === 'success' ? CircleCheck : Info
  return <div data-toast-item={id} className="pointer-events-auto flex w-full max-w-[420px] shrink-0 items-start gap-2 toast-solid rounded-lg border border-line pl-3 text-sm shadow-xl"
    onPointerEnter={e => { if (e.pointerType === 'mouse') pause(id, source + 'hover', true) }} onPointerLeave={() => pause(id, source + 'hover', false)}
    onFocusCapture={() => pause(id, source + 'focus', true)} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget)) pause(id, source + 'focus', false) }}>
    <Icon size={18} className={`mt-3.5 shrink-0 ${kind === 'error' ? 'text-down' : kind === 'success' ? 'text-up' : 'text-muted'}`} aria-hidden="true" />
    <p role={kind === 'error' ? 'alert' : 'status'} aria-atomic="true" className="min-w-0 flex-1 whitespace-pre-wrap break-words py-3 leading-relaxed">{text}</p>
    <button onClick={() => useToast.getState().remove(id)} className="icon-button" aria-label={t('关闭通知')} title={t('关闭通知')}><X size={17} /></button>
  </div>
}
