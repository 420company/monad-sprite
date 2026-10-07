// 买卖力量和大单气泡（2026-10-02 goat 第二批）：净买入怎么算、大单门槛、按 K 线聚合、最后一根补最新价。
import { describe, expect, it } from 'vitest'
import type { Candle } from './aster'
import type { TapeTrade } from './asterBook'
import { bigThreshold, bubbleSize, bubblesOf, flowOf, mergeBig, patchLast, pickBig, usdShort } from './perpFlow'

const k = (time: number, quoteVolume?: number, buyQuote?: number, close = 100): Candle => ({ time, open: 100, high: 101, low: 99, close, volume: 1, quoteVolume, buyQuote })
const tr = (id: number, time: number, px: number, sz: number, isBuy: boolean): TapeTrade => ({ id, time, px, sz, isBuy })

describe('买卖力量', () => {
  it('净买入 = 主动买入 − 主动卖出，累计一路相加；不带主动买入额的 K 线跳过', () => {
    const f = flowOf([k(60, 1000, 700), k(120, 500, 100), k(180), k(240, 200, 100)])
    expect(f).toEqual([{ time: 60, delta: 400, cum: 400 }, { time: 120, delta: -300, cum: 100 }, { time: 240, delta: 0, cum: 100 }])
    expect(flowOf([k(60), k(120)])).toEqual([])
  })
})

describe('大单', () => {
  it('门槛按最近成交的金额分位算：样本少于 50 笔或算出来太小，用最低门槛', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ px: 10, sz: i + 1 }))   // 金额 10..1000
    expect(bigThreshold(many, 0.98, 100)).toBe(990)
    expect(bigThreshold(many, 0.98, 5000)).toBe(5000)
    expect(bigThreshold(many.slice(0, 49), 0.98, 1000)).toBe(1000)
  })

  it('挑大单、并进已有的（去重、按时间排、有上限、没新的引用不变）', () => {
    const trades = [tr(1, 1000, 10, 5, true), tr(2, 2000, 10, 200, false), tr(3, 3000, 10, 300, true)]
    const big = pickBig(trades, 2000)
    expect(big.map((x) => [x.id, x.usd, x.isBuy])).toEqual([[2, 2000, false], [3, 3000, true]])
    expect(pickBig(trades, 0)).toEqual([])
    expect(mergeBig(big, big)).toBe(big)
    expect(mergeBig(big, [])).toBe(big)
    const more = mergeBig(big, [{ id: 9, time: 2500, px: 10, usd: 5000, isBuy: true }, big[0]])
    expect(more.map((x) => x.id)).toEqual([2, 9, 3])
    expect(mergeBig(more, [{ id: 10, time: 9000, px: 1, usd: 9, isBuy: true }], 2).map((x) => x.id)).toEqual([3, 10])
  })

  it('按 K 线聚合：每根每个方向一个泡，金额相加、均价按金额加权；同一根先买后卖', () => {
    const big = [
      { id: 1, time: 61_000, px: 100, usd: 1000, isBuy: true },
      { id: 2, time: 119_000, px: 110, usd: 3000, isBuy: true },
      { id: 3, time: 90_000, px: 105, usd: 500, isBuy: false },
      { id: 4, time: 125_000, px: 120, usd: 700, isBuy: false },
    ]
    expect(bubblesOf(big, 60)).toEqual([
      { time: 60, isBuy: true, usd: 4000, px: 107.5, n: 2 },
      { time: 60, isBuy: false, usd: 500, px: 105, n: 1 },
      { time: 120, isBuy: false, usd: 700, px: 120, n: 1 },
    ])
    // 换成 5 分钟线：四笔都在同一根里
    expect(bubblesOf(big, 300).map((b) => [b.time, b.isBuy, b.usd, b.n])).toEqual([[0, true, 4000, 2], [0, false, 1200, 2]])
  })

  it('气泡大小：刚过门槛 1 倍，越大越大，有上限', () => {
    expect(bubbleSize(1000, 1000)).toBe(1)
    expect(bubbleSize(4000, 1000)).toBeCloseTo(1.9)
    expect(bubbleSize(1e12, 1000)).toBe(3.2)
    expect(bubbleSize(500, 0)).toBe(1)
  })
})

describe('最后一根补最新价', () => {
  it('只动收盘价和最高 / 最低；价格没变或没有价格时原样返回', () => {
    const c = [k(60, 1, 1), k(120, 1, 1, 100)]
    expect(patchLast(c, 100)).toBe(c)
    expect(patchLast(c, undefined)).toBe(c)
    expect(patchLast([], 5)).toEqual([])
    const up = patchLast(c, 103)
    expect(up[1]).toMatchObject({ close: 103, high: 103, low: 99, open: 100 })
    expect(up[0]).toBe(c[0])
    expect(patchLast(c, 98)[1]).toMatchObject({ close: 98, high: 101, low: 98 })
  })
})

it('金额缩写', () => {
  expect([950, 82_400, 1_234_000, 2_500_000_000, -82_400].map(usdShort)).toEqual(['$950', '$82.4K', '$1.23M', '$2.50B', '$82.4K'])
})
