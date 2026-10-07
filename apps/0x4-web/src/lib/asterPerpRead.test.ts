// Extension-proxied contract read-only queries: only four fixed GET endpoints and whitelisted parameters pass (each with a positive control)
import { describe, expect, it } from 'vitest'
import { PERP_READ_PATHS, perpReadEndpointOf, perpReadQuery } from './asterPerpRead'

describe('perpReadQuery', () => {
  it('四个只读接口放行，路径由白名单决定；成交记录带 limit', () => {
    expect(perpReadQuery('account', {})).toEqual({ endpoint: 'account', path: '/fapi/v3/account', params: {} })
    expect(perpReadQuery('openOrders', undefined).path).toBe('/fapi/v3/openOrders')
    expect(perpReadQuery('leverageBracket', null).path).toBe('/fapi/v3/leverageBracket')
    expect(perpReadQuery('userTrades', { limit: 30 })).toEqual({ endpoint: 'userTrades', path: '/fapi/v3/userTrades', params: { limit: '30' } })
    expect(perpReadQuery('userTrades', { limit: '1000' }).params).toEqual({ limit: '1000' })
  })
  it('写接口、白名单外的接口、原型链上的名字一律不认', () => {
    for (const e of ['noop', 'assetExchange', 'listenKey', 'order', 'leverage', 'marginType', 'aster/user-withdraw', '/fapi/v3/account', 'toString', '__proto__', 'constructor', '', 1, null]) {
      expect(() => perpReadQuery(e, {}), String(e)).toThrow()
    }
  })
  it('参数：不许带白名单以外的（symbol 等）、值必须是范围内的整数', () => {
    expect(() => perpReadQuery('account', { symbol: 'BTCUSDT' })).toThrow()
    expect(() => perpReadQuery('openOrders', { symbol: 'BTCUSDT' })).toThrow()
    expect(() => perpReadQuery('userTrades', { limit: 30, symbol: 'BTCUSDT' })).toThrow()
    expect(() => perpReadQuery('userTrades', { limit: 0 })).toThrow()
    expect(() => perpReadQuery('userTrades', { limit: 1001 })).toThrow()
    expect(() => perpReadQuery('userTrades', { limit: '30&symbol=BTCUSDT' })).toThrow()
    expect(() => perpReadQuery('userTrades', { limit: '1e2' })).toThrow()
    expect(() => perpReadQuery('userTrades', { limit: -5 })).toThrow()
    expect(() => perpReadQuery('userTrades', { limit: 2.5 })).toThrow()
    expect(() => perpReadQuery('userTrades', { nonce: 1 })).toThrow()
    expect(() => perpReadQuery('userTrades', [30])).toThrow()
    expect(() => perpReadQuery('userTrades', 'limit=30')).toThrow()
  })
  it('路径反查接口名', () => {
    for (const [k, p] of Object.entries(PERP_READ_PATHS)) expect(perpReadEndpointOf(p)).toBe(k)
    expect(perpReadEndpointOf('/fapi/v3/noop')).toBeNull()
    expect(perpReadEndpointOf('/fapi/v3/order')).toBeNull()
  })
})
