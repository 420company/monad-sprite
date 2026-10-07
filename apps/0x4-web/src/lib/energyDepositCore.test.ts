// Shared rules for topping up energy (web and desktop meetings use the same): integer USDT, approvals only for this amount, contents of the two transactions
import { describe, expect, it } from 'vitest'
import { decodeFunctionData, erc20Abi, parseAbi } from 'viem'
import { cleanDepositInput, depositCalls, depositClosedReason, parseDepositAmount } from './energyDepositCore'

const ME = { enabled: true, depositsOpen: true, chainId: 56, usdt: '0x55d398326f99059fF775485246999027B3197955', contract: '0x1111111111111111111111111111111111111111' }

describe('充值能量共用规则', () => {
  it('数量只收整数、1 起、10 亿封顶', () => {
    expect(cleanDepositInput('00１2.5a')).toBe('25')
    expect(parseDepositAmount('100')).toBe(100)
    expect(parseDepositAmount('0')).toBeNull()
    expect(parseDepositAmount('')).toBeNull()
    expect(parseDepositAmount('1.5')).toBeNull()
    expect(parseDepositAmount('1000000001')).toBeNull()
  })
  it('关着的原因：没开放 / 暂停充值', () => {
    expect(depositClosedReason(null)).toBe('送礼暂未开放')
    expect(depositClosedReason({ ...ME, enabled: false })).toBe('送礼暂未开放')
    expect(depositClosedReason({ ...ME, depositsOpen: false })).toBe('充值暂停中，已有的能量照常可以送礼')
    expect(depositClosedReason(ME)).toBeNull()
  })
  it('两笔交易：授权给打赏合约（只授这次的数量）、deposit 同样数量', () => {
    const c = depositCalls(ME, 25)
    expect(c.units).toBe(25n * 10n ** 18n)
    expect(c.approve.to).toBe(ME.usdt)
    expect(decodeFunctionData({ abi: erc20Abi, data: c.approve.data })).toMatchObject({ functionName: 'approve', args: [ME.contract, c.units] })
    expect(c.deposit.to).toBe(ME.contract)
    expect(decodeFunctionData({ abi: parseAbi(['function deposit(uint256 amount)']), data: c.deposit.data })).toMatchObject({ functionName: 'deposit', args: [c.units] })
    expect(() => depositCalls(ME, 1.5)).toThrow()
    expect(() => depositCalls({ ...ME, contract: null }, 5)).toThrow()
  })
})
