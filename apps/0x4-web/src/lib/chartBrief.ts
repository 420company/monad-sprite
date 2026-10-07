// 小精灵看图点评（2026-10-02 goat 第三批）：把当前这张图上已经有的数字整理成一份摘要，交给服务器让小精灵去说（server/src/flyLook.ts）。
// 这里只做整理，不新造数字：K 线、买卖力量、大单都是交易所的真实数据；仓位只带比例（浮盈百分之几、离强平百分之几、
// 止盈止损设了没有），不带数量和金额——账户金额不进小精灵的提示词。
import type { Candle } from './aster'
import type { BigTrade, FlowPoint } from './perpFlow'

export type BriefInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d'
const INTERVALS: readonly string[] = ['1m', '5m', '15m', '1h', '4h', '1d']

/** 和 server/src/flyLook.ts 的 ChartBrief 一一对应 */
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
  /** 大单和从什么时候起有记录（毫秒）；bigSince = 0 表示还没回补到，这一项就不带 */
  big?: BigTrade[]
  bigSince?: number
  now?: number
  position?: { isLong: boolean; leverage: number; roe: number; liquidationPx: number | null } | null
  /** 这个仓位已经挂着的止盈 / 止损触发价 */
  tpPx?: number
  slPx?: number
}

const mean = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0
const round = (n: number, d = 6) => Number(n.toFixed(d))

/** K 线不到 5 根（还没加载出来）或周期不认识：返回 null，界面上说「等 K 线加载出来再试」 */
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
