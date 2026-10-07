// @vitest-environment jsdom
// Order-book / trade-by-trade / push parsing (lib/asterBook.ts). Samples are the actual formats from the exchange's REST and websocket on 2026-09-29.
import { describe, expect, it } from 'vitest'
import { mergeTape, parseAggTrade, parseBook, parseStream, streamUrl } from './asterBook'

describe('parseBook', () => {
  it('REST 快照：买盘从高到低、卖盘从低到高，丢掉 0 和坏数', () => {
    const b = parseBook({ T: 1790679752000, bids: [['83966.0', '0.003'], ['83969.6', '0.001'], ['83950.0', '0'], ['x', '1']], asks: [['83971.0', '4.378'], ['83969.7', '11.818']] })
    expect(b.bids.map((l) => l.px)).toEqual([83969.6, 83966])
    expect(b.asks.map((l) => l.px)).toEqual([83969.7, 83971])
    expect(b.at).toBe(1790679752000)
  })
  it('推送用 b / a 字段', () => {
    const b = parseBook({ e: 'depthUpdate', b: [['1.5', '2']], a: [['1.6', '3']] } as never)
    expect(b.bids).toEqual([{ px: 1.5, sz: 2 }])
    expect(b.asks).toEqual([{ px: 1.6, sz: 3 }])
  })
})

describe('parseAggTrade', () => {
  it('m=true 是主动卖，m=false 是主动买', () => {
    expect(parseAggTrade({ a: 1, p: '83980.0', q: '0.001', T: 1, m: true })?.isBuy).toBe(false)
    expect(parseAggTrade({ a: 2, p: '83969.6', q: '0.146', T: 2, m: false })?.isBuy).toBe(true)
  })
  it('缺字段返回 null', () => {
    expect(parseAggTrade({ a: 1, p: '0', q: '1', T: 1, m: true })).toBeNull()
    expect(parseAggTrade({ p: '1', q: '1', T: 1 })).toBeNull()
  })
})

describe('parseStream', () => {
  it('四种推送各归各位', () => {
    expect(parseStream(JSON.stringify({ stream: 'btcusdt@depth20@500ms', data: { e: 'depthUpdate', T: 5, b: [['2', '1']], a: [['3', '1']] } }))?.book?.bids[0].px).toBe(2)
    expect(parseStream(JSON.stringify({ stream: 'btcusdt@aggTrade', data: { e: 'aggTrade', a: 9, p: '83982.1', q: '0.451', T: 7, m: true } }))?.trade).toEqual({ id: 9, px: 83982.1, sz: 0.451, time: 7, isBuy: false })
    expect(parseStream(JSON.stringify({ data: { e: 'markPriceUpdate', p: '83987.48', i: '84025.47', r: '0.00007090', T: 1790697600000 } }))?.stats).toEqual({ mark: 83987.48, index: 84025.47, funding: 0.0000709, nextFunding: 1790697600000 })
    const tk = parseStream(JSON.stringify({ data: { e: '24hrTicker', c: '83982.1', o: '82970.1', h: '84338.7', l: '82510.2', q: '417766643.56' } }))?.stats
    expect(tk).toEqual({ last: 83982.1, open24h: 82970.1, high24h: 84338.7, low24h: 82510.2, quoteVolume24h: 417766643.56 })
  })
  it('认不出的消息返回 null', () => {
    expect(parseStream('not json')).toBeNull()
    expect(parseStream(JSON.stringify({ result: null, id: 1 }))).toBeNull()
    expect(parseStream(JSON.stringify({ data: { e: 'kline' } }))).toBeNull()
  })
})

describe('mergeTape / streamUrl', () => {
  it('按 id 去重、新的在前、限条数', () => {
    const a = { id: 1, px: 1, sz: 1, isBuy: true, time: 10 }
    const b = { id: 2, px: 1, sz: 1, isBuy: false, time: 20 }
    const c = { id: 3, px: 1, sz: 1, isBuy: true, time: 30 }
    expect(mergeTape([b, a], [c, b], 2).map((x) => x.id)).toEqual([3, 2])
  })
  it('合并流地址用小写交易对', () => {
    expect(streamUrl('btc')).toBe('wss://fstream.asterdex.com/stream?streams=btcusdt@depth20@500ms/btcusdt@aggTrade/btcusdt@markPrice@1s/btcusdt@ticker')
  })
})
