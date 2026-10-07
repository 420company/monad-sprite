// @vitest-environment jsdom
// 代币搜索的排序、别名、冒牌过滤、同名门槛、「新创建」标记（2026-09-30 goat：「搜 btc 出来这么多」「BTC、PEPE 的冒牌也要处理」）
import { describe, expect, it } from 'vitest'
import { isAddressQuery, isNewPool, rankSearch, sameNameVisible } from './market'
import { assetForSymbol, mainstreamLookalike, officialAssetOf, OFFICIAL_ASSETS } from './officialTokens'
import type { MarketToken } from './types'

const NOW = Date.parse('2026-09-30T12:00:00Z')
const DAY = 86_400_000
const tok = (chain: string, address: string, symbol: string, liq: number, vol = 0, extra: Partial<MarketToken> = {}): MarketToken =>
  ({ chain, chainId: 1, address, symbol, name: symbol, logo: '', priceUsd: 1, liquidityUsd: liq, volume24h: vol, createdAt: NOW - 400 * DAY, ...extra })

const BTCB = tok('bsc', '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', 'BTCB', 1_900_000, 6_000_000)
const WBTC_ARB = tok('arbitrum', '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', 'WBTC', 38_000_000, 18_000_000)
const CBBTC_SOL = tok('solana', 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij', 'cbBTC', 5_700_000, 10_000_000)
// 仿冒：Solana 上随便发的「BTC」
const fakeBtc = (i: number, liq = 20_000) => tok('solana', `FakeBtc${i}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`, 'BTC', liq, 5_000)
// 官方表里（市值前 200 生成的）PEPE 的一个官方地址
const PEPE_OFFICIAL = OFFICIAL_ASSETS.find((a) => a.symbol === 'PEPE')!.tokens[0]

describe('官方币表', () => {
  it('别名：btc / wbtc / btcb / cbbtc / $BTC 都算 BTC，eth / weth 算 ETH；市值前 200 的 pepe 也在表里', () => {
    for (const q of ['btc', 'BTC', 'wbtc', 'btcb', 'cbBTC', '$BTC', 'bitcoin']) expect(assetForSymbol(q)?.symbol).toBe('BTC')
    for (const q of ['eth', 'WETH', 'ether']) expect(assetForSymbol(q)?.symbol).toBe('ETH')
    expect(assetForSymbol('pepe')?.symbol).toBe('PEPE')
    expect(assetForSymbol('frogz')).toBeUndefined()
  })
  it('按「链 + 地址」认官方，大小写无关；同一个地址换条链不算', () => {
    expect(officialAssetOf('bsc', '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c')?.symbol).toBe('BTC')
    expect(officialAssetOf('ethereum', '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c')).toBeUndefined()
  })
  it('冒充写法：ERC20-USDT、USDT-BEP20、WETH2、BTC.b 算；BTCAT、SOLE、LINKS 这种普通名字不算', () => {
    for (const s of ['ERC20-USDT', 'USDT-BEP20', 'WETH2', 'BTC.b', 'xBTC', 'USDTtoken', 'PEPE2']) expect(mainstreamLookalike(s), s).toBeTruthy()
    for (const s of ['BTCAT', 'SOLE', 'LINKS', 'ETHAN', 'FROGZ']) expect(mainstreamLookalike(s), s).toBeUndefined()
  })
  it('单字母符号不进表（收了会把所有叫这个字母的币都挡掉）', () => {
    expect(OFFICIAL_ASSETS.every((a) => a.aliases.every((al) => al.length >= 2))).toBe(true)
  })
})

describe('rankSearch', () => {
  it('官方的排最前、标官方，BNB Chain 的排第一（哪怕流动性不是最高）', () => {
    const r = rankSearch([fakeBtc(1, 90_000_000), WBTC_ARB, CBBTC_SOL, BTCB], 'btc', NOW)
    expect(r.tokens.map((x) => x.symbol)).toEqual(['BTCB', 'WBTC', 'cbBTC'])
    expect(r.tokens.every((x) => x.official)).toBe(true)
  })
  it('官方表里的币（BTC）：非官方的冒牌一律不显示，不再折叠', () => {
    const r = rankSearch([BTCB, ...Array.from({ length: 20 }, (_, i) => fakeBtc(i, 5_000_000))], 'btc', NOW)
    expect(r.tokens.map((x) => x.address)).toEqual([BTCB.address])
    expect(r).not.toHaveProperty('hidden')
  })
  it('市值前 200 的币（PEPE）：冒牌 PEPE、PEPE2 都不显示，别的词搜出来也不显示', () => {
    const official = tok(PEPE_OFFICIAL[0], PEPE_OFFICIAL[1], 'PEPE', 31_000_000, 1_700_000)
    const copies = [tok('solana', 'PepeCopy1xxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'PEPE', 80_000_000, 9_000_000), tok('base', '0xPepe2', 'PEPE2', 5_000_000, 500_000)]
    expect(rankSearch([...copies, official], 'pepe', NOW).tokens.map((x) => x.address)).toEqual([official.address])
    // 搜别的词（比如 frog）时混进来的冒牌 PEPE 也不显示
    expect(rankSearch([...copies, tok('base', '0xFrog', 'FROGZ', 100_000, 50_000)], 'frog', NOW).tokens.map((x) => x.symbol)).toEqual(['FROGZ'])
  })
  it('稳定币只显示官方：冒牌的 USDT / USDe 都不显示', () => {
    const usdtBsc = tok('bsc', '0x55d398326f99059fF775485246999027B3197955', 'USDT', 50_000_000, 9_000_000)
    const fakeUsdt = tok('solana', 'Fake1111111111111111111111111111111111111111', 'USDT', 3_000_000, 10)
    const fakeUsde = tok('solana', 'Fake2222222222222222222222222222222222222222', 'USDe', 3_000_000, 10)
    expect(rankSearch([fakeUsdt, usdtBsc], 'usdt', NOW).tokens.map((x) => x.address)).toEqual([usdtBsc.address])
    expect(rankSearch([fakeUsde], 'usde', NOW).tokens).toEqual([])
  })
  it('搜官方表里的币只要这一种：配对带进来的别的币（官方 USDC、不相干的 meme）都不显示', () => {
    const usdtBsc = tok('bsc', '0x55d398326f99059fF775485246999027B3197955', 'USDT', 50_000_000, 9_000_000)
    const usdcBsc = tok('bsc', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 'USDC', 16_000_000, 3_000_000)
    const meme = tok('polygon', '0x' + '1'.repeat(40), 'AIPF', 900_000, 50_000)
    expect(rankSearch([usdcBsc, meme, usdtBsc], 'usdt', NOW).tokens.map((x) => x.symbol)).toEqual(['USDT'])
    expect(rankSearch([meme], 'aipf', NOW).tokens).toHaveLength(1)   // 对照：搜不相干的词照常显示
  })

  describe('不在官方表里的普通币：同名门槛', () => {
    const main = tok('solana', 'FrogMainxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'FROGZ', 3_000_000, 800_000)
    it('分数最高的那个照常显示（只过死池）', () => {
      expect(rankSearch([main], 'frogz', NOW).tokens).toHaveLength(1)
    })
    it('成熟的同名币：流动性 ≥ 5 万、池子超过 3 天、24h 成交 ≥ 1 万才显示', () => {
      const ok = tok('base', '0xFrogOk', 'FROGZ', 60_000, 12_000)
      const thin = tok('base', '0xFrogThin', 'FROGZ', 40_000, 12_000)
      const quiet = tok('base', '0xFrogQuiet', 'FROGZ', 60_000, 9_000)
      expect(rankSearch([main, ok, thin, quiet], 'frogz', NOW).tokens.map((x) => x.address)).toEqual([main.address, ok.address])
    })
    it('新币撞老币名：池子 3 天内、24h 成交 ≥ 1 万且 ≥ 100 笔就显示；撞名但没什么成交的不显示', () => {
      const fresh = tok('bsc', '0xFrogNew', 'FROGZ', 8_000, 25_000, { createdAt: NOW - DAY, buys24h: 90, sells24h: 40 })
      const freshQuiet = tok('bsc', '0xFrogNewQuiet', 'FROGZ', 8_000, 25_000, { createdAt: NOW - DAY, buys24h: 30, sells24h: 20 })
      const freshNoVol = tok('bsc', '0xFrogNewNoVol', 'FROGZ', 900_000, 5_000, { createdAt: NOW - DAY, buys24h: 500, sells24h: 500 })
      const r = rankSearch([main, fresh, freshQuiet, freshNoVol], 'frogz', NOW)
      expect(r.tokens.map((x) => x.address)).toEqual([main.address, fresh.address])
      expect(sameNameVisible(fresh, NOW)).toBe(true)
      expect(sameNameVisible(freshQuiet, NOW)).toBe(false)
    })
  })

  it('「新创建」：非官方、交易池 3 天内的标 fresh；官方的不标；拿不到创建时间的不标', () => {
    const fresh = tok('base', '0xBrandNew', 'NEWT', 30_000, 20_000, { createdAt: NOW - 2 * DAY })
    const old = tok('base', '0xOld', 'OLDT', 30_000, 20_000, { createdAt: NOW - 4 * DAY })
    const noTime = tok('base', '0xNoTime', 'NOTM', 30_000, 20_000, { createdAt: undefined })
    const r = rankSearch([fresh, old, noTime, { ...BTCB, createdAt: NOW - DAY }], 'x', NOW)
    const by = (a: string) => r.tokens.find((x) => x.address === a)!
    expect(by('0xBrandNew').fresh).toBe(true)
    expect(by('0xOld').fresh).toBe(false)
    expect(by('0xNoTime').fresh).toBe(false)
    expect(by(BTCB.address).fresh).toBe(false)
    expect(isNewPool({ createdAt: NOW - 3 * DAY }, NOW)).toBe(true)
    expect(isNewPool({ createdAt: NOW - 3 * DAY - 1 }, NOW)).toBe(false)
  })
  it('其余按流动性 + 一半成交额排', () => {
    const r = rankSearch([tok('base', '0xA', 'AAA', 10_000, 0), tok('base', '0xB', 'BBB', 6_000, 20_000)], 'a', NOW)
    expect(r.tokens.map((x) => x.symbol)).toEqual(['BBB', 'AAA'])
  })
  it('死池不显示：流动性 < 5000 且成交额 < 1000；只要有一样够就留', () => {
    const r = rankSearch([
      tok('base', '0xDead', 'DEAD', 4_000, 500),
      tok('base', '0xLiq', 'LIQ', 5_000, 0),
      tok('base', '0xVol', 'VOL', 100, 1_000),
    ], 'x', NOW)
    expect(r.tokens.map((x) => x.symbol).sort()).toEqual(['LIQ', 'VOL'])
  })
  it('官方的永远不会被当成死池过滤', () => {
    const tiny = tok('ethereum', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 'USDT', 1_000, 100)
    expect(rankSearch([tiny], 'usdt', NOW).tokens).toHaveLength(1)
  })
  it('粘贴合约地址：不过滤，冒充主流币的照样显示并标非官方', () => {
    const addr = 'FakeBtc1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    expect(isAddressQuery(addr)).toBe(true)
    expect(isAddressQuery('0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c')).toBe(true)
    expect(isAddressQuery('btc')).toBe(false)
    const r = rankSearch([fakeBtc(1, 100), fakeBtc(2, 50)], addr, NOW)
    expect(r.tokens).toHaveLength(2)
    expect(r.tokens.every((x) => x.impostor)).toBe(true)
  })
  it('两路来的同一个币去重，留流动性高的那份', () => {
    const r = rankSearch([BTCB, { ...BTCB, liquidityUsd: 10 }], 'btc', NOW)
    expect(r.tokens).toHaveLength(1)
    expect(r.tokens[0].liquidityUsd).toBe(1_900_000)
  })

  it('自动收录的短符号（宽松资产）：官方排第一，别家同名的不算冒牌，过门槛就显示', async () => {
    const { OFFICIAL_ASSETS } = await import('./officialTokens')
    const loose = OFFICIAL_ASSETS.find((a) => a.loose)
    if (!loose) return   // 表里没有短符号就跳过
    const [chain, addr] = loose.tokens[0]
    const off = tok(chain, addr, loose.symbol, 5_000_000, 1_000_000)
    const other = tok('solana', 'Othr1111111111111111111111111111111111111111', loose.symbol, 200_000, 50_000, { createdAt: Date.now() - 30 * 86400_000 } as Partial<MarketToken>)
    const r = rankSearch([other, off], loose.symbol.toLowerCase())
    expect(r.tokens[0].address).toBe(addr)
    expect(r.tokens.map((x) => x.address)).toContain(other.address)
  })
})
