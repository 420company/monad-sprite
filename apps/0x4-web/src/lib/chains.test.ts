// The "chain" in trade history comes in two flavors: DexScreener chain names for on-chain tokens, and exchange identifiers for perps.
// The two lead to completely different places when tapped; they used to both be treated as tokens, and tapping your own perps trade would open a
// Dead page for "no market data found for this token".
import { describe, expect, it } from 'vitest'
import { chainByDexKey, isPerpMarket, marketLinkOf, perpCoinOf } from './chains'

describe('永续市场识别', () => {
  it('认得两个交易所标识：aster 是现在的，hyperliquid 是库里的历史值', () => {
    expect(isPerpMarket('aster')).toBe(true)
    expect(isPerpMarket('hyperliquid')).toBe(true)
  })

  it('链上的链名不能被当成永续', () => {
    for (const key of ['bsc', 'solana', 'ethereum', 'base', 'arbitrum', '']) expect(isPerpMarket(key)).toBe(false)
  })

  it('这些链名确实是查得到的链，不是随手编的', () => {
    for (const key of ['bsc', 'solana', 'ethereum', 'base']) expect(chainByDexKey(key)).toBeTruthy()
  })
})

describe('永续记录取币种', () => {
  it('BTC:long → BTC', () => {
    expect(perpCoinOf('BTC:long')).toBe('BTC')
    expect(perpCoinOf('sol:short')).toBe('SOL')
  })

  it('认不出的形状返回 null，不要瞎猜出一个币种', () => {
    expect(perpCoinOf('')).toBeNull()
    expect(perpCoinOf(':long')).toBeNull()
    expect(perpCoinOf('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')).toBeNull()
  })
})

describe('交易记录该跳哪', () => {
  it('永续跳合约页并选中币种', () => {
    expect(marketLinkOf('hyperliquid', 'BTC:long')).toBe('/perp?coin=BTC')
    expect(marketLinkOf('aster', 'ETH:short')).toBe('/perp?coin=ETH')
  })

  it('币种认不出时也别跳去代币页，落在合约页就行', () => {
    expect(marketLinkOf('aster', ':long')).toBe('/perp')
  })

  it('现货照旧跳代币行情页', () => {
    expect(marketLinkOf('bsc', '0x21Aac796151375e3747D5AA3933a45085a6A720e')).toBe('/token/bsc/0x21Aac796151375e3747D5AA3933a45085a6A720e')
    expect(marketLinkOf('solana', 'So11111111111111111111111111111111111111112')).toBe('/token/solana/So11111111111111111111111111111111111111112')
  })
})
