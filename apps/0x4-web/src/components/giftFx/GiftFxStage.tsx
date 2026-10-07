// React wrapper: fills the parent (the parent needs position: relative); play with ref.play(event).
// Call play once when a gift message arrives in the live room / meeting / app (the server has already deducted the energy); don't play on your own first.
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { GiftFxEngine, type GiftFxEvent, type GiftFxOptions } from './engine'

export interface GiftFxHandle { play(ev: GiftFxEvent): void; clear(): void }

export const GiftFxStage = forwardRef<GiftFxHandle, GiftFxOptions & { className?: string }>(function GiftFxStage({ className, ...opts }, ref) {
  const box = useRef<HTMLDivElement>(null)
  const eng = useRef<GiftFxEngine | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    if (!box.current) return
    const e = new GiftFxEngine(box.current, optsRef.current)
    eng.current = e
    return () => { e.destroy(); eng.current = null }
  }, [])
  useEffect(() => { if (opts.lang) eng.current?.setLang(opts.lang) }, [opts.lang])

  useImperativeHandle(ref, () => ({
    play: (ev) => eng.current?.play(ev),
    clear: () => eng.current?.clear(),
  }), [])

  return <div ref={box} className={className} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 60 }} />
})
