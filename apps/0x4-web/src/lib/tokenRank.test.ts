// 选币搜索结果排序（lib/tokenRank.ts rankPicked，2026-10-03 goat：小精灵搜 uni 出来好多、没有「官方」）
import { describe, expect, it } from 'vitest'
import { rankPicked, isOfficial } from './tokenRank'
import type { ChainToken } from '@/lib/chains'

const tok = (chainId: number, address: string, symbol: string, name = symbol): ChainToken => ({ chainId, address, symbol, name, decimals: 18 })
const UNI_ETH = tok(1, '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', 'UNI', 'Uniswap')
const UNI_BSC = tok(56, '0xBf5140A22578168FD562DCcF235E5D43A02ce9B1', 'UNI', 'Uniswap')
const FAKE_UNI = tok(1, '0x2730d6FdC86C95a74253BefFaA8306B40feDecbb', 'UNI', 'UNICORN')
const UNIX = tok(1, '0x6654Bc209F2a1b7B6aBbD0D3CB21Df5c4a2e3a21', 'UNIX', 'UNIX')

describe('选币搜索结果', () => {
  it('官方的排最前、标官方；同名冒充的不显示；别的名字照常', () => {
    const r = rankPicked([UNIX, FAKE_UNI, UNI_BSC, UNI_ETH], 'uni')
    expect(r.map((x) => x.address)).toEqual([UNI_BSC.address, UNI_ETH.address, UNIX.address])
    expect(isOfficial(UNI_BSC)).toBe(true)
    expect(isOfficial(FAKE_UNI)).toBe(false)
  })
  it('粘贴合约地址搜：用户点名要的，不过滤', () => {
    const r = rankPicked([FAKE_UNI], FAKE_UNI.address)
    expect(r).toHaveLength(1)
  })
  it('最多列 50 个', () => {
    const many = Array.from({ length: 80 }, (_, i) => tok(1, `0x${(i + 1).toString(16).padStart(40, '0')}`, `ZZ${i}`))
    expect(rankPicked(many, 'zz')).toHaveLength(50)
  })
})
