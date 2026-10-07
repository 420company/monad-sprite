import { describe, expect, it } from 'vitest'
import { parseAmount, parseIntent, parseTokenRef } from './agentIntent'

const ADDR = '0x8ca1990c872b9f28f0dedc2ac9024dd6d1d2457f'

describe('agent intent parser', () => {
  it('buy: MON amount of a ticker, with or without filler words', () => {
    for (const line of ['buy 0.1 MON of SPRITE', 'buy 0.1 mon worth of sprite', 'Buy 0.1 SPRITE', 'buy .1 MON of $SPRITE']) {
      expect(parseIntent(line)).toEqual({ kind: 'buy', monWei: 100_000_000_000_000_000n, amount: '0.1', token: { kind: 'symbol', symbol: 'SPRITE' } })
    }
  })

  it('buy: contract address keeps its case', () => {
    const r = parseIntent(`buy 1 MON of ${ADDR}`)
    expect(r).toMatchObject({ kind: 'buy', monWei: 10n ** 18n, token: { kind: 'address', address: ADDR } })
  })

  it('sell: token amount of a ticker', () => {
    expect(parseIntent('sell 100 SPRITE')).toEqual({ kind: 'sell', tokenWei: 100n * 10n ** 18n, amount: '100', token: { kind: 'symbol', symbol: 'SPRITE' } })
    expect(parseIntent('sell 2.50 of sprite')).toMatchObject({ kind: 'sell', tokenWei: 2_500_000_000_000_000_000n, amount: '2.5' })
  })

  it('price: several phrasings', () => {
    for (const line of ['price SPRITE', 'price of sprite', 'SPRITE price', 'what is the price of SPRITE?', "what's the price of sprite"]) {
      expect(parseIntent(line)).toEqual({ kind: 'price', token: { kind: 'symbol', symbol: 'SPRITE' } })
    }
  })

  it('help and unknown', () => {
    expect(parseIntent('help')).toEqual({ kind: 'help' })
    expect(parseIntent('')).toMatchObject({ kind: 'unknown' })
    expect(parseIntent('transfer 1 MON to bob')).toMatchObject({ kind: 'unknown' })
  })

  it('rejects malformed or zero amounts and missing tokens', () => {
    expect(parseIntent('buy 0 MON of SPRITE')).toMatchObject({ kind: 'unknown' })
    expect(parseIntent('buy -1 MON of SPRITE')).toMatchObject({ kind: 'unknown' })
    expect(parseIntent('buy 1e18 MON of SPRITE')).toMatchObject({ kind: 'unknown' })
    expect(parseIntent('buy 0.1 MON')).toMatchObject({ kind: 'unknown' })
    expect(parseIntent('sell all SPRITE')).toMatchObject({ kind: 'unknown' })
    expect(parseIntent('sell 1 MON')).toMatchObject({ kind: 'unknown' })
    expect(parseIntent('price')).toMatchObject({ kind: 'unknown' })
    expect(parseIntent('buy 0.1 MON of SPRITE PLEASE')).toMatchObject({ kind: 'unknown' })
  })

  it('amount and token helpers', () => {
    expect(parseAmount('0.000000000000000001')).toBe(1n)
    expect(parseAmount('0.0000000000000000001')).toBeNull()
    expect(parseTokenRef('0x123')).toBeNull()
    expect(parseTokenRef('sprite')).toEqual({ kind: 'symbol', symbol: 'SPRITE' })
  })
})
