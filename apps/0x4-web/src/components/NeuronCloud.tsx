// 果蝇脑神经元云：程序化生成的 2,914 条神经元，外部通过 ref 触发「放电」与「整脑脉冲」
// 果蝇交易员页按真实模拟的 spike 数触发放电
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { t } from '@/lib/i18n'

export interface NeuronCloudHandle { flash: (n: number) => void; pulse: (color?: string) => void }
interface Trace { pts: Float32Array; hue: number; color: string }
const CLUSTERS = [
  { x: 0.36, y: 0.32, r: 0.11, hue: 190 }, { x: 0.47, y: 0.29, r: 0.09, hue: 300 }, { x: 0.63, y: 0.34, r: 0.1, hue: 55 },
  { x: 0.5, y: 0.45, r: 0.1, hue: 110 }, { x: 0.62, y: 0.46, r: 0.09, hue: 210 }, { x: 0.33, y: 0.4, r: 0.08, hue: 20 },
  { x: 0.5, y: 0.7, r: 0.06, hue: 260, tail: true }, { x: 0.52, y: 0.85, r: 0.05, hue: 330, tail: true },
]
export const NEURON_COUNT = 2914

function genTraces(n: number, seed = 7): Trace[] {
  let s = seed
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  const out: Trace[] = []
  for (let i = 0; i < n; i++) {
    const c = CLUSTERS[Math.floor(rnd() * CLUSTERS.length)]
    const len = 10 + Math.floor(rnd() * 24)
    const pts = new Float32Array(len * 2)
    const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * c.r
    let x = c.x + Math.cos(a) * rr, y = c.y + Math.sin(a) * rr * (c.tail ? 2.2 : 1)
    for (let k = 0; k < len; k++) {
      pts[k * 2] = x; pts[k * 2 + 1] = y
      x += (rnd() - 0.5) * 0.012 + (c.x - x) * 0.03
      y += (rnd() - 0.5) * 0.012 + (c.tail ? 0.003 : (c.y - y) * 0.03)
    }
    const hue = c.hue + (rnd() - 0.5) * 40
    out.push({ pts, hue, color: `hsl(${hue} 90% 65%)` })
  }
  return out
}

const NeuronCloud = forwardRef<NeuronCloudHandle, { className?: string }>(function NeuronCloud({ className }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const traces = useRef<Trace[]>([])
  const flashes = useRef<{ i: number; t: number }[]>([])
  const pulse = useRef<{ t: number; color: string }>({ t: 0, color: '200,255,77' })
  const kick = useRef<() => void>(() => {})

  useImperativeHandle(ref, () => ({
    flash: (n) => { const k = Math.min(Math.max(0, Math.round(n)), 80); for (let i = 0; i < k; i++) flashes.current.push({ i: Math.floor(Math.random() * traces.current.length), t: 1 }); kick.current() },
    pulse: (color) => { pulse.current = { t: 1, color: color || '200,255,77' }; kick.current() },
  }), [])

  useEffect(() => {
    const cv = canvas.current; if (!cv) return
    traces.current = genTraces(NEURON_COUNT)
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const size = Math.min(cv.clientWidth || 360, 520)
    cv.width = size * dpr; cv.height = size * dpr
    const ctx = cv.getContext('2d')!; ctx.scale(dpr, dpr)
    const base = document.createElement('canvas'); base.width = cv.width; base.height = cv.height
    const b = base.getContext('2d')!; b.scale(dpr, dpr); b.lineWidth = 0.45; b.globalAlpha = 0.3
    const drawTrace = (c: CanvasRenderingContext2D, t: Trace) => { c.beginPath(); c.moveTo(t.pts[0] * size, t.pts[1] * size); for (let k = 1; k < t.pts.length / 2; k++) c.lineTo(t.pts[k * 2] * size, t.pts[k * 2 + 1] * size); c.stroke() }
    for (const t of traces.current) { b.strokeStyle = t.color; drawTrace(b, t) }
    for (const c of CLUSTERS) { const g = b.createRadialGradient(c.x * size, c.y * size, 0, c.x * size, c.y * size, c.r * size * 1.4); g.addColorStop(0, `hsl(${c.hue} 90% 60% / 0.35)`); g.addColorStop(1, 'transparent'); b.globalAlpha = 1; b.fillStyle = g; b.fillRect(0, 0, size, size) }
    let raf = 0
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const frame = () => {
      // reduced-motion 下按需绘制；清掉旧句柄，后续新 tick 才能重新唤醒画布。
      raf = 0
      ctx.clearRect(0, 0, size, size)
      ctx.drawImage(base, 0, 0, size, size)
      if (pulse.current.t > 0) { const g = ctx.createRadialGradient(size / 2, size * 0.42, 0, size / 2, size * 0.42, size * 0.55); g.addColorStop(0, `rgba(${pulse.current.color},${pulse.current.t * 0.35})`); g.addColorStop(1, 'transparent'); ctx.fillStyle = g; ctx.fillRect(0, 0, size, size); pulse.current.t -= 0.05 }
      ctx.lineWidth = 1.4
      flashes.current = flashes.current.filter((f) => f.t > 0)
      for (const f of flashes.current) { const t = traces.current[f.i]; if (!t) continue; ctx.globalAlpha = f.t; ctx.strokeStyle = `hsl(${t.hue} 100% 85%)`; drawTrace(ctx, t); f.t -= 0.08 }
      ctx.globalAlpha = 1
      if (!reduced || pulse.current.t > 0 || flashes.current.length > 0) raf = requestAnimationFrame(frame)
    }
    kick.current = () => { if (!raf) raf = requestAnimationFrame(frame) }
    frame()
    return () => { kick.current = () => {}; cancelAnimationFrame(raf) }
  }, [])
  return <canvas ref={canvas} role="img" aria-label={t('活动概览，不代表真实神经元位置')} title={t('活动概览 · 不代表真实神经元位置')} className={className || 'block aspect-square w-full'} />
})
export default NeuronCloud
