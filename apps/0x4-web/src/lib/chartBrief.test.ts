// The sprite's chart-review summary (2026-10-02 goat, third batch): only organizes numbers already on the chart; positions carry ratios only.
import { describe, expect, it } from 'vitest'
import type { Candle } from './aster'
import { buildBrief } from './chartBrief'

/** n candles: closes rise +1 per candle from 100, even candles close up, odd ones down a touch; volume 10 for the first ones, 30 for the last 5 */
const candles = (n: number): Candle[] => Array.from({ length: n }, (_, i) => {
  const close = 100 + i
  return { time: 60 * i, open: i % 2 === 0 ? close - 1 : close + 0.5, high: close + 2, low: close - 2, close, volume: i >= n - 5 ? 30 : 10 }
})

describe('看图摘要', () => {
  it('K 线太少或周期不认识：不出摘要', () => {
    expect(buildBrief({ market: 'perp', symbol: 'BTC', interval: '1h', candles: candles(4) })).toBeNull()
    expect(buildBrief({ market: 'perp', symbol: 'BTC', interval: '2h', candles: candles(50) })).toBeNull()
    expect(buildBrief({ market: 'perp', symbol: 'BTC', interval: '1h', candles: [] })).toBeNull()
  })

  it('涨跌、区间、收涨根数、放量倍数', () => {
    const b = buildBrief({ market: 'spot', symbol: 'WIF', interval: '15m', candles: candles(40) })!
    expect(b).toMatchObject({ market: 'spot', symbol: 'WIF', interval: '15m', bars: 40, last: 139, hi: 141, lo: 98, upBars: 5, volRatio: 3 })
    expect(b.chgAll).toBeCloseTo(139 / 99 - 1, 5)          // First candle opens at 99
    expect(b.chgRecent).toBeCloseTo(139 / 129 - 1, 5)      // The 11th candle back closes at 129
    // Spot: no buy/sell pressure, large orders, or positions (even when passed)
    const s = buildBrief({ market: 'spot', symbol: 'WIF', interval: '15m', candles: candles(40), flow: [{ time: 1, delta: 5, cum: 5 }], big: [], bigSince: 1, position: { isLong: true, leverage: 3, roe: 0.1, liquidationPx: 90 } })!
    expect(s.flow).toBeUndefined(); expect(s.big).toBeUndefined(); expect(s.position).toBeUndefined()
    // Fewer than 25 candles: no volume-surge multiple
    expect(buildBrief({ market: 'spot', symbol: 'WIF', interval: '15m', candles: candles(20) })!.volRatio).toBeUndefined()
  })

  it('合约：买卖力量取最近 10 根和累计；大单按方向合计；还没回补到大单就不带', () => {
    const flow = Array.from({ length: 30 }, (_, i) => ({ time: i, delta: i < 20 ? 100 : -50, cum: i < 20 ? (i + 1) * 100 : 2000 - (i - 19) * 50 }))
    const big = [{ id: 1, time: 1, px: 100, usd: 1000.4, isBuy: true }, { id: 2, time: 2, px: 100, usd: 2000, isBuy: false }, { id: 3, time: 3, px: 100, usd: 500, isBuy: false }]
    const b = buildBrief({ market: 'perp', symbol: 'BTC', interval: '1m', candles: candles(30), flow, big, bigSince: 1_000_000, now: 1_000_000 + 38 * 60_000 + 20_000 })!
    expect(b.flow).toEqual({ recent: -500, all: 1500 })
    expect(b.big).toEqual({ buyUsd: 1000, buyN: 1, sellUsd: 2500, sellN: 2, minutes: 38 })
    expect(buildBrief({ market: 'perp', symbol: 'BTC', interval: '1m', candles: candles(30), big, bigSince: 0 })!.big).toBeUndefined()
    expect(buildBrief({ market: 'perp', symbol: 'BTC', interval: '1m', candles: candles(30), flow: [] })!.flow).toBeUndefined()
  })

  it('仓位只带比例：浮盈、离强平 / 止盈 / 止损的距离；没有数量和金额', () => {
    const b = buildBrief({ market: 'perp', symbol: 'BTC', interval: '1h', candles: candles(30), position: { isLong: true, leverage: 10, roe: 0.15234, liquidationPx: 116.1 }, tpPx: 135.45, slPx: 0 })!
    expect(b.last).toBe(129)
    expect(b.position).toEqual({ isLong: true, lev: 10, roe: 0.1523, liqDist: 0.1, hasTp: true, hasSl: false, tpDist: 0.05 })
    expect(JSON.stringify(b.position)).not.toMatch(/size|usd|margin|entry/i)
    // No distance shown when an isolated position has no liquidation price
    expect(buildBrief({ market: 'perp', symbol: 'BTC', interval: '1h', candles: candles(30), position: { isLong: false, leverage: 3, roe: -0.02, liquidationPx: null } })!.position).toEqual({ isLong: false, lev: 3, roe: -0.02, hasTp: false, hasSl: false })
  })
})
