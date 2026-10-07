// 行情页的迷你走势线（2026-09-29 goat：行情页「说不出来哪不对」——上一版拿数据稀的币画大图很难看）。
// 规则：只画真实数据、只在代价小的地方画。这里只读服务器 K 线通道里「已经缓存」的 1 小时线
// （/api/candles?prefetch=1：服务器只查缓存，不向数据商发请求、不花额度；别人刚看过的币才有），拿不到就不画，绝不编。
// · 每分钟最多问 SPARK_PER_MIN 次（服务器按 IP 每分钟 60 次，给币详情页留足额度）；结果在本机记 5 分钟（没有也记，免得反复问）
// · 服务器说 K 线通道没开（enabled:false）：这次打开网页里不再问
import { useEffect, useState } from 'react'
import { API_BASE } from '@/lib/env'
import { candleConfig } from '@/lib/candleConfig'
import type { MarketToken } from '@/lib/types'

const TTL = 5 * 60_000
const SPARK_PER_MIN = 12
const cache = new Map<string, { at: number; pts: number[] | null }>()
const pending = new Set<string>()
let times: number[] = []
let serverOff = false
const listeners = new Set<() => void>()

const keyOf = (x: MarketToken) => `${x.chain}:${x.pairAddress}:${x.address}`.toLowerCase()

async function ask(x: MarketToken): Promise<number[] | null> {
  const q = new URLSearchParams({ chain: x.chain, pair: x.pairAddress || '', interval: '1h', token: x.address, prefetch: '1' })
  const r = await fetch(`${API_BASE}/api/candles?${q}`, { signal: AbortSignal.timeout(4000) })
  if (!r.ok) return null
  const d = await r.json() as { enabled?: boolean; candles?: { time: number; close: number }[] }
  if (d.enabled === false) { serverOff = true; return null }
  const pts = (Array.isArray(d.candles) ? d.candles : []).filter((c) => Number.isFinite(c.time) && Number.isFinite(c.close) && c.close > 0).sort((a, b) => a.time - b.time).slice(-48).map((c) => c.close)
  return pts.length >= 6 ? pts : null
}

function request(x: MarketToken) {
  const k = keyOf(x)
  const hit = cache.get(k)
  if ((hit && Date.now() - hit.at < TTL) || pending.has(k) || serverOff) return
  const now = Date.now()
  times = times.filter((t) => now - t < 60_000)
  if (times.length >= SPARK_PER_MIN) return
  times.push(now)
  pending.add(k)
  ask(x).catch(() => null).then((pts) => {
    pending.delete(k)
    cache.set(k, { at: Date.now(), pts })
    if (pts) listeners.forEach((f) => f())
  })
}

/** 给列表前 max 个有交易对的币拿走势线；返回 键 → 收盘价序列（只含真的拿到了的） */
export function useSparks(list: MarketToken[], max = 12): Map<string, number[]> {
  const [, tick] = useState(0)
  useEffect(() => { const f = () => tick((n) => n + 1); listeners.add(f); return () => { listeners.delete(f) } }, [])
  const want = list.filter((x) => x.pairAddress).slice(0, max)
  const sig = want.map(keyOf).join('|')
  useEffect(() => {
    // 后台只读服务器通道：后台「数据源」里服务器通道不可用时不问
    if (candleConfig().serverReady === false) return
    want.forEach(request)
  }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps
  const out = new Map<string, number[]>()
  for (const x of list) { const hit = cache.get(keyOf(x)); if (hit?.pts) out.set(keyOf(x), hit.pts) }
  return out
}
export const sparkKey = keyOf

/** 走势线：首尾比较定颜色；没有数据时什么都不画（由调用方留空） */
export function Spark({ pts, width = 88, height = 28 }: { pts: number[]; width?: number; height?: number }) {
  const min = Math.min(...pts), max = Math.max(...pts)
  const span = max - min || 1
  const step = width / (pts.length - 1)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(height - 2 - ((p - min) / span) * (height - 4)).toFixed(1)}`).join('')
  const up = pts[pts.length - 1] >= pts[0]
  return (
    <svg className={`tx-spark ${up ? 'up' : 'down'}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
