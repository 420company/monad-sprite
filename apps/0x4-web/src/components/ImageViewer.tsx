// Full-screen image viewer: swipe left/right to switch, pinch to zoom, double-tap to zoom in, single tap to close, shows the current index.
// While src isn't ready (a DM full-size image still decrypting), show the thumbnail placeholder with a spinner.
// Multi-image chat messages can mix in videos (video = true shows the player); with save = true the top-right gets a "save" button that saves only the current image.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Download, LoaderCircle, X } from 'lucide-react'
import { t } from '@/lib/i18n'
import { isNative, saveImage } from '@/lib/native'
import { toast } from './Toast'

export interface ViewerImage { src?: string; placeholder?: string; video?: boolean }

/** Read an image URL (http / blob:) into a data URL and hand it to saveImage: saves to the photo album in the app, downloads on web */
async function saveCurrent(src: string) {
  const blob = await (await fetch(src)).blob()
  const dataUrl = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(blob) })
  const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : blob.type.includes('gif') ? 'gif' : 'jpg'
  await saveImage(dataUrl, `0x4-${Date.now()}.${ext}`)
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const MAX_SCALE = 4

function Slide({ img, active, scale, tx, ty }: { img: ViewerImage; active: boolean; scale: number; tx: number; ty: number }) {
  const [loaded, setLoaded] = useState<string | null>(null)
  const ready = !!img.src && loaded === img.src
  if (img.video) return (
    <div className="relative flex h-full w-full shrink-0 items-center justify-center overflow-hidden">
      {img.src ? <video key={img.src} src={img.src} controls playsInline autoPlay={active} className="max-h-full max-w-full bg-black" />
        : <LoaderCircle size={28} className="absolute animate-spin text-white/80" aria-label={t('加载中…')} />}
    </div>
  )
  return (
    <div className="relative flex h-full w-full shrink-0 items-center justify-center overflow-hidden">
      <div className="relative flex h-full w-full items-center justify-center" style={active ? { transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`, transition: 'transform .12s linear' } : undefined}>
        {img.placeholder && !ready && <img src={img.placeholder} alt="" draggable={false} className="absolute max-h-full max-w-full object-contain" />}
        {img.src && <img src={img.src} alt={t('图片')} draggable={false} onLoad={() => setLoaded(img.src!)} className={`relative max-h-full max-w-full select-none object-contain ${ready ? '' : 'opacity-0'}`} />}
      </div>
      {!ready && <LoaderCircle size={28} className="absolute animate-spin text-white/80" aria-label={t('加载中…')} />}
    </div>
  )
}

export default function ImageViewer({ images, index: start, onClose, onIndex, save }: { images: ViewerImage[]; index: number; onClose: () => void; onIndex?: (i: number) => void; save?: boolean }) {
  const n = images.length
  const [index, setIndex] = useState(() => clamp(start, 0, Math.max(0, n - 1)))
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ x: number; y: number; t: number; moved: boolean; pinch?: { dist: number; scale: number }; pan: { x: number; y: number } } | null>(null)
  const lastTap = useRef(0)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const box = useRef<HTMLDivElement>(null)

  const go = useCallback((i: number) => { setIndex(clamp(i, 0, n - 1)); setScale(1); setPan({ x: 0, y: 0 }) }, [n])
  // Tell the outside which image is shown (DMs decrypt the current and adjacent full-size images on demand)
  useEffect(() => { onIndex?.(index) }, [index]) // eslint-disable-line react-hooks/exhaustive-deps
  const [saving, setSaving] = useState(false)
  const cur = images[index]
  const doSave = async () => {
    if (!cur?.src || saving) return
    setSaving(true)
    try {
      await saveCurrent(cur.src)
      toast.success(isNative ? t('已保存到相册') : t('图片已下载'))
    } catch (e) {
      const code = (e as { code?: string }).code
      toast.error(code === 'DENIED' ? t('没有相册权限，请在系统设置里允许 0x4 添加照片') : t('保存失败'))
    } finally { setSaving(false) }
  }

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') go(index - 1)
      else if (e.key === 'ArrowRight') go(index + 1)
    }
    window.addEventListener('keydown', key)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', key) }
  }, [go, index, onClose])
  useEffect(() => () => clearTimeout(tapTimer.current), [])
  useEffect(() => { box.current?.focus() }, [])

  const dist = () => { const [a, b] = [...pointers.current.values()]; return Math.hypot(a.x - b.x, a.y - b.y) }
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, video')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) { gesture.current = { ...(gesture.current || { x: e.clientX, y: e.clientY, t: Date.now(), pan }), moved: true, pinch: { dist: dist(), scale } }; setDrag({ x: 0, y: 0, active: false }) }
    else if (pointers.current.size === 1) gesture.current = { x: e.clientX, y: e.clientY, t: Date.now(), moved: false, pan }
  }
  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g || !pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (g.pinch && pointers.current.size === 2) { setScale(clamp(g.pinch.scale * dist() / g.pinch.dist, 1, MAX_SCALE)); return }
    const dx = e.clientX - g.x, dy = e.clientY - g.y
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) g.moved = true
    if (scale > 1) setPan({ x: g.pan.x + dx, y: g.pan.y + dy })
    else if (g.moved) setDrag({ x: dx, y: Math.abs(dy) > Math.abs(dx) ? Math.max(0, dy) : 0, active: true })
  }
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    if (!g || pointers.current.size > 0) return
    gesture.current = null
    if (scale <= 1.02 && scale !== 1) { setScale(1); setPan({ x: 0, y: 0 }) }
    if (g.pinch) { setDrag({ x: 0, y: 0, active: false }); return }
    const width = box.current?.clientWidth || window.innerWidth
    if (drag.active) {
      if (drag.y > 120) onClose()
      else if (drag.x < -width * 0.18) go(index + 1)
      else if (drag.x > width * 0.18) go(index - 1)
      setDrag({ x: 0, y: 0, active: false })
      return
    }
    if (g.moved || Date.now() - g.t > 350) return
    // Double-tap zooms in / restores; single taps wait briefly to confirm it's not a double-tap before closing
    const now = Date.now()
    if (now - lastTap.current < 280) {
      clearTimeout(tapTimer.current); lastTap.current = 0
      if (scale > 1) { setScale(1); setPan({ x: 0, y: 0 }) } else setScale(2.5)
      return
    }
    lastTap.current = now
    tapTimer.current = setTimeout(() => { if (lastTap.current === now) onClose() }, 280)
  }

  const offset = drag.active ? drag.x : 0
  const fade = drag.active ? Math.max(0.4, 1 - drag.y / 400) : 1
  return createPortal(
    <div ref={box} role="dialog" aria-modal="true" aria-label={t('查看图片')} tabIndex={-1}
      className="fixed inset-0 z-[1000] touch-none select-none overflow-hidden bg-black outline-none"
      style={{ backgroundColor: `rgba(0,0,0,${fade})` }}
      // Clicks inside the portal still bubble to outer layers in React (e.g. post body's "tap for detail") — intercept them here
      onClick={(e) => e.stopPropagation()}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <div className="flex h-full" style={{ transform: `translate3d(calc(${-index * 100}% + ${offset}px), ${drag.active ? drag.y : 0}px, 0)`, transition: drag.active ? 'none' : 'transform .25s cubic-bezier(.2,.8,.2,1)' }}>
        {images.map((img, i) => Math.abs(i - index) <= 1
          ? <Slide key={i} img={img} active={i === index} scale={i === index ? scale : 1} tx={i === index ? pan.x : 0} ty={i === index ? pan.y : 0} />
          : <div key={i} className="h-full w-full shrink-0" />)}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-3" style={{ paddingTop: 'calc(env(safe-area-inset-top) + .5rem)' }}>
        <span className="number rounded-full bg-black/50 px-3 py-1 text-sm text-white" aria-live="polite">{n > 1 ? `${index + 1} / ${n}` : ''}</span>
        <span className="flex items-center gap-2">
          {save && cur && !cur.video && <button onClick={doSave} disabled={!cur.src || saving} className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white disabled:opacity-50" aria-label={isNative ? t('保存到相册') : t('下载图片')} title={isNative ? t('保存到相册') : t('下载图片')}>{saving ? <LoaderCircle size={20} className="animate-spin" /> : <Download size={20} />}</button>}
          <button onClick={onClose} className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white" aria-label={t('关闭')}><X size={22} /></button>
        </span>
      </div>
      {n > 1 && index > 0 && <button onClick={() => go(index - 1)} className="absolute left-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white sm:flex" aria-label={t('上一张')}><ChevronLeft size={24} /></button>}
      {n > 1 && index < n - 1 && <button onClick={() => go(index + 1)} className="absolute right-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white sm:flex" aria-label={t('下一张')}><ChevronRight size={24} /></button>}
    </div>,
    document.body,
  )
}
