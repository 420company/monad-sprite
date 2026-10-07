// Pen annotations on the shared view: a canvas over the shared view + the presenter's toolbar (rules in annotate.ts).
// Canvas follows container size and device pixel ratio; repaints only on stroke/size changes — continuous refresh only while a laser pointer is fading.
// The stroke I'm drawing renders locally first (follows the hand); new points are batched out every ~50ms.
import { useEffect, useRef } from 'react'
import { Crosshair, Pencil, Trash2, Undo2, X } from 'lucide-react'
import { t } from '@/lib/i18n'
import {
  ANN_COLORS, contentRect, farEnough, fromNorm, laserAlpha, MAX_STROKE_NUMS, strokeId, toNorm,
  type AnnColor, type AnnMsg, type AnnTool, type Rect, type Stroke,
} from './annotate'

/** The shared view's video element carries this class; the annotation layer reads the video's native size from it (to compute letterboxing) */
export const SCREEN_VIDEO_CLASS = 'meet-screen'
const SEND_EVERY_MS = 50
/** Max numbers per seg message (matches the sanitizeAnn cap in annotate.ts) */
const SEG_MAX = 400

type Live = { id: string; tool: AnnTool; color: AnnColor; pts: number[] }

export function AnnotationLayer({ strokes, localId, drawing, tool, color, onLocal }: {
  strokes: Stroke[]; localId: string; drawing: boolean; tool: AnnTool; color: AnnColor; onLocal: (m: AnnMsg) => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const live = useRef<Live | null>(null)
  const pending = useRef<number[]>([])
  const lastPt = useRef<[number, number] | null>(null)
  const strokesRef = useRef(strokes)
  strokesRef.current = strokes
  const raf = useRef(0)
  const onLocalRef = useRef(onLocal)
  onLocalRef.current = onLocal

  const video = () => boxRef.current?.parentElement?.querySelector<HTMLVideoElement>(`video.${SCREEN_VIDEO_CLASS}`) ?? null
  const rectNow = (): Rect => {
    const box = boxRef.current
    if (!box) return { x: 0, y: 0, w: 0, h: 0 }
    const v = video()
    return contentRect(box.clientWidth, box.clientHeight, v?.videoWidth || 0, v?.videoHeight || 0)
  }

  // Paint once; returns whether a laser pointer is still fading (keep refreshing if so)
  const paint = (): boolean => {
    const cv = canvasRef.current, box = boxRef.current
    if (!cv || !box) return false
    const dpr = window.devicePixelRatio || 1
    const w = box.clientWidth, h = box.clientHeight
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr) }
    const ctx = cv.getContext('2d')
    if (!ctx) return false
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const r = rectNow()
    if (!(r.w > 0)) return false
    const now = Date.now()
    let fading = false
    const lv = live.current
    const list: { tool: AnnTool; color: AnnColor; pts: number[]; alpha: number }[] = []
    for (const s of strokesRef.current) {
      if (lv && s.id === lv.id && s.by === localId) continue   // The stroke I'm drawing uses the local one — don't draw twice
      const alpha = s.tool === 'laser' ? laserAlpha(s, now) : 1
      if (alpha <= 0) continue
      if (s.tool === 'laser' && s.endAt !== null) fading = true
      list.push({ tool: s.tool, color: s.color, pts: s.pts, alpha })
    }
    if (lv) list.push({ tool: lv.tool, color: lv.color, pts: lv.pts, alpha: 1 })
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    for (const s of list) {
      if (s.pts.length < 2) continue
      const laser = s.tool === 'laser'
      ctx.globalAlpha = s.alpha
      ctx.strokeStyle = laser ? '#ff2e63' : ANN_COLORS[s.color]
      ctx.fillStyle = ctx.strokeStyle
      ctx.lineWidth = Math.max(laser ? 4 : 2.5, r.w * (laser ? 0.0065 : 0.0038))
      ctx.shadowColor = laser ? 'rgba(255,46,99,.95)' : 'rgba(0,0,0,.35)'
      ctx.shadowBlur = laser ? 20 : 3
      const [x0, y0] = fromNorm(s.pts[0], s.pts[1], r)
      if (s.pts.length === 2) { ctx.beginPath(); ctx.arc(x0, y0, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); continue }
      ctx.beginPath(); ctx.moveTo(x0, y0)
      for (let i = 2; i < s.pts.length; i += 2) { const [x, y] = fromNorm(s.pts[i], s.pts[i + 1], r); ctx.lineTo(x, y) }
      ctx.stroke()
      // Laser pointer: red halo outside, white core inside — instantly distinct from the red pen
      if (laser) {
        ctx.shadowBlur = 0
        ctx.strokeStyle = 'rgba(255,255,255,.92)'
        ctx.lineWidth = Math.max(1.2, ctx.lineWidth * 0.35)
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0
    return fading || (!!lv && lv.tool === 'laser')
  }
  const redraw = () => {
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(function loop() { if (paint()) raf.current = requestAnimationFrame(loop) })
  }

  // Strokes changed / size changed / video dimensions arrived: repaint
  useEffect(() => { redraw() }, [strokes]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const ro = new ResizeObserver(() => redraw())
    ro.observe(box)
    const v = video()
    v?.addEventListener('resize', redraw); v?.addEventListener('loadedmetadata', redraw)
    return () => { ro.disconnect(); v?.removeEventListener('resize', redraw); v?.removeEventListener('loadedmetadata', redraw); cancelAnimationFrame(raf.current) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // While drawing, send new points every 50ms
  const flush = () => {
    const lv = live.current
    const pts = pending.current
    if (!lv || !pts.length) return
    pending.current = []
    for (let i = 0; i < pts.length; i += SEG_MAX) onLocalRef.current({ t: 'ann', k: 'seg', id: lv.id, tool: lv.tool, color: lv.color, pts: pts.slice(i, i + SEG_MAX) })
  }
  useEffect(() => {
    if (!drawing) return
    const id = setInterval(flush, SEND_EVERY_MS)
    return () => clearInterval(id)
  }, [drawing]) // eslint-disable-line react-hooks/exhaustive-deps

  const point = (e: React.PointerEvent): [number, number] => {
    const b = boxRef.current!.getBoundingClientRect()
    return toNorm(e.clientX - b.left, e.clientY - b.top, rectNow())
  }
  const down = (e: React.PointerEvent) => {
    if (!drawing || e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = point(e)
    live.current = { id: strokeId(), tool, color, pts: [...p] }
    pending.current = [...p]
    lastPt.current = p
    redraw()
  }
  const move = (e: React.PointerEvent) => {
    const lv = live.current
    if (!lv) return
    const p = point(e)
    if (!farEnough(lastPt.current, p) || lv.pts.length >= MAX_STROKE_NUMS) return
    lastPt.current = p
    lv.pts.push(p[0], p[1]); pending.current.push(p[0], p[1])
    redraw()
  }
  const up = () => {
    const lv = live.current
    if (!lv) return
    flush()
    onLocalRef.current({ t: 'ann', k: 'end', id: lv.id })
    live.current = null
    lastPt.current = null
    redraw()
  }

  return <div ref={boxRef} className="absolute inset-0 z-[5]" style={{ pointerEvents: drawing ? 'auto' : 'none', cursor: drawing ? 'crosshair' : undefined, touchAction: drawing ? 'none' : undefined }}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-testid="ann-layer">
    <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
  </div>
}

/** The presenter's annotation toolbar: pen in three colors, laser pointer, undo, clear all, exit */
export function AnnotateToolbar({ tool, color, onTool, onColor, onUndo, onClear, onExit, canUndo, canClear }: {
  tool: AnnTool; color: AnnColor; onTool: (t: AnnTool) => void; onColor: (c: AnnColor) => void; onUndo: () => void; onClear: () => void; onExit: () => void; canUndo: boolean; canClear: boolean
}) {
  const btn = 'flex h-9 w-9 items-center justify-center rounded-full text-fg/85 transition hover:bg-[var(--mt-3)] disabled:opacity-35 disabled:hover:bg-transparent'
  const on = 'bg-[var(--mt-4)] text-fg'
  const names: Record<AnnColor, string> = { red: t('红色画笔'), yellow: t('黄色画笔'), green: t('绿色画笔') }
  // Toolbar sits on its own row above the video window (2026-10-02 goat: it used to float over the picture, covering shared content); positioned by MeetingRoom
  return <div className="meet-fade meet-glass mx-auto flex w-fit items-center gap-1 rounded-full bg-[var(--mt-panel)] p-1.5 shadow-[0_20px_60px_-10px_var(--mt-shadow),inset_0_0_0_1px_var(--mt-line)]" role="toolbar" aria-label={t('标注工具')} data-testid="ann-toolbar">
    <span className="flex items-center gap-1.5 pl-2.5 pr-1.5 text-[12.5px] font-medium text-muted"><Pencil size={14} />{t('标注')}</span>
    {(['red', 'yellow', 'green'] as AnnColor[]).map((c) => <button key={c} type="button" className={`${btn} ${tool === 'pen' && color === c ? on : ''}`} onClick={() => { onTool('pen'); onColor(c) }} aria-label={names[c]} title={names[c]} aria-pressed={tool === 'pen' && color === c} data-testid={`ann-${c}`}>
      <span className="h-4 w-4 rounded-full" style={{ background: ANN_COLORS[c], boxShadow: tool === 'pen' && color === c ? `0 0 0 2px var(--mt-panel), 0 0 0 4px ${ANN_COLORS[c]}` : undefined }} />
    </button>)}
    <button type="button" className={`${btn} ${tool === 'laser' ? on : ''}`} onClick={() => onTool('laser')} aria-label={t('激光笔')} title={t('激光笔：画完 3 秒后自动消失')} aria-pressed={tool === 'laser'} data-testid="ann-laser"><Crosshair size={17} /></button>
    <span className="mx-1 h-5 w-px bg-[var(--mt-3)]" />
    <button type="button" className={btn} onClick={onUndo} disabled={!canUndo} aria-label={t('撤销上一笔')} title={t('撤销上一笔')} data-testid="ann-undo"><Undo2 size={17} /></button>
    <button type="button" className={btn} onClick={onClear} disabled={!canClear} aria-label={t('全部清除')} title={t('全部清除')} data-testid="ann-clear"><Trash2 size={16} /></button>
    <button type="button" className={`${btn} ml-0.5`} onClick={onExit} aria-label={t('退出标注')} title={t('退出标注')} data-testid="ann-exit"><X size={17} /></button>
  </div>
}
