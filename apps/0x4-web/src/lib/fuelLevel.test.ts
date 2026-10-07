// @vitest-environment jsdom
// Gas gauge three levels (2026-09-29 goat: like a car dashboard, low / middle / high)
// Other chains: below the warning line = low; up to 3x the warning line = middle; above = high. BNB Chain: can't cover its own gas = low; below the reserve target = middle; at target = high
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
    expect(fuelLevel(BSC, 4.46)).toBe('middle')                 // goat's screenshot: BNB $4.46 — enough for gas, not enough for the reserve
    expect(fuelLevel(BSC, RESERVE_MIN_USD - 0.01)).toBe('middle')
    expect(fuelLevel(BSC, RESERVE_MIN_USD)).toBe('high')
    expect(fuelLevel(BSC, 19, 20)).toBe('middle')               // Auto top-up on, reserve set to $20
    expect(fuelLevel(BSC, 20, 20)).toBe('high')
    expect(fuelLevel(BSC, 10, 3)).toBe('high')                   // A reserve set below the minimum counts as the minimum 10
  })
  it('拿不到数（NaN）当 low，不会误显示充足', () => {
    expect(fuelLevel(8453, Number.NaN)).toBe('low')
  })
})
