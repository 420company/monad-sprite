// @vitest-environment jsdom
// Web (extension wallet) contract writes (2026-09-30): lib/aster.ts hands all actions of one order to the extension's perpWrite together,
// Verify: action composition and order, unplaced TP/SL reported truthfully, main-order failure errors with the exchange's original message, authorize-then-resend-the-batch when unauthorized (orders already placed are not resent),
// Cancelling orders and changing leverage also go through the extension; the phone app's wallet (no ox4PerpWrite) is unaffected. Also verifies the whitelist and lib/aster.ts's fee constants are the same copy.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import type { Account } from 'viem'
import { BUILDER, BUILDER_FEE, cancelOrder, placeOrder, setLeverage, setProtection, type PerpMarket } from './aster'
import { BUILDER as WL_BUILDER, BUILDER_FEE as WL_FEE, perpWriteBatch, type PerpWriteAction, type PerpWriteResult } from './asterPerpWrite'

const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const market: PerpMarket = { index: 0, coin: 'BTC', symbol: 'BTCUSDT', szDecimals: 3, pxDecimals: 1, maxLeverage: 50, markPx: 76000, prevDayPx: 76000, change24h: 0, funding: 0, volume24h: 0, openInterest: 0, onlyIsolated: false }
const ok = (action: string, body: unknown = { orderId: 7, status: 'NEW', executedQty: '0' }): PerpWriteResult => ({ action: action as PerpWriteResult['action'], status: 200, body })
const fail = (action: string, msg: string): PerpWriteResult => ({ action: action as PerpWriteResult['action'], status: 400, body: { code: -1, msg } })

/** Fake plugin account: ox4PerpWrite replies per reply, recording every action handed to the plugin */
function pluginAccount(reply: (actions: PerpWriteAction[], n: number) => PerpWriteResult[]) {
  const main = privateKeyToAccount(KEY)
  const sent: PerpWriteAction[][] = []
  const acc = Object.assign({ ...main }, {
    ox4Agent: async () => ({ address: '0x000000000000000000000000000000000000a9e7', signTypedData: async () => { throw new Error('网页版不该再用代理签下单') } }),
    ox4PerpWrite: async (actions: PerpWriteAction[]) => { sent.push(actions); return { results: reply(actions, sent.length) } },
  }) as unknown as Account
  return { acc, sent }
}

describe('网页版合约写操作走插件 perpWrite', () => {
  let fetchCalls: string[]
  beforeEach(() => {
    fetchCalls = []
    // Only the authorization (approveAgent) is sent by web itself; web must not hit the exchange directly for other write endpoints
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { fetchCalls.push(String(u)); return new Response('{"code":200,"msg":"success"}') }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('一次下单：改杠杆 + 保证金模式 + 主单 + 止盈 + 止损合成一次交给插件；主单挂上、止损没挂上照实报', async () => {
    const { acc, sent } = pluginAccount((a) => a.map((x, i) => i === 4 ? fail('order', 'Order would immediately trigger.') : ok(x.action, i === 2 ? { orderId: 9, status: 'FILLED', executedQty: '0.002', avgPrice: '76010' } : { code: 200 })))
    const r = await placeOrder(acc, { market, isBuy: true, size: 0.002, leverage: 10, isCross: false, takeProfit: 90000, stopLoss: 70000 })
    expect(sent).toHaveLength(1)
    expect(sent[0].map((x) => `${x.action}:${x.params.type ?? x.params.leverage ?? x.params.marginType}`)).toEqual(['leverage:10', 'marginType:ISOLATED', 'order:MARKET', 'order:TAKE_PROFIT_MARKET', 'order:STOP_MARKET'])
    expect(sent[0][2].params).toMatchObject({ symbol: 'BTCUSDT', side: 'BUY', quantity: '0.002', builder: BUILDER })
    expect(sent[0][3].params).toMatchObject({ side: 'SELL', stopPrice: '90000.0', closePosition: 'true' })
    expect(() => perpWriteBatch(sent[0])).not.toThrow()   // What the web page sends is exactly the format the extension accepts
    expect(r).toMatchObject({ filledSz: 0.002, avgPx: 76010, resting: false, oid: 9, protectionFailed: ['sl'] })
    expect(fetchCalls).toEqual([])
  })

  it('主单被交易所拒：按原话换成中文提示抛出；杠杆没改成也抛', async () => {
    let { acc } = pluginAccount((a) => a.map((x, i) => i === 2 ? fail('order', 'Margin is insufficient.') : i > 2 ? { action: x.action, skipped: true as const } : ok(x.action)))
    await expect(placeOrder(acc, { market, isBuy: true, size: 0.002, leverage: 10 })).rejects.toThrow('保证金不足')
    ;({ acc } = pluginAccount((a) => a.map((x, i) => i === 0 ? fail('leverage', 'Leverage 60 is not valid') : { action: x.action, skipped: true as const })))
    await expect(placeOrder(acc, { market, isBuy: true, size: 0.002, leverage: 10 })).rejects.toThrow('Leverage 60 is not valid')
  })

  it('没授权交易密钥：主钱包授权一次（网页自己请求授权接口）再整批重发；已经下单成功的不重发', async () => {
    const { acc, sent } = pluginAccount((a, n) => n === 1 ? a.map((x, i) => i === 0 ? fail(x.action, 'No agent found') : { action: x.action, skipped: true as const }) : a.map((x) => ok(x.action)))
    await placeOrder(acc, { market, isBuy: false, size: 0.001, limitPx: 77000, leverage: 5, isCross: true })
    expect(sent).toHaveLength(2)
    expect(fetchCalls.filter((u) => u.includes('/fapi/v3/approveAgent'))).toHaveLength(1)
    expect(sent[1]).toEqual(sent[0])
    // Order already succeeded but TP reports unauthorized (can't really happen — but never re-place the main order because of it)
    const b = pluginAccount((a) => a.map((x, i) => i === 0 ? ok(x.action, { orderId: 1, status: 'NEW', executedQty: '0' }) : fail(x.action, 'No agent found')))
    const r = await placeOrder(b.acc, { market, isBuy: true, size: 0.001, takeProfit: 90000 })
    expect(b.sent).toHaveLength(1)
    expect(r.protectionFailed).toEqual(['tp'])
  })

  it('撤单、单独改杠杆也交给插件；保证金模式「不用改」不算错', async () => {
    const { acc, sent } = pluginAccount((a) => a.map((x) => x.action === 'marginType' ? { action: x.action, status: 400, body: { code: -4046, msg: 'No need to change margin type.' } } : ok(x.action)))
    await cancelOrder(acc, market, 123)
    await setLeverage(acc, market, 80, true)   // Clamp to 50 when over this coin's cap
    expect(sent).toEqual([
      [{ action: 'cancel', params: { symbol: 'BTCUSDT', orderId: '123' } }],
      [{ action: 'leverage', params: { symbol: 'BTCUSDT', leverage: '50' } }, { action: 'marginType', params: { symbol: 'BTCUSDT', marginType: 'CROSSED' } }],
    ])
    expect(fetchCalls).toEqual([])
  })

  it('给已有仓位挂止盈 / 止损（2026-10-02 K 线上的交易线）：单独一张「平掉整个仓位」的触发单，方向和仓位相反，白名单认', async () => {
    const { acc, sent } = pluginAccount((a) => a.map((x) => ok(x.action)))
    await setProtection(acc, market, true, 'sl', 70000.04)
    await setProtection(acc, market, false, 'tp', 60000)
    expect(sent).toHaveLength(2)
    expect(sent[0]).toEqual([{ action: 'order', params: { symbol: 'BTCUSDT', side: 'SELL', type: 'STOP_MARKET', stopPrice: '70000.0', closePosition: 'true', builder: BUILDER, feeRate: BUILDER_FEE } }])
    expect(sent[1][0].params).toMatchObject({ side: 'BUY', type: 'TAKE_PROFIT_MARKET', stopPrice: '60000.0' })
    for (const batch of sent) expect(() => perpWriteBatch(batch)).not.toThrow()
    expect(fetchCalls).toEqual([])
  })

  it('改止盈 / 止损：先撤旧的、再挂新的，各自一批（白名单规定撤单只能单独一个）', async () => {
    const { acc, sent } = pluginAccount((a) => a.map((x) => ok(x.action)))
    await setProtection(acc, market, true, 'tp', 91000, 555)
    expect(sent.map((b) => b.map((x) => `${x.action}:${x.params.orderId ?? x.params.type}`))).toEqual([['cancel:555'], ['order:TAKE_PROFIT_MARKET']])
    for (const batch of sent) expect(() => perpWriteBatch(batch)).not.toThrow()
  })

  it('改止损时旧的撤了、新的被拒：错误带 protectionGone，界面据此明说「现在没有止损」；旧的没撤掉就不去挂新的', async () => {
    const a = pluginAccount((x) => x.map((y) => y.action === 'cancel' ? ok('cancel') : fail('order', 'Order would immediately trigger.')))
    const err = await setProtection(a.acc, market, true, 'sl', 80000, 555).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as { protectionGone?: boolean }).protectionGone).toBe(true)
    expect(a.sent).toHaveLength(2)
    // Cancel failed: stop here, without protectionGone (the old one is still there)
    const b = pluginAccount((x) => x.map(() => fail('cancel', 'Unknown order sent.')))
    const err2 = await setProtection(b.acc, market, true, 'sl', 70000, 555).catch((e: unknown) => e)
    expect((err2 as { protectionGone?: boolean }).protectionGone).toBeUndefined()
    expect(b.sent).toHaveLength(1)
    // Fresh place (no old order) rejected: no protectionGone either
    const c = pluginAccount((x) => x.map(() => fail('order', 'Order would immediately trigger.')))
    const err3 = await setProtection(c.acc, market, true, 'sl', 80000).catch((e: unknown) => e)
    expect(err3).toBeInstanceOf(Error)
    expect((err3 as { protectionGone?: boolean }).protectionGone).toBeUndefined()
    await expect(setProtection(c.acc, market, true, 'sl', 0)).rejects.toThrow()
    expect(c.sent).toHaveLength(1)
  })

  it('收费地址和费率上限：lib/aster.ts 和白名单是同一份', () => {
    expect(BUILDER).toBe(WL_BUILDER)
    expect(BUILDER_FEE).toBe(WL_FEE)
  })
})
