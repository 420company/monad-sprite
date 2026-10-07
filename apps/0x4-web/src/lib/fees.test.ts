// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { DEFAULT_FEES, jupiterFee, spotFeeLabel } from './fees'

const SOL = 'So11111111111111111111111111111111111111112', USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'

describe('Jupiter 收费账户选择（2026-09-27 主网模拟：币对不上或账户没建会让整笔兑换失败）', () => {
  it('用 SOL 买 meme：收在 SOL 账户', () => {
    expect(jupiterFee(DEFAULT_FEES, SOL, BONK)).toEqual({ bps: 100, account: DEFAULT_FEES.solFeeAccounts[SOL] })
  })
  it('卖 meme 换 SOL：收在 SOL 账户', () => {
    expect(jupiterFee(DEFAULT_FEES, BONK, SOL)?.account).toBe(DEFAULT_FEES.solFeeAccounts[SOL])
  })
  it('两边都有收费账户时优先输出币', () => {
    expect(jupiterFee(DEFAULT_FEES, SOL, USDC)?.account).toBe(DEFAULT_FEES.solFeeAccounts[USDC])
  })
  it('meme 换 meme：没有对得上的账户就不收，保证交易不失败', () => {
    expect(jupiterFee(DEFAULT_FEES, BONK, WIF)).toBeNull()
  })
  it('VIP 按 0.8%；费率为 0 不收', () => {
    expect(jupiterFee({ ...DEFAULT_FEES, solBps: 80 }, SOL, BONK)?.bps).toBe(80)
    expect(jupiterFee({ ...DEFAULT_FEES, solBps: 0 }, SOL, BONK)).toBeNull()
  })
})

describe('报价里显示的手续费 = 用户总共付的', () => {
  it('Solana 1%，EVM 0.75% + LI.FI 0.25% = 1%', () => {
    expect(spotFeeLabel(DEFAULT_FEES, 'jupiter')).toBe('1%')
    expect(spotFeeLabel(DEFAULT_FEES, 'lifi')).toBe('1%')
  })
  it('VIP：都是 0.8%', () => {
    const vip = { ...DEFAULT_FEES, vip: true, solBps: 80, evmBps: 55 }
    expect(spotFeeLabel(vip, 'jupiter')).toBe('0.8% · VIP')
    expect(spotFeeLabel(vip, 'lifi')).toBe('0.8% · VIP')
  })
})
