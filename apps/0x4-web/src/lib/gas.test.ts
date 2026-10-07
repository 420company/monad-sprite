// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { checkGas, gasRule, loadGasRules, lowGasChains, topUpUsd, MAX_REFUEL_USD } from './gas'
import { NATIVE_EVM, NATIVE_SOL, SOLANA_CHAIN_ID } from './chains'
import type { Holding } from './types'

const h = (chainId: number, mint: string, valueUsd: number, symbol = 'X'): Holding => ({ chainId, mint, amount: valueUsd, decimals: 18, symbol, name: symbol, priceUsd: 1, valueUsd })
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955'

describe('下单前的燃料费检查（缺哪样说哪样）', () => {
  it('用 BSC 的 USDT 付款但没有 BNB：付款链缺燃料费，不能从 BNB 自己补', () => {
    const p = checkGas({ holdings: [h(56, USDT_BSC, 100)], pay: { chainId: 56, token: USDT_BSC, usd: 20, balanceUsd: 100 }, targetChainId: 56 })
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ kind: 'gas', chainId: 56, symbol: 'BNB', refillable: false })
  })
  it('有 BNB、同链买：什么都不缺', () => {
    expect(checkGas({ holdings: [h(56, USDT_BSC, 100), h(56, NATIVE_EVM, 5)], pay: { chainId: 56, token: USDT_BSC, usd: 20, balanceUsd: 100 }, targetChainId: 56 })).toEqual([])
  })
  it('用 BSC 买 Solana 的币、Solana 上没有 SOL：目标链缺燃料费，可以从 BNB 补', () => {
    const p = checkGas({ holdings: [h(56, USDT_BSC, 100), h(56, NATIVE_EVM, 5)], pay: { chainId: 56, token: USDT_BSC, usd: 20, balanceUsd: 100 }, targetChainId: SOLANA_CHAIN_ID })
    expect(p).toEqual([expect.objectContaining({ kind: 'gas', chainId: SOLANA_CHAIN_ID, symbol: 'SOL', refillable: true })])
  })
  it('跨链买 EVM 币时兑换已顺带换目标链燃料费：目标链不算缺', () => {
    expect(checkGas({ holdings: [h(56, USDT_BSC, 100), h(56, NATIVE_EVM, 5)], pay: { chainId: 56, token: USDT_BSC, usd: 20, balanceUsd: 100 }, targetChainId: 8453, bundledTargetGas: true })).toEqual([])
  })
  it('用 BNB 付款：付完要剩下燃料费；预存的那部分不能花', () => {
    const all = checkGas({ holdings: [h(56, NATIVE_EVM, 30)], pay: { chainId: 56, token: NATIVE_EVM, usd: 30, balanceUsd: 30 }, targetChainId: 56 })
    expect(all.some((x) => x.kind === 'gas' && x.chainId === 56)).toBe(true)
    const res = checkGas({ holdings: [h(56, NATIVE_EVM, 30)], pay: { chainId: 56, token: NATIVE_EVM, usd: 15, balanceUsd: 30 }, targetChainId: 56, reserveUsd: 20 })
    expect(res.some((x) => x.kind === 'pay')).toBe(true)
  })
  it('补充量至少补够缺口；BSC 不用换', () => {
    expect(topUpUsd({ kind: 'gas', chainId: 8453, symbol: 'ETH', needUsd: 0.05, refillable: true })).toBeGreaterThanOrEqual(5)
    expect(gasRule(56).topUpUsd).toBe(0)
  })
})

describe('燃料费预警：链上还有币但燃料费不够', () => {
  it('Base 上有 50 美元的币、ETH 为 0 → 预警；只有燃料费、没有币的链不报', () => {
    const low = lowGasChains([h(8453, '0xabc', 50, 'BRETT'), h(42161, NATIVE_EVM, 0.001), h(SOLANA_CHAIN_ID, NATIVE_SOL, 5)])
    expect(low.map((x) => x.chainId)).toEqual([8453])
    expect(low[0].symbol).toBe('ETH')
  })
  it('币不到 1 美元的尘埃不报；燃料费够的不报', () => {
    expect(lowGasChains([h(8453, '0xabc', 0.5)])).toEqual([])
    expect(lowGasChains([h(8453, '0xabc', 50), h(8453, NATIVE_EVM, 5)])).toEqual([])
  })
})

describe('服务器下发的燃料费标准不可信时用本地默认（2026-09-28 审查 #12）', () => {
  it('离谱的数字（太大、负数、不是数字、警戒线比补充量还高）不用；正常的照用；下单前补充量不超过硬上限', async () => {
    const before = { eth: gasRule(1), base: gasRule(8453) }
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ chains: {
      1: { minUsd: 400, topUpUsd: 4000 },          // Too big
      8453: { minUsd: 0.2, topUpUsd: 1.5 },         // Normal
      42161: { minUsd: -1, topUpUsd: Number.NaN },  // Negative, not a number (becomes null in JSON)
      [SOLANA_CHAIN_ID]: { minUsd: 5, topUpUsd: 2 }, // Warning line higher than the top-up amount
    } }), { headers: { 'Content-Type': 'application/json' } }))
    await loadGasRules()
    vi.unstubAllGlobals()
    expect(gasRule(1)).toEqual(before.eth)                       // Ethereum: fall back to local defaults — never tops up $4000 at once
    expect(gasRule(8453)).toEqual({ minUsd: 0.2, topUpUsd: 5 })   // Control: normal numbers used as-is (top-up 1.5 → minimum $5 top-up, 2026-09-29 goat)
    expect(gasRule(42161).topUpUsd).toBeGreaterThan(0)
    expect(gasRule(42161).topUpUsd).toBeLessThanOrEqual(10)
    expect(gasRule(SOLANA_CHAIN_ID).minUsd).toBeLessThanOrEqual(gasRule(SOLANA_CHAIN_ID).topUpUsd)
    for (const chainId of [1, 8453, 42161, SOLANA_CHAIN_ID]) {
      const r = gasRule(chainId)
      expect(topUpUsd({ kind: 'gas', chainId, symbol: '', needUsd: r.minUsd, refillable: true })).toBeLessThanOrEqual(MAX_REFUEL_USD)
    }
  })
})

describe('一次补充最少 5 美元（2026-09-29 goat）', () => {
  it('服务器给的补充量低于 5 美元也按 5 美元补，BSC 不补', async () => {
    const { gasRule, MIN_TOPUP_USD } = await import('./gas')
    expect(MIN_TOPUP_USD).toBe(5)
    for (const id of [8453, 1151111081099710, 1, 42161]) expect(gasRule(id).topUpUsd).toBeGreaterThanOrEqual(5)
    expect(gasRule(56).topUpUsd).toBe(0)
  })
})

describe('燃料费币不止 isNative（2026-09-29 审查 P1：Arc 的 USDC、持仓里记成 So111…112 的 SOL）', async () => {
  const { autoRefuelDue, nativeUsd, canAutoRefuel, isNetworkError } = await import('./gas')
  const { isGasToken, WSOL_MINT } = await import('./chains')
  const ARC = 5042, ARC_USDC = '0x3600000000000000000000000000000000000000'
  const base = { low: [] as number[], bnbUsd: 50, reserveUsd: 20, spentUsd: 0, lastAuto: {} as Record<string, number>, now: 10 ** 13 }
  it('Arc 上有 50 美元 USDC 燃料费：算作有燃料费，自动补充不补', () => {
    const holdings = [h(56, NATIVE_EVM, 50, 'BNB'), h(ARC, ARC_USDC, 50, 'USDC'), h(ARC, '0x1234567890123456789012345678901234567890', 20, 'MEME')]
    expect(isGasToken(ARC, ARC_USDC)).toBe(true)
    expect(nativeUsd(holdings, ARC)).toBe(50)
    expect(lowGasChains(holdings).map((l) => l.chainId)).not.toContain(ARC)
    expect(autoRefuelDue({ ...base, holdings, low: lowGasChains(holdings).map((l) => l.chainId), fuelChains: [ARC], scannedChains: [ARC] })).toBeNull()
  })
  it('对照：Arc 上确实没有 USDC 燃料费 → 预警，添加过就补', () => {
    const holdings = [h(56, NATIVE_EVM, 50, 'BNB'), h(ARC, '0x1234567890123456789012345678901234567890', 20, 'MEME')]
    expect(lowGasChains(holdings).map((l) => l.chainId)).toContain(ARC)
    expect(autoRefuelDue({ ...base, holdings, fuelChains: [ARC], scannedChains: [ARC] })).toBe(ARC)
  })
  it('Solana 持仓里的 SOL 记成 So111…112：有 5 SOL 时不报缺燃料费', () => {
    const sol = { ...h(SOLANA_CHAIN_ID, WSOL_MINT, 750, 'SOL'), amount: 5, priceUsd: 150 }
    const holdings = [sol, h(SOLANA_CHAIN_ID, 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 100, 'BONK')]
    expect(nativeUsd(holdings, SOLANA_CHAIN_ID)).toBe(750)
    expect(lowGasChains(holdings)).toEqual([])
    // Control: SOL down to 0.001 ($0.15, below the $0.5 warning line) → alert
    expect(lowGasChains([{ ...sol, amount: 0.001, valueUsd: 0.15 }, holdings[1]]).map((l) => l.chainId)).toEqual([SOLANA_CHAIN_ID])
  })
  it('这次没拿到燃料费币的价格（记成 0）：不当成没有燃料费，不预警也不补', () => {
    const eth = { ...h(42161, NATIVE_EVM, 0, 'ETH'), amount: 1, priceUsd: 0, valueUsd: 0 }
    const holdings = [h(56, NATIVE_EVM, 50, 'BNB'), eth, h(42161, '0x1234567890123456789012345678901234567890', 100, 'MEME')]
    expect(lowGasChains(holdings)).toEqual([])
    expect(autoRefuelDue({ ...base, holdings, low: [42161], fuelChains: [42161], scannedChains: [42161] })).toBeNull()
    // Control: genuinely no ETH (amount 0) → top up as usual
    const none = [holdings[0], holdings[2]]
    expect(autoRefuelDue({ ...base, holdings: none, low: lowGasChains(none).map((l) => l.chainId), fuelChains: [], scannedChains: [] })).toBe(42161)
  })
  it('自动补充只在钱包已解锁时进行（锁着不弹验证框）', () => {
    const on = { enabled: true, hasAccount: true, keysUnlocked: true, portfolioReady: true }
    expect(canAutoRefuel(on)).toBe(true)
    expect(canAutoRefuel({ ...on, keysUnlocked: false })).toBe(false)
    expect(canAutoRefuel({ ...on, enabled: false })).toBe(false)
    expect(canAutoRefuel({ ...on, portfolioReady: false })).toBe(false)
  })
  it('网络问题识别：超时、中止、断网算；接口明确报错不算', () => {
    expect(isNetworkError(Object.assign(new Error('signal is aborted without reason'), { name: 'AbortError' }))).toBe(true)
    expect(isNetworkError(new Error('This operation was aborted'))).toBe(true)
    expect(isNetworkError(new TypeError('Load failed'))).toBe(true)
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkError(new Error('HTTP 404 No available quotes'))).toBe(false)
  })
})
