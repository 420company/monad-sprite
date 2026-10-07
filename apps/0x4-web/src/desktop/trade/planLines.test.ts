// Trade-plan lines on the K-line chart (2026-10-02 goat batch 1): which lines to draw, how to estimate PnL, how to block TP/SL placed on the wrong side, how to stagger labels.
import { describe, expect, it } from 'vitest'
import type { PerpOrder, PerpPosition } from '@/lib/aster'
import { buildPlan, estPnl, orderKind, placeLines, protectIssue, roundTick, scalePrices, slBeyondLiq, stretchRange, type PlanDraft } from './planLines'

const long: PerpPosition = { coin: 'BTC', size: 0.02, isLong: true, entryPx: 60000, positionValue: 1220, unrealizedPnl: 20, roe: 0.1, liquidationPx: 49000, marginUsed: 200, leverage: 6, isCross: false }
const short: PerpPosition = { ...long, isLong: false, liquidationPx: 71000, unrealizedPnl: -20, roe: -0.1 }
const order = (oid: number, trigger: string, px: number, isBuy = false, size = 0): PerpOrder => ({ oid, coin: 'BTC', isBuy, limitPx: px, size, timestamp: 1, trigger })
const ids = (l: { id: string }[]) => l.map((x) => x.id)

describe('交易计划线：算', () => {
  it('委托单分类：限价 / 止盈 / 止损，别的（追踪止损）不画', () => {
    expect([undefined, 'Limit', 'TAKE_PROFIT_MARKET', 'TAKE_PROFIT', 'STOP_MARKET', 'STOP', 'TRAILING_STOP_MARKET'].map((trigger) => orderKind({ trigger })))
      .toEqual(['limit', 'limit', 'tp', 'tp', 'sl', 'sl', 'other'])
  })

  it('预计盈亏：多单价格涨赚、空单价格跌赚；缺数量或开仓价不算', () => {
    expect(estPnl(true, 60000, 66000, 0.02)).toBeCloseTo(120)
    expect(estPnl(true, 60000, 57000, 0.02)).toBeCloseTo(-60)
    expect(estPnl(false, 60000, 57000, 0.02)).toBeCloseTo(60)
    expect(estPnl(true, 60000, 66000, 0)).toBeUndefined()
    expect(estPnl(true, 0, 66000, 1)).toBeUndefined()
  })

  it('按交易所精度取整', () => {
    expect(roundTick(60000.04, 1)).toBe(60000)
    expect(roundTick(0.00435449, 7)).toBe(0.0043545)
    expect(roundTick(12.3456, 0)).toBe(12)
  })

  it('止盈止损放错边：做多止盈要高于现价和入场价、止损要低于；做空反过来', () => {
    expect(protectIssue('tp', true, 61000, [60500])).toBeNull()
    expect(protectIssue('tp', true, 60500, [60500])).toBe('止盈价要高于当前价')
    expect(protectIssue('sl', true, 61000, [60500])).toBe('止损价要低于当前价')
    expect(protectIssue('sl', true, 59000, [60500])).toBeNull()
    expect(protectIssue('tp', false, 59000, [60500])).toBeNull()
    expect(protectIssue('tp', false, 61000, [60500])).toBe('止盈价要低于当前价')
    expect(protectIssue('sl', false, 59000, [60500])).toBe('止损价要高于当前价')
    // Limit long at 58000 (current 60500): TP at 59000 is above entry but below current — the exchange would trigger it immediately → block
    expect(protectIssue('tp', true, 59000, [60500, 58000])).toBe('止盈价要高于当前价')
    expect(protectIssue('sl', true, 59000, [60500, 58000])).toBe('止损价要低于当前价')
    expect(protectIssue('sl', true, 57000, [60500, 58000])).toBeNull()
    expect(protectIssue('tp', true, 0, [60500])).toBe('请输入价格')
    // Current price unavailable: don't block (the exchange validates itself)
    expect(protectIssue('tp', true, 1, [0])).toBeNull()
  })

  it('止损比强平价还远', () => {
    expect(slBeyondLiq(true, 48000, 49000)).toBe(true)
    expect(slBeyondLiq(true, 50000, 49000)).toBe(false)
    expect(slBeyondLiq(false, 72000, 71000)).toBe(true)
    expect(slBeyondLiq(true, 48000, null)).toBe(false)
  })
})

describe('交易计划线：该画哪些', () => {
  it('没有仓位、没填单：什么都不画', () => {
    expect(buildPlan({ mark: 60500, position: null, orders: [] })).toEqual([])
  })

  it('有仓位：开仓价 + 强平价；挂着的止盈止损带预计盈亏、能拖；限价单能撤不能拖；仓位线上只提示还没挂的那种', () => {
    const lines = buildPlan({ mark: 60500, position: long, orders: [order(1, 'TAKE_PROFIT_MARKET', 66000), order(2, 'Limit', 58000, true, 0.01), order(3, 'TRAILING_STOP_MARKET', 59000)] })
    expect(ids(lines)).toEqual(['o1', 'o2', 'pos', 'liq'])
    const tp = lines[0]
    expect(tp).toMatchObject({ role: 'tp', price: 66000, drag: true, oid: 1 })
    expect(tp.pnl).toBeCloseTo(120)
    expect(tp.pct).toBeCloseTo(0.6)
    expect(lines[1]).toMatchObject({ role: 'limit', isBuy: true, size: 0.01, oid: 2 })
    expect(lines[1].drag).toBeFalsy()
    expect(lines[2]).toMatchObject({ role: 'pos', price: 60000, pnl: 20, pct: 0.1, canAdd: ['sl'] })
    expect(lines[3]).toMatchObject({ role: 'liq', price: 49000 })
  })

  it('没有仓位时挂着的止盈止损（跟着限价单挂的）：画出来，但不能拖着改', () => {
    const lines = buildPlan({ mark: 60500, position: null, orders: [order(1, 'STOP_MARKET', 55000)] })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ role: 'sl', drag: false })
    expect(lines[0].pnl).toBeUndefined()
  })

  it('下单预览：入场价（限价才能拖）、止盈、止损、预估强平价；放错边的直接标出来；只减仓的单只画入场价', () => {
    const d: PlanDraft = { isLong: true, entry: 60500, isLimit: false, size: 0.01, margin: 121, liq: 50000, tp: 63000, sl: 61000 }
    const lines = buildPlan({ mark: 60500, orders: [], draft: d })
    expect(ids(lines)).toEqual(['d-entry', 'd-tp', 'd-sl', 'd-liq'])
    expect(lines[0]).toMatchObject({ role: 'draftEntry', drag: false })
    expect(lines[1].pnl).toBeCloseTo(25)
    expect(lines[1].issue).toBeUndefined()
    expect(lines[2].issue).toBe('止损价要低于当前价')
    expect(buildPlan({ mark: 60500, orders: [], draft: { ...d, isLimit: true } })[0].drag).toBe(true)
    // Stop further than the estimated liquidation price: warn
    expect(buildPlan({ mark: 60500, orders: [], draft: { ...d, sl: 49000 } })[2].issue).toBe('比强平价还远，会先被强平')
    // No size entered: draw lines only — no PnL math, no liquidation price
    const noSize = buildPlan({ mark: 60500, orders: [], draft: { ...d, size: 0, margin: 0, sl: undefined } })
    expect(ids(noSize)).toEqual(['d-entry', 'd-tp'])
    expect(noSize[1].pnl).toBeUndefined()
    expect(ids(buildPlan({ mark: 60500, orders: [], draft: { ...d, reduceOnly: true, liq: undefined } }))).toEqual(['d-entry'])
  })

  it('待确认的改动：排在最前；被改的旧单画淡；同一种不再提示「补挂」；空单的止损在上面', () => {
    const lines = buildPlan({ mark: 60500, position: short, orders: [order(7, 'STOP_MARKET', 65000, true)], pending: { kind: 'sl', px: 63000, oid: 7 } })
    expect(ids(lines)).toEqual(['pending', 'o7', 'pos', 'liq'])
    expect(lines[0]).toMatchObject({ role: 'pendingSl', price: 63000, drag: true, oid: 7 })
    expect(lines[0].pnl).toBeCloseTo(-60)
    expect(lines[0].issue).toBeUndefined()
    expect(lines[1].faded).toBe(true)
    expect(lines[2].canAdd).toEqual(['tp'])
    // New TP placed above the current price (short): flag the problem
    expect(buildPlan({ mark: 60500, position: short, orders: [], pending: { kind: 'tp', px: 61000 } })[0].issue).toBe('止盈价要低于当前价')
    // No position: pending ones aren't drawn
    expect(buildPlan({ mark: 60500, position: null, orders: [], pending: { kind: 'tp', px: 61000 } })).toEqual([])
  })
})

describe('交易计划线：摆到图上', () => {
  it('超出可见范围的标签贴边、线不画；挤在一起的往右错开；靠近顶部的标签让开开高低收；图表还没准备好的不画', () => {
    const placed = placeLines([{ id: 'a', y: 100 }, { id: 'b', y: 110 }, { id: 'c', y: 300 }, { id: 'd', y: -40 }, { id: 'e', y: 900 }, { id: 'f', y: null }, { id: 'g', y: 105 }, { id: 'h', y: 10 }], 400, { a: 120, b: 80 })
    const by = Object.fromEntries(placed.map((p) => [p.id, p]))
    expect(by.a).toMatchObject({ y: 100, chipY: 100, pinned: null, offset: 0 })
    expect(by.b).toMatchObject({ y: 110, offset: 126 })        // Yield to a's 120 + 6
    expect(by.g.offset).toBe(126 + 80 + 6)                    // Yield to b as well
    expect(by.c).toMatchObject({ y: 300, offset: 0 })
    expect(by.d).toMatchObject({ pinned: 'top', chipY: 36 })
    expect(by.e).toMatchObject({ pinned: 'bottom', chipY: 387 })
    expect(by.f).toBeUndefined()
    // Line in view but hugging the top: draw the line at 10 anyway, move the label down to 36, and yield to d which is also at the top
    expect(by.h).toMatchObject({ y: 10, chipY: 36, pinned: null, offset: 156 })
    expect(placeLines([{ id: 'a', y: 10 }], 0, {})).toEqual([])
  })

  it('一行排不下就换行：靠上的往下换，靠下的往上换', () => {
    const w = { a: 200, b: 200, c: 200, d: 200 }
    const top = placeLines([{ id: 'a', y: -5 }, { id: 'b', y: -9 }, { id: 'c', y: -1 }], 400, w, 420)
    expect(top.map((p) => [p.chipY, p.offset])).toEqual([[36, 0], [36, 206], [60, 0]])
    const bottom = placeLines([{ id: 'a', y: 999 }, { id: 'b', y: 999 }, { id: 'c', y: 999 }, { id: 'd', y: 999 }], 400, w, 420)
    expect(bottom.map((p) => [p.chipY, p.offset])).toEqual([[387, 0], [387, 206], [363, 0], [363, 206]])
  })

  it('自动缩放：把离得不远的线拉进可见范围，太远的和强平价不拉', () => {
    expect(stretchRange(100, 110, [112, 95, 121, 80, 0, 105])).toEqual({ min: 95, max: 112 })   // 121 and 80 exceed double height — don't pull
    expect(stretchRange(100, 110, [120, 90])).toEqual({ min: 90, max: 120 })                     // Exactly double: pull
    expect(stretchRange(100, 100, [120])).toEqual({ min: 100, max: 100 })
    const lines = buildPlan({ mark: 60500, position: long, orders: [order(1, 'TAKE_PROFIT_MARKET', 66000)], draft: { isLong: true, entry: 60500, isLimit: false, size: 0.01, margin: 100, liq: 50000 } })
    expect(scalePrices(lines).sort()).toEqual([60000, 60500, 66000])
  })
})
