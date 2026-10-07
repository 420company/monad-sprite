// 合约 K 线下面的「买卖力量」和图上的「大单」气泡（2026-10-02 goat 第二批）。全是交易所的真实数据，这里只做计算：
//   · 买卖力量：K 线接口每根都带「主动买入的成交额」，主动买入 − 主动卖出 = 这一根的净买入；一路加起来就是累计线。
//     有完整历史，不是从打开页面起才开始记。
//   · 大单：逐笔成交里金额排在最近一批前 2% 的单（每个币的门槛自己算，BTC 和小币差几个数量级，不能写死一个数）。
//     打开页面时回补最近 1000 笔（BTC 大约半小时，小币一两个小时），之后实时接着记；更早的大单交易所不给，图上就没有。
//   · 气泡按 K 线聚合：每根 K 线每个方向最多一个（金额合计、加权均价、笔数），不然一小时线上几十个泡叠成一坨。
import type { Candle, Interval } from './aster'
import type { TapeTrade } from './asterBook'

export const INTERVAL_SEC: Record<Interval, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 }

export interface FlowPoint { time: number; /** 这一根的净主动买入（美元，负数 = 净卖出） */ delta: number; /** 从图上第一根累计到这一根 */ cum: number }

/** 每根 K 线的净买入和累计。K 线不带主动买入额（现货的 K 线没有）就返回空，调用方不画这一栏 */
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

/** 大单门槛：这批成交按金额从小到大排，取第 q 分位；样本太少（不到 50 笔）或算出来太小，按 minUsd */
export function bigThreshold(trades: Pick<TapeTrade, 'px' | 'sz'>[], q = 0.98, minUsd = 1000): number {
  if (trades.length < 50) return minUsd
  const usd = trades.map((x) => x.px * x.sz).sort((a, b) => a - b)
  return Math.max(minUsd, usd[Math.min(usd.length - 1, Math.floor(usd.length * q))])
}

/** 挑出不小于门槛的成交 */
export function pickBig(trades: TapeTrade[], min: number): BigTrade[] {
  if (!(min > 0)) return []
  const out: BigTrade[] = []
  for (const x of trades) { const usd = x.px * x.sz; if (usd >= min) out.push({ id: x.id, time: x.time, px: x.px, usd, isBuy: x.isBuy }) }
  return out
}

/** 新来的大单并进已有的：按 id 去重，按时间从早到晚，最多留 max 笔（丢最早的）。没有新的就原样返回（引用不变，界面不重画） */
export function mergeBig(cur: BigTrade[], add: BigTrade[], max = 500): BigTrade[] {
  if (!add.length) return cur
  const ids = new Set(cur.map((x) => x.id))
  const fresh = add.filter((x) => !ids.has(x.id) && (ids.add(x.id), true))
  if (!fresh.length) return cur
  return [...cur, ...fresh].sort((a, b) => a.time - b.time || a.id - b.id).slice(-max)
}

export interface Bubble { time: number; isBuy: boolean; usd: number; /** 按金额加权的均价 */ px: number; n: number }

/** 按 K 线聚合：time = 这笔成交所在那根 K 线的开盘时间（秒）。返回按时间从早到晚，同一根里先买后卖 */
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

/** 气泡画多大（图表库的标记倍数）：刚过门槛 1 倍，金额每翻一倍大 0.45，最大 3.2 倍 */
export function bubbleSize(usd: number, min: number): number {
  if (!(min > 0) || !(usd > 0)) return 1
  return Math.max(1, Math.min(3.2, 1 + Math.log2(usd / min) * 0.45))
}

/** 把最新成交价补进最后一根 K 线（K 线 10 秒才刷新一次，1 分钟线上看着像卡住）：只动收盘价和最高 / 最低，成交量等下一次刷新 */
export function patchLast(candles: Candle[], last: number | undefined): Candle[] {
  const n = candles.length
  if (!n || !last || !(last > 0)) return candles
  const k = candles[n - 1]
  if (k.close === last) return candles
  return [...candles.slice(0, n - 1), { ...k, close: last, high: Math.max(k.high, last), low: Math.min(k.low, last) }]
}

/** 金额写成 $1.2M / $82.4K / $950 */
export function usdShort(n: number): string {
  const a = Math.abs(n)
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(0)
  return `$${s}`
}
