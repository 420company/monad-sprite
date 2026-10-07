// Sprite chart commentary (2026-10-02 goat, batch 3): organize the numbers already on the current chart into a brief, hand it to the server for the sprite to narrate (server/src/flyLook.ts).
// Only organizing here — no new numbers invented: candles, buy/sell pressure, and whale trades are all real exchange data; positions carry only ratios (PnL %, distance to liquidation %,
// whether TP/SL is set) — never amounts or values; account balances never enter the sprite's prompt.
import type { Candle } from './aster'
import type { BigTrade, FlowPoint } from './perpFlow'

export type BriefInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d'
const INTERVALS: readonly string[] = ['1m', '5m', '15m', '1h', '4h', '1d']

/** One-to-one with server/src/flyLook.ts's ChartBrief */
export interface ChartBrief {
  market: 'perp' | 'spot'
  symbol: string
  interval: BriefInterval
  bars: number
  last: number
  chgAll: number
  chgRecent: number
  hi: number
  lo: number
  upBars: number
  volRatio?: number
  flow?: { recent: number; all: number }
  big?: { buyUsd: number; buyN: number; sellUsd: number; sellN: number; minutes: number }
  position?: { isLong: boolean; lev: number; roe: number; liqDist?: number; hasTp: boolean; hasSl: boolean; tpDist?: number; slDist?: number }
}

export interface BriefInput {
  market: 'perp' | 'spot'
  symbol: string
  interval: string
  candles: Candle[]
  flow?: FlowPoint[] | null
  /** Whale trades and the records-since timestamp (ms); bigSince = 0 means backfill isn't done — the field is omitted then */
  big?: BigTrade[]
  bigSince?: number
  now?: number
  position?: { isLong: boolean; leverage: number; roe: number; liquidationPx: number | null } | null
  /** This position's already-placed take-profit / stop-loss trigger prices */
  tpPx?: number
  slPx?: number
}

const mean = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0
const round = (n: number, d = 6) => Number(n.toFixed(d))

/** Fewer than 5 candles (not loaded yet) or unknown interval: return null; the UI says "wait for the candles to load, then retry" */
export function buildBrief(i: BriefInput): ChartBrief | null {
  const c = i.candles
  const n = c.length
  if (n < 5 || !INTERVALS.includes(i.interval)) return null
  const last = c[n - 1].close
  if (!(last > 0) || !(c[0].open > 0)) return null
  const recent = c.slice(-10)
  const base = n > 10 ? c[n - 11].close : c[0].open
  let hi = -Infinity, lo = Infinity
  for (const k of c) { if (k.high > hi) hi = k.high; if (k.low < lo) lo = k.low }
  const out: ChartBrief = {
    market: i.market, symbol: i.symbol, interval: i.interval as BriefInterval, bars: n, last,
    chgAll: round(last / c[0].open - 1), chgRecent: round(base > 0 ? last / base - 1 : 0),
    hi, lo, upBars: recent.filter((k) => k.close > k.open).length,
  }
  if (n >= 25) {
    const prev = mean(c.slice(-25, -5).map((k) => k.volume))
    if (prev > 0) out.volRatio = round(mean(c.slice(-5).map((k) => k.volume)) / prev, 2)
  }
  if (i.market === 'perp' && i.flow && i.flow.length) {
    out.flow = { recent: Math.round(i.flow.slice(-10).reduce((s, f) => s + f.delta, 0)), all: Math.round(i.flow[i.flow.length - 1].cum) }
  }
  if (i.market === 'perp' && i.big && i.bigSince && i.bigSince > 0) {
    const now = i.now ?? Date.now()
    const b = { buyUsd: 0, buyN: 0, sellUsd: 0, sellN: 0, minutes: Math.max(1, Math.round((now - i.bigSince) / 60_000)) }
    for (const x of i.big) { if (x.isBuy) { b.buyUsd += x.usd; b.buyN++ } else { b.sellUsd += x.usd; b.sellN++ } }
    b.buyUsd = Math.round(b.buyUsd); b.sellUsd = Math.round(b.sellUsd)
    out.big = b
  }
  const p = i.position
  if (i.market === 'perp' && p) {
    const dist = (px: number | null | undefined) => px && px > 0 ? round(Math.abs(px - last) / last, 4) : undefined
    const hasTp = !!i.tpPx && i.tpPx > 0, hasSl = !!i.slPx && i.slPx > 0
    out.position = { isLong: p.isLong, lev: p.leverage, roe: round(p.roe, 4), hasTp, hasSl }
    const liqDist = dist(p.liquidationPx)
    if (liqDist !== undefined) out.position.liqDist = liqDist
    if (hasTp) out.position.tpDist = dist(i.tpPx)
    if (hasSl) out.position.slDist = dist(i.slPx)
  }
  return out
}
