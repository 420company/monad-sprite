// Market page mini sparklines (2026-09-29 goat: the market page felt "off somehow" — the previous version drew big charts for data-sparse tokens and they looked awful).
// Rules: only real data, only where it's cheap. Here we only read "already cached" 1h candles from the server candle channel
// (/api/candles?prefetch=1: the server only checks its cache — no vendor requests, no quota spent; only tokens others just viewed exist). Nothing fetched → nothing drawn, never fabricated.
// · At most SPARK_PER_MIN requests per minute (the server allows 60/min per IP — leave quota for the token detail page); results cached on-device for 5 minutes (misses cached too, to avoid repeat asks)
// · When the server says the candle channel is off (enabled:false): stop asking for this web session
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

/** Fetch sparklines for the first max tokens in the list that have pairs; returns key → close-price series (only ones actually obtained) */
export function useSparks(list: MarketToken[], max = 12): Map<string, number[]> {
  const [, tick] = useState(0)
  useEffect(() => { const f = () => tick((n) => n + 1); listeners.add(f); return () => { listeners.delete(f) } }, [])
  const want = list.filter((x) => x.pairAddress).slice(0, max)
  const sig = want.map(keyOf).join('|')
  useEffect(() => {
    // Background reads the server channel only: skip when the backend "Data sources" marks the server channel unavailable
    if (candleConfig().serverReady === false) return
    want.forEach(request)
  }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps
  const out = new Map<string, number[]>()
  for (const x of list) { const hit = cache.get(keyOf(x)); if (hit?.pts) out.set(keyOf(x), hit.pts) }
  return out
}
export const sparkKey = keyOf

/** Sparkline: color from first-vs-last comparison; draw nothing without data (the caller leaves the space) */
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
