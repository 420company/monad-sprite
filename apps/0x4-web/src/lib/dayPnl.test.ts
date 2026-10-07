// Today's PnL ledger (2026-09-29 goat: "money topped up shouldn't count in total profit and loss"):
// Each case pins "transfers in/out don't count as PnL", each with a control (showing how wrong the total-assets-difference math would be) — proving the test really distinguishes the two algorithms.
import { describe, expect, it } from 'vitest'
import { MIN_BASE, observe, pnlSign, startOfDayCst, summarize, type Ledger, type Obs, type PerpPart } from './dayPnl'

// 2026-09-29 10:00 Beijing time (02:00 UTC)
const T0 = Date.UTC(2026, 8, 29, 2, 0)
const DAY = startOfDayCst(T0)
const A = '56:0xaaa', B = '56:0xbbb', USDT = '56:0x55d', SOLTOK = '1151111081099710:Tok'
const all = () => true
const none = () => false
/** The naive "current total − starting total" math: top-ups and withdrawals all count as PnL */
const naive = (before: Obs[], after: Obs[]) => after.reduce((s, a) => s + a.q * a.p, 0) - before.reduce((s, a) => s + a.q * a.p, 0)

/** A ledger carried over from yesterday with a known midnight price */
function dayStart(last: Ledger['last'], open: Record<string, number>, now = T0): Ledger {
  const y: Ledger = { v: 1, day: DAY - 86400_000, pnl: 0, base: 0, inflow: 0, outflow: 0, partial: [], pending: {}, last, t: DAY - 3600_000 }
  return observe(y, { now, assets: [], fresh: none, open })
}

describe('北京时间 0 点换日', () => {
  it('UTC 15:59:59 还是当天，16:00 起是新的一天', () => {
    const endOfDay = Date.UTC(2026, 8, 29, 15, 59, 59)
    expect(startOfDayCst(endOfDay)).toBe(DAY)
    expect(startOfDayCst(endOfDay + 1000)).toBe(DAY + 86400_000)
    expect(DAY).toBe(Date.UTC(2026, 8, 28, 16, 0))
  })

  it('换日后用前一天最后的数量 × 服务器 0 点价当起点，昨天的涨跌不带进今天', () => {
    const L = dayStart({ [A]: { q: 10, p: 1 } }, { [A]: 2 })
    expect(L.day).toBe(DAY)
    expect(L.base).toBe(20)
    const L2 = observe(L, { now: T0 + 60_000, assets: [{ key: A, q: 10, p: 3 }], fresh: all })
    expect(L2.pnl).toBe(10) // Rose from the midnight price of 2 to 3
    // Control: starting from yesterday's last price of 1 would give 20
    expect(10 * (3 - 1)).toBe(20)
  })

  it('服务器没记到 0 点价：这个币从今天第一次读到时起算，面板注明', () => {
    const L = dayStart({ [A]: { q: 10, p: 1 } }, {})
    expect(L.pending[A]).toBe(10)
    const L2 = observe(L, { now: T0, assets: [{ key: A, q: 10, p: 3 }], fresh: all })
    expect(L2.base).toBe(30)
    expect(L2.pnl).toBe(0)
    expect(L2.partial).toEqual([A])
    const L3 = observe(L2, { now: T0 + 60_000, assets: [{ key: A, q: 10, p: 3.5 }], fresh: all })
    expect(L3.pnl).toBe(5)
  })

  it('跨过 0 点还没刷新：昨天的账本不当成今天显示', () => {
    const L = observe(null, { now: T0, assets: [{ key: A, q: 1, p: 1 }], fresh: all })
    expect(summarize(L, null, T0)).not.toBeNull()
    expect(summarize(L, null, DAY + 86400_000 + 60_000)).toBeNull()
  })

  it('这台设备第一次打开：现有的币从现在起算（不知道 0 点时有没有），盈亏从 0 开始', () => {
    const L = observe(null, { now: T0, assets: [{ key: A, q: 10, p: 2 }, { key: USDT, q: 50, p: 1, stable: true }], fresh: all })
    expect(L.base).toBe(70)
    expect(L.pnl).toBe(0)
    expect(L.inflow).toBe(0) // Not a top-up
    expect(L.partial.sort()).toEqual([A, USDT].sort())
  })
})

describe('1. 充值 / 从别的钱包转入：不算盈利，转入后的涨跌才算', () => {
  it('持有 10 个，涨价同时转入 5 个：只有原来 10 个的涨价算盈亏', () => {
    const L = dayStart({ [A]: { q: 10, p: 1 } }, { [A]: 1 })
    const after = [{ key: A, q: 15, p: 2 }]
    const L2 = observe(L, { now: T0, assets: after, fresh: all })
    expect(L2.pnl).toBe(10)
    expect(L2.inflow).toBe(10) // 5 units × transfer-time price of 2
    // Control: total-difference math = 15×2 − 10×1 = 20, counting the top-up as profit
    expect(naive([{ key: A, q: 10, p: 1 }], after)).toBe(20)
    // Rising after the transfer: all 15 count
    const L3 = observe(L2, { now: T0 + 60_000, assets: [{ key: A, q: 15, p: 3 }], fresh: all })
    expect(L3.pnl).toBe(25)
  })

  it('充值稳定币：一分钱盈亏都没有', () => {
    const L = dayStart({ [USDT]: { q: 100, p: 1, s: 1 } }, {})
    const L2 = observe(L, { now: T0, assets: [{ key: USDT, q: 1100, p: 1, stable: true }], fresh: all })
    expect(L2.pnl).toBe(0)
    expect(L2.inflow).toBe(1000)
    expect(naive([{ key: USDT, q: 100, p: 1 }], [{ key: USDT, q: 1100, p: 1 }])).toBe(1000)
  })
})

describe('2. 提现 / 转出给别人：不算亏损，转出前的涨跌照算', () => {
  it('先涨后全部转走：涨的那段保留，转走本身不算亏', () => {
    const L = dayStart({ [A]: { q: 10, p: 1 } }, { [A]: 1 })
    const L2 = observe(L, { now: T0, assets: [{ key: A, q: 10, p: 2 }], fresh: all })
    expect(L2.pnl).toBe(10)
    const L3 = observe(L2, { now: T0 + 60_000, assets: [], fresh: all })
    expect(L3.pnl).toBe(10)
    expect(L3.outflow).toBe(20)
    // Control: total-difference math = 0 − 20 = −20
    expect(naive([{ key: A, q: 10, p: 2 }], [])).toBe(-20)
  })

  it('转走一部分同时涨价：留下的那部分涨价算盈亏', () => {
    const L = dayStart({ [A]: { q: 10, p: 2 } }, { [A]: 2 })
    const L2 = observe(L, { now: T0, assets: [{ key: A, q: 4, p: 3 }], fresh: all })
    expect(L2.pnl).toBe(4)
    expect(L2.outflow).toBe(18)
    expect(naive([{ key: A, q: 10, p: 2 }], [{ key: A, q: 4, p: 3 }])).toBe(-8)
  })

  it('这条链这次没读到：不当成转走（阴性对照：读到了而列表里没有才算转出）', () => {
    const L = dayStart({ [A]: { q: 10, p: 1 } }, { [A]: 1 })
    const stale = observe(L, { now: T0, assets: [], fresh: none })
    expect(stale.outflow).toBe(0)
    expect(stale.last[A].q).toBe(10)
    const gone = observe(L, { now: T0, assets: [], fresh: all })
    expect(gone.outflow).toBe(10)
  })

  it('这次没拿到价格：不算（不会把价格 0 当成跌到 0）', () => {
    const L = dayStart({ [A]: { q: 10, p: 2 } }, { [A]: 2 })
    const L2 = observe(L, { now: T0, assets: [{ key: A, q: 10, p: 0 }], fresh: all })
    expect(L2.pnl).toBe(0)
    expect(L2.outflow).toBe(0)
    expect(L2.last[A]).toEqual({ q: 10, p: 2 })
  })
})

describe('3. 自己钱包内闪兑、跨链、补燃料费：只是换形态，不算盈亏', () => {
  it('A 全部换成 B（手续费和滑点 0.2 美元）：盈亏不变，手续费不算成亏损', () => {
    const L = dayStart({ [A]: { q: 10, p: 2 } }, { [A]: 2 })
    const L2 = observe(L, { now: T0, assets: [{ key: B, q: 19.8, p: 1 }], fresh: all })
    expect(L2.pnl).toBe(0)
    expect(L2.outflow).toBe(20)
    expect(L2.inflow).toBeCloseTo(19.8)
    // Control: total-difference math would show −0.2
    expect(naive([{ key: A, q: 10, p: 2 }], [{ key: B, q: 19.8, p: 1 }])).toBeCloseTo(-0.2)
    // Only counts once B rises afterwards
    const L3 = observe(L2, { now: T0 + 60_000, assets: [{ key: B, q: 19.8, p: 1.1 }], fresh: all })
    expect(L3.pnl).toBeCloseTo(1.98)
  })

  it('跨链：BSC 上的币少了、另一条链多了，两边分开记转出转入', () => {
    const SOLUSDC = '1151111081099710:USDC'
    const L = dayStart({ [USDT]: { q: 50, p: 1, s: 1 } }, {})
    const L2 = observe(L, { now: T0, assets: [{ key: USDT, q: 30, p: 1, stable: true }, { key: SOLUSDC, q: 19.9, p: 1, stable: true }], fresh: all })
    expect(L2.pnl).toBe(0)
    expect(L2.outflow).toBe(20)
    expect(L2.inflow).toBeCloseTo(19.9)
  })

  it('稳定币报价抖动（0.999 ~ 1.001）不显示成盈亏', () => {
    const L = dayStart({ [USDT]: { q: 10_000, p: 1, s: 1 } }, {})
    const L2 = observe(L, { now: T0, assets: [{ key: USDT, q: 10_000, p: 1.001, stable: true }], fresh: all })
    expect(L2.pnl).toBe(0)
    // Control: not starting at 1 would show +10
    expect(10_000 * (1.001 - 1)).toBeCloseTo(10)
  })
})

describe('4. 收到空投、别人打赏或转来的币：算转入，不算盈利', () => {
  it('新出现的币整笔记转入；之后的涨跌才算', () => {
    const L = dayStart({}, {})
    const L2 = observe(L, { now: T0, assets: [{ key: SOLTOK, q: 1000, p: 0.01 }], fresh: all })
    expect(L2.pnl).toBe(0)
    expect(L2.inflow).toBe(10)
    expect(naive([], [{ key: SOLTOK, q: 1000, p: 0.01 }])).toBe(10)
    const L3 = observe(L2, { now: T0 + 60_000, assets: [{ key: SOLTOK, q: 1000, p: 0.02 }], fresh: all })
    expect(L3.pnl).toBe(10)
  })

  it('一直没有报价的币后来有了报价：当成转入，不把「有了价格」算成盈利', () => {
    const L = dayStart({}, {})
    const L2 = observe(L, { now: T0, assets: [{ key: SOLTOK, q: 1000, p: 0 }], fresh: all })
    expect(L2.inflow).toBe(0)
    const L3 = observe(L2, { now: T0 + 60_000, assets: [{ key: SOLTOK, q: 1000, p: 0.5 }], fresh: all })
    expect(L3.pnl).toBe(0)
    expect(L3.inflow).toBe(500)
  })
})

describe('5. 合约：存取 USDT 不算盈亏（服务器算好合约部分，这里合并）', () => {
  it('钱包 USDT 转进合约账户：钱包记转出、合约记净转入，合起来分母不变、盈亏不变', () => {
    const L = dayStart({ [USDT]: { q: 1000, p: 1, s: 1 } }, {})
    const L2 = observe(L, { now: T0, assets: [{ key: USDT, q: 900, p: 1, stable: true }], fresh: all })
    const perp: PerpPart = { pnl: 0, base: 0, netIn: 100, equity: 100, since: DAY }
    const s = summarize(L2, perp, T0)!
    expect(s.pnl).toBe(0)
    expect(s.pct).toBe(0)
    // denominator = midnight assets 1000 + perps 0 + net transfers max(0, −100 + 100) = 1000
    const s2 = summarize(L2, { ...perp, pnl: 10 }, T0)!
    expect(s2.pct).toBeCloseTo(1)
  })

  it('合约读不到：合约部分不显示（不是 0），只显示钱包', () => {
    const L = dayStart({ [A]: { q: 10, p: 1 } }, { [A]: 1 })
    const s = summarize(observe(L, { now: T0, assets: [{ key: A, q: 10, p: 2 }], fresh: all }), null, T0)!
    expect(s.perp).toBeNull()
    expect(s.pnl).toBe(10)
    // Negative control: when readable, the perps part appears and merges into the total
    const s2 = summarize(observe(L, { now: T0, assets: [{ key: A, q: 10, p: 2 }], fresh: all }), { pnl: -3, base: 50, netIn: 0, equity: 47, since: DAY }, T0)!
    expect(s2.perp?.pnl).toBe(-3)
    expect(s2.pnl).toBe(7)
  })

  it('合约起点晚于 0 点 15 分钟以上：标出来，面板注明从几点起算', () => {
    expect(summarize(null, { pnl: 1, base: 10, netIn: 0, equity: 11, since: DAY + 5 * 60_000 }, T0)!.perp!.late).toBe(false)
    expect(summarize(null, { pnl: 1, base: 10, netIn: 0, equity: 11, since: DAY + 3 * 3600_000 }, T0)!.perp!.late).toBe(true)
    // Yesterday's perps data doesn't count as today's
    expect(summarize(null, { pnl: 1, base: 10, netIn: 0, equity: 11, since: DAY - 60_000 }, T0)).toBeNull()
  })
})

describe('6. 百分比 = 今日盈亏 ÷（0 点资产 + 当天净转入）', () => {
  it('0 点 100、涨到 150 且没有转入：+50、+50%', () => {
    const L = dayStart({ [A]: { q: 100, p: 1 } }, { [A]: 1 })
    const s = summarize(observe(L, { now: T0, assets: [{ key: A, q: 100, p: 1.5 }], fresh: all }), null, T0)!
    expect(s.pnl).toBe(50)
    expect(s.pct).toBe(50)
  })

  it('0 点 100、当天又充值 100 后涨 10%：分母 200，不是 100', () => {
    const L = dayStart({ [USDT]: { q: 100, p: 1, s: 1 }, [A]: { q: 0, p: 1 } }, {})
    const L2 = observe(L, { now: T0, assets: [{ key: USDT, q: 100, p: 1, stable: true }, { key: A, q: 100, p: 1 }], fresh: all })
    const L3 = observe(L2, { now: T0 + 60_000, assets: [{ key: USDT, q: 100, p: 1, stable: true }, { key: A, q: 100, p: 1.2 }], fresh: all })
    const s = summarize(L3, null, T0)!
    expect(s.pnl).toBeCloseTo(20)
    expect(s.pct).toBeCloseTo(10)
  })

  it('净转出不把分母压小（转走大部分后百分比不会被放大）', () => {
    const L = dayStart({ [A]: { q: 100, p: 1 } }, { [A]: 1 })
    const L2 = observe(L, { now: T0, assets: [{ key: A, q: 100, p: 1.1 }], fresh: all })
    const L3 = observe(L2, { now: T0 + 60_000, assets: [{ key: A, q: 10, p: 1.1 }], fresh: all })
    const s = summarize(L3, null, T0)!
    expect(s.pnl).toBeCloseTo(10)
    expect(s.pct).toBeCloseTo(10) // The denominator is still 100
  })

  it(`分母不到 ${MIN_BASE} 美元不显示百分比；分母够了照常显示`, () => {
    const L = dayStart({ [A]: { q: 1, p: 0.5 } }, { [A]: 0.5 })
    const tiny = summarize(observe(L, { now: T0, assets: [{ key: A, q: 1, p: 25 }], fresh: all }), null, T0)!
    expect(tiny.pnl).toBe(24.5)
    expect(tiny.pct).toBeNull() // Control: dividing directly would give +4900%
    expect((24.5 / 0.5) * 100).toBe(4900)
    // Almost nothing at midnight, but 1000 was topped up during the day: denominator counts as 1000, displayed as usual
    const L2 = observe(dayStart({}, {}), { now: T0, assets: [{ key: A, q: 1000, p: 1 }], fresh: all })
    const s = summarize(observe(L2, { now: T0 + 60_000, assets: [{ key: A, q: 1000, p: 1.05 }], fresh: all }), null, T0)!
    expect(s.pct).toBeCloseTo(5)
  })

  it('不到半分钱算零（中性色），正负号按金额走', () => {
    expect(pnlSign(0.004)).toBe(0)
    expect(pnlSign(-0.004)).toBe(0)
    expect(pnlSign(0.01)).toBe(1)
    expect(pnlSign(-0.01)).toBe(-1)
  })
})
