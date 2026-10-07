// @vitest-environment jsdom
// Bitcoin flash-swap edge rules (2026-09-30):
//   · 2026-09-30 goat configured the fee address for the Bitcoin chain in the cross-chain service backend: Bitcoin-originated quotes also carry the platform-fee param, same as EVM-originated ones
//   · paying with BTC skips the check and never tops up "Bitcoin gas" (miner fees come out of the BTC itself)
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLifiQuote } from './lifi'
import { checkGas } from './gas'
import { BTC_CHAIN_ID } from './chains'
import type { Holding } from './types'

afterEach(() => { vi.unstubAllGlobals() })

function captureQuoteUrl(): { urls: string[] } {
  const seen = { urls: [] as string[] }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    seen.urls.push(String(url))
    return new Response(JSON.stringify({ action: {}, estimate: {} }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
  return seen
}

describe('getLifiQuote 平台费参数', () => {
  const base = { fromAmount: 100_000n, fromAddress: 'bc1q4qw42stdzjqs59xvlrlxr8526e3nunw7mp73te', toAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', slippage: 0.01, feeBps: 75, integrator: '0x4' }
  it('卖出 BTC（比特币发起）：带 fee（比特币链收费地址已配好）', async () => {
    const seen = captureQuoteUrl()
    await getLifiQuote({ ...base, fromChain: BTC_CHAIN_ID, fromToken: 'bitcoin', toChain: 56, toToken: '0x55d398326f99059fF775485246999027B3197955' })
    const q = new URL(seen.urls[0]).searchParams
    expect(q.get('fromChain')).toBe(String(BTC_CHAIN_ID))
    expect(q.get('fee')).toBe('0.0075')
    expect(q.get('integrator')).toBe('0x4')
  })
  it('对照：买入 BTC（BNB Chain 发起）照常带 fee', async () => {
    const seen = captureQuoteUrl()
    await getLifiQuote({ ...base, fromAddress: base.toAddress, toAddress: base.fromAddress, fromChain: 56, fromToken: '0x55d398326f99059fF775485246999027B3197955', toChain: BTC_CHAIN_ID, toToken: 'bitcoin' })
    expect(new URL(seen.urls[0]).searchParams.get('fee')).toBe('0.0075')
  })
})

describe('checkGas 比特币', () => {
  const btcHolding = { chainId: BTC_CHAIN_ID, mint: 'bitcoin', amount: 0.01, decimals: 8, symbol: 'BTC', name: 'Bitcoin', valueUsd: 830, priceUsd: 83_000 } as unknown as Holding
  const bnb = { chainId: 56, mint: '0x0000000000000000000000000000000000000000', amount: 0.05, decimals: 18, symbol: 'BNB', name: 'BNB', valueUsd: 30, priceUsd: 600 } as unknown as Holding
  it('用 BTC 付款买 BNB Chain 上的币：不报比特币缺燃料费', () => {
    const out = checkGas({ holdings: [btcHolding, bnb], pay: { chainId: BTC_CHAIN_ID, token: 'bitcoin', usd: 100, balanceUsd: 830 }, targetChainId: 56 })
    expect(out.filter((p) => p.chainId === BTC_CHAIN_ID)).toEqual([])
  })
  it('用 BNB Chain 的币买 BTC：不要求比特币上有燃料费', () => {
    const out = checkGas({ holdings: [bnb], pay: { chainId: 56, token: '0x0000000000000000000000000000000000000000', usd: 5, balanceUsd: 30 }, targetChainId: BTC_CHAIN_ID })
    expect(out.filter((p) => p.chainId === BTC_CHAIN_ID)).toEqual([])
  })
})
