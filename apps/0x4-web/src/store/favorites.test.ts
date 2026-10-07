// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = '0x4.favorites'
const load = async () => (await import('./favorites')).useFavorites
const symbols = (items: { symbol: string }[]) => items.map((x) => x.symbol)

describe('默认自选', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules() })

  it('新装：自带 BTC ETH BNB SOL HYPE', async () => {
    const fav = await load()
    expect(symbols(fav.getState().items)).toEqual(['BTC', 'ETH', 'BNB', 'SOL', 'HYPE'])
  })

  it('取消后重启不会被加回', async () => {
    let fav = await load()
    const btc = fav.getState().items[0]
    fav.getState().remove(btc.chain, btc.address)
    vi.resetModules()
    fav = await load()
    expect(symbols(fav.getState().items)).toEqual(['ETH', 'BNB', 'SOL', 'HYPE'])
  })

  it('全部取消后重启仍为空', async () => {
    let fav = await load()
    for (const f of [...fav.getState().items]) fav.getState().remove(f.chain, f.address)
    vi.resetModules()
    fav = await load()
    expect(fav.getState().items).toEqual([])
  })

  it('老用户自选为空且没初始化过：补上默认', async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { items: [] }, version: 0 }))
    const fav = await load()
    expect(symbols(fav.getState().items)).toEqual(['BTC', 'ETH', 'BNB', 'SOL', 'HYPE'])
    expect(JSON.parse(localStorage.getItem(KEY)!).state.seeded).toBe(true)
  })

  it('老用户已有自选：原样保留，不掺默认', async () => {
    const mine = { chain: 'bsc', chainId: 56, address: '0x6652b21538fcdee00be8fd534673428760dc5505', symbol: 'BNG', name: 'BNG', addedAt: 1 }
    localStorage.setItem(KEY, JSON.stringify({ state: { items: [mine] }, version: 0 }))
    const fav = await load()
    expect(fav.getState().items).toEqual([mine])
  })
})
