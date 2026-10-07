// The "buy/sell pressure" under perp candles and the "large order" bubbles on the chart (2026-10-02 goat, second batch). All real exchange data; this module only computes:
//   · Buy/sell pressure: the candle API carries "taker buy volume" per candle; taker buys − taker sells = this candle's net buying; summing along the way gives the cumulative line.
//     Full history is available — it's not recorded only from when the page opened.
//   · Large orders: trades ranking in the top 2% by notional of the recent batch (each token's threshold is computed separately — BTC and small caps differ by orders of magnitude, so no hardcoded number).
//     Backfill the latest 1000 trades on page open (~30 min for BTC, 1–2 hours for small caps), then keep recording live; the exchange doesn't serve older large orders, so none appear on the chart.
//   · Bubbles aggregate per candle: at most one per direction per candle (summed notional, weighted average price, trade count) — otherwise dozens of bubbles would pile into a blob on hourly charts.
import type { Candle, Interval } from './aster'
import type { TapeTrade } from './asterBook'

export const INTERVAL_SEC: Record<Interval, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 }

export interface FlowPoint { time: number; /** This candle's net taker buying (USD; negative = net selling) */ delta: number; /** Cumulative from the chart's first candle to this one */ cum: number }

/** Per-candle net buying and cumulative. Returns empty when candles lack taker-buy volume (spot candles don't have it); callers don't draw this column */
export function flowOf(candles: Candle[]): FlowPoint[] {
  const out: FlowPoint[] = []
  let cum = 0
  for (const k of candles) {
    if (k.buyQuote === undefined || k.quoteVolume === undefined || !Number.isFinite(k.buyQuote) || !Number.isFinite(k.quoteVolume)) continue
    const delta = 2 * k.buyQuote - k.quoteVolume
    cum += delta
    out.push({ time: k.time, delta, cum })
  }
  return out
}

export interface BigTrade { id: number; time: number; px: number; usd: number; isBuy: boolean }

/** Large-order threshold: sort this batch of trades by notional ascending, take the q-th quantile; with too few samples (< 50 trades) or a too-small result, use minUsd */
export function bigThreshold(trades: Pick<TapeTrade, 'px' | 'sz'>[], q = 0.98, minUsd = 1000): number {
  if (trades.length < 50) return minUsd
  const usd = trades.map((x) => x.px * x.sz).sort((a, b) => a - b)
  return Math.max(minUsd, usd[Math.min(usd.length - 1, Math.floor(usd.length * q))])
}

/** Pick trades at or above the threshold */
export function pickBig(trades: TapeTrade[], min: number): BigTrade[] {
  if (!(min > 0)) return []
  const out: BigTrade[] = []
  for (const x of trades) { const usd = x.px * x.sz; if (usd >= min) out.push({ id: x.id, time: x.time, px: x.px, usd, isBuy: x.isBuy }) }
  return out
}

/** Merge new large orders into existing: dedupe by id, oldest-to-newest, keep at most max (drop the oldest). With nothing new, return as-is (reference unchanged, no UI repaint) */
export function mergeBig(cur: BigTrade[], add: BigTrade[], max = 500): BigTrade[] {
  if (!add.length) return cur
  const ids = new Set(cur.map((x) => x.id))
  const fresh = add.filter((x) => !ids.has(x.id) && (ids.add(x.id), true))
  if (!fresh.length) return cur
  return [...cur, ...fresh].sort((a, b) => a.time - b.time || a.id - b.id).slice(-max)
}

export interface Bubble { time: number; isBuy: boolean; usd: number; /** Notional-weighted average price */ px: number; n: number }

/** Aggregate per candle: time = the open time (seconds) of the candle containing the trade. Returns oldest-to-newest; buys before sells within one candle */
export function bubblesOf(big: BigTrade[], intervalSec: number): Bubble[] {
  const m = new Map<string, Bubble & { w: number }>()
  for (const x of big) {
    const time = Math.floor(x.time / 1000 / intervalSec) * intervalSec
    const key = `${time}:${x.isBuy ? 1 : 0}`
    const b = m.get(key)
    if (b) { b.usd += x.usd; b.w += x.px * x.usd; b.n++; b.px = b.w / b.usd }
    else m.set(key, { time, isBuy: x.isBuy, usd: x.usd, px: x.px, n: 1, w: x.px * x.usd })
  }
  return [...m.values()].map(({ w: _w, ...b }) => b).sort((a, b) => a.time - b.time || Number(b.isBuy) - Number(a.isBuy))
}

/** Bubble size (chart library marker multiplier): 1× just past the threshold, +0.45 per doubling of notional, max 3.2× */
export function bubbleSize(usd: number, min: number): number {
  if (!(min > 0) || !(usd > 0)) return 1
  return Math.max(1, Math.min(3.2, 1 + Math.log2(usd / min) * 0.45))
}

/** Patch the latest trade price into the last candle (candles refresh every 10s, which looks frozen on 1-minute charts): only close and high / low move; volume waits for the next refresh */
export function patchLast(candles: Candle[], last: number | undefined): Candle[] {
  const n = candles.length
  if (!n || !last || !(last > 0)) return candles
  const k = candles[n - 1]
  if (k.close === last) return candles
  return [...candles.slice(0, n - 1), { ...k, close: last, high: Math.max(k.high, last), low: Math.min(k.low, last) }]
}

/** Write amounts as $1.2M / $82.4K / $950 */
export function usdShort(n: number): string {
  const a = Math.abs(n)
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(0)
  return `$${s}`
}
