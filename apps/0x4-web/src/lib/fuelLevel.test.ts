// @vitest-environment jsdom
// 燃料费油量表三档（2026-09-29 goat：像汽车仪表盘，low / middle / high）
// 其他链：低于警戒线 low；到警戒线 3 倍之前 middle；再往上 high。BNB Chain：不够付自己的燃料费 low；没到预存金额 middle；到了 high
import { describe, expect, it } from 'vitest'
import { fuelLevel, gasRule, BSC, RESERVE_MIN_USD } from './gas'
import { SOLANA_CHAIN_ID } from './chains'

describe('燃料费三档', () => {
  it('其他链按这条链的警戒线划分，边界值落在上一档', () => {
    for (const id of [SOLANA_CHAIN_ID, 8453, 1]) {
      const min = gasRule(id).minUsd
      expect(fuelLevel(id, 0)).toBe('low')
      expect(fuelLevel(id, min - 0.001)).toBe('low')
      expect(fuelLevel(id, min)).toBe('middle')
      expect(fuelLevel(id, min * 3 - 0.001)).toBe('middle')
      expect(fuelLevel(id, min * 3)).toBe('high')
      expect(fuelLevel(id, 1000)).toBe('high')
    }
  })
  it('BNB Chain 按预存金额划分；预存金额低于最少值时按最少值算', () => {
    const min = gasRule(BSC).minUsd
    expect(fuelLevel(BSC, min - 0.001)).toBe('low')
    expect(fuelLevel(BSC, min)).toBe('middle')
    expect(fuelLevel(BSC, 4.46)).toBe('middle')                 // goat 截图：BNB $4.46，够付燃料费、不够预存
    expect(fuelLevel(BSC, RESERVE_MIN_USD - 0.01)).toBe('middle')
    expect(fuelLevel(BSC, RESERVE_MIN_USD)).toBe('high')
    expect(fuelLevel(BSC, 19, 20)).toBe('middle')               // 开了自动补充、预存设 20 美元
    expect(fuelLevel(BSC, 20, 20)).toBe('high')
    expect(fuelLevel(BSC, 10, 3)).toBe('high')                   // 预存设得比最少值还低，按最少值 10 算
  })
  it('拿不到数（NaN）当 low，不会误显示充足', () => {
    expect(fuelLevel(8453, Number.NaN)).toBe('low')
  })
})
