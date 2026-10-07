// 合约选币列表里每个币的 24 小时迷你走势线（1 小时 K 线 × 24 根的收盘价）。
//
// 七百多个合约不能一进页面全拉：只在这一行滚进屏幕时才请求，同时最多 4 个，
// 结果缓存 5 分钟，来回滚动不重复请求。拉不到就留空，不显示假线。
import { useEffect, useRef, useState } from 'react'
import { loadCandles } from '@/lib/aster'

const TTL = 5 * 60_000
const cache = new Map<string, { at: number; closes: number[] }>()
const inflight = new Map<string, Promise<number[]>>()
const queue: (() => void)[] = []
let running = 0

function schedule<T>(job: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      running++
      job().then(resolve, reject).finally(() => { running--; queue.shift()?.() })
    }
    if (running < 4) run(); else queue.push(run)
  })
}

function closesOf(coin: string): Promise<number[]> {
  const hit = cache.get(coin)
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.closes)
  const pending = inflight.get(coin)
  if (pending) return pending
  const p = schedule(() => loadCandles(coin, '1h', 24))
    .then((k) => { const closes = k.map((x) => x.close); cache.set(coin, { at: Date.now(), closes }); return closes })
    .finally(() => inflight.delete(coin))
  inflight.set(coin, p)
  return p
}

const W = 64, H = 26

/** up：涨跌颜色跟着列表里的 24h 涨跌幅走，不按这 24 根线的首尾算——两者起点不同，会出现「线是绿的、涨跌是红的」 */
export default function MiniTrend({ coin, up }: { coin: string; up: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const [closes, setCloses] = useState<number[] | null>(() => cache.get(coin)?.closes ?? null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    let dead = false
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      closesOf(coin).then((c) => { if (!dead) setCloses(c) }).catch(() => {})
    }, { rootMargin: '120px' })
    io.observe(el)
    return () => { dead = true; io.disconnect() }
  }, [coin])

  let path = '', area = ''
  if (closes && closes.length > 1) {
    const min = Math.min(...closes), max = Math.max(...closes), r = max - min || 1
    const pts = closes.map((c, i) => [(i / (closes.length - 1)) * W, H - 3 - ((c - min) / r) * (H - 6)])
    path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
    area = `${path} L${W} ${H} L0 ${H} Z`
  }
  const id = `spark-${coin}`

  return (
    <div ref={box} className="h-[26px] w-16" aria-hidden="true">
      {path && (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full overflow-visible">
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={up ? 'var(--color-up)' : 'var(--color-down)'} stopOpacity=".28" />
              <stop offset="1" stopColor={up ? 'var(--color-up)' : 'var(--color-down)'} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${id})`} />
          <path d={path} fill="none" stroke={up ? 'var(--color-up)' : 'var(--color-down)'} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      )}
    </div>
  )
}
