// React 外壳：铺满父元素（父元素要 position: relative），用 ref.play(事件) 播放。
// 直播间 / 会议 / App 的礼物消息到了（服务器已经扣好能量）就调一次 play，不要自己先播。
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
