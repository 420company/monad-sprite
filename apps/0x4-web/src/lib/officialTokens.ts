// Official contract registry for blue-chip tokens (2026-09-30 goat: "searching btc on spot returns a flood of results").
//
// Background: anyone can mint a token also called BTC on any chain, seed a tiny pool, set an arbitrary price, and the search API returns matches verbatim,
// so searching "btc" surfaces 20+ "BTC" tokens on Solana alone, priced anywhere from 60k to 88k.
// This table records each blue-chip token's official contracts per chain: in search, official ones rank first and carry the "official" badge; same-symbol tokens not in the table collapse into "unofficial, possibly counterfeit".
//
// ★ Every address was looked up by address on DexScreener for symbol, name and liquidity (scripts/verify-official-tokens.mjs); unresolvable addresses are excluded.
//   Adding a token later: add a row here first, then run that script to verify. Chain IDs follow DexScreener's (bsc / ethereum / solana …, see lib/chains.ts dexKey).

import { GENERATED_ASSETS } from './officialTokens.generated'

export interface OfficialAsset {
  /** Primary display symbol */
  symbol: string
  /** Any of these terms count as a match for this token (all lowercase, $ . - _ and spaces stripped) */
  aliases: string[]
  /** Official contracts per chain: [DexScreener chain ID, address] */
  tokens: [string, string][]
  /** Stablecoins (2026-09-30 goat: only official ones shown; counterfeits aren't even shown collapsed) */
  stable?: boolean
  /**
   * Lenient (2026-09-30): very short or common symbols among the auto-included top-200 by market cap (AI, LIT, FF…) easily collide with unrelated legit projects.
   * For these, only the official contract ranks first; other same-name tokens aren't treated as counterfeits and display per normal same-name thresholds
   */
  loose?: boolean
}

/** Hand-written blue-chip and stablecoin entries (each address looked up individually) */
const MANUAL_ASSETS: OfficialAsset[] = [
  {
    symbol: 'BTC',
    aliases: ['btc', 'bitcoin', 'wbtc', 'btcb', 'cbbtc', 'ubtc'],
    tokens: [
      ['bsc', '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c'], // BTCB
      ['ethereum', '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'], // WBTC
      ['ethereum', '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'], // cbBTC
      ['base', '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'], // cbBTC
      ['arbitrum', '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f'], // WBTC
      ['arbitrum', '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'], // cbBTC
      ['polygon', '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6'], // WBTC
      ['optimism', '0x68f180fcCe6836688e9084f035309E29Bf0A2095'], // WBTC
      ['solana', 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij'], // cbBTC
      ['solana', '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh'], // WBTC（Wormhole）
      ['hyperevm', '0x9FDBdA0A5e284c32744D2f17Ee5c74B284993463'], // UBTC
      ['avalanche', '0x152b9d0FdC40C096757F570A51E494bd4b943E50'], // BTC.b
      ['ethereum', '0xB0F70C0bD6FD87dbEb7C10dC692a2a6106817072'], // BTC.b: LI.FI token list (verified) + DexScreener largest pool $8,333,529 (verified 2026-09-30)
      ['base', '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c'], // WBTC: LI.FI token list (verified) + DexScreener largest pool $338,032 (verified 2026-09-30)
      ['bsc', '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c'], // WBTC: LI.FI token list (verified) + DexScreener largest pool $129,382 (verified 2026-09-30)
      ['robinhood', '0xCEC185eB182c47d1bA1EFc84e6959e18cd620Be4'], // cbBTC: LI.FI token list + DexScreener largest pool $1,283,082 (verified 2026-09-30)
      ['monad', '0xd18B7EC58Cdf4876f6AFebd3Ed1730e4Ce10414b'], // cbBTC: LI.FI token list (verified) + DexScreener largest pool $97,412 (verified 2026-09-30)
      ['megaeth', '0xB0F70C0bD6FD87dbEb7C10dC692a2a6106817072'], // BTC.b: LI.FI token list + DexScreener largest pool $3,111,342 (verified 2026-09-30)
      ['seiv2', '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c'], // WBTC: LI.FI token list (verified) + DexScreener largest pool $1,549,118 (verified 2026-09-30)
      ['katana', '0x0913DA6Da4b42f538B445599b46Bb4622342Cf52'], // WBTC: LI.FI token list (verified) + DexScreener largest pool $1,112,039 (verified 2026-09-30)
      ['avalanche', '0x50b7545627a5162F82A992c33b87aDc75187B218'], // WBTC: LI.FI token list (verified) + DexScreener largest pool $291,389 (verified 2026-09-30)
      ['linea', '0x3aAB2285ddcDdaD8edf438C1bAB47e1a9D05a9b4'], // WBTC: LI.FI token list (verified) + DexScreener largest pool $51,400 (verified 2026-09-30)
      ['zksync', '0xBBeB516fb02a01611cBBE0453Fe3c580D7281011'], // WBTC: LI.FI token list (verified) + DexScreener largest pool $198,979 (verified 2026-09-30)
      ['sonic', '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c'], // WBTC: LI.FI token list (verified) + DexScreener largest pool $116,892 (verified 2026-09-30)
      ['berachain', '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c'], // WBTC: LI.FI token list (verified) + DexScreener largest pool $1,138,236 (verified 2026-09-30)
      ['unichain', '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c'], // WBTC: LI.FI token list (verified) + DexScreener largest pool $3,183,112 (verified 2026-09-30)
      ['cronos', '0x062E66477Faf219F25D27dCED647BF57C3107d52'], // WBTC: LI.FI token list + DexScreener largest pool $2,222,553 (verified 2026-09-30)
    ],
  },
  {
    symbol: 'ETH',
    aliases: ['eth', 'ether', 'ethereum', 'weth'],
    tokens: [
      ['bsc', '0x2170Ed0880ac9A755fd29B2688956BD959F933F8'],
      ['ethereum', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'],
      ['base', '0x4200000000000000000000000000000000000006'],
      ['arbitrum', '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'],
      ['optimism', '0x4200000000000000000000000000000000000006'],
      ['polygon', '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619'],
      ['solana', '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs'],
      ['robinhood', '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'], // WETH: LI.FI token list + DexScreener largest pool $21,881,697 (verified 2026-09-30)
      ['arc', '0x128cC466B61f542da60c70e3aA11c10e19B84EDB'], // WETH: LI.FI token list + DexScreener largest pool $831,716 (verified 2026-09-30)
      ['katana', '0xEE7D8BCFb72bC1880D0Cf19822eB0A2e6577aB62'], // WETH: LI.FI token list (verified) + DexScreener largest pool $2,108,702 (verified 2026-09-30)
      ['linea', '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f'], // WETH: LI.FI token list (verified) + DexScreener largest pool $403,812 (verified 2026-09-30)
      ['zksync', '0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91'], // WETH: LI.FI token list (verified) + DexScreener largest pool $4,471,262 (verified 2026-09-30)
      ['scroll', '0x5300000000000000000000000000000000000004'], // WETH: LI.FI token list (verified) + DexScreener largest pool $563,621 (verified 2026-09-30)
      ['blast', '0x4300000000000000000000000000000000000004'], // WETH: LI.FI token list (verified) + DexScreener largest pool $152,089,105 (verified 2026-09-30)
      ['mantle', '0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111'], // WETH: LI.FI token list (verified) + DexScreener largest pool $3,413,381 (verified 2026-09-30)
      ['sonic', '0x50c42dEAcD8Fc9773493ED674b675bE577f2634b'], // WETH: LI.FI token list (verified) + DexScreener largest pool $107,815 (verified 2026-09-30)
      ['berachain', '0x2F6F07CDcf3588944Bf4C42aC74ff24bF56e7590'], // WETH: LI.FI token list (verified) + DexScreener largest pool $2,238,362 (verified 2026-09-30)
      ['unichain', '0x4200000000000000000000000000000000000006'], // WETH: LI.FI token list (verified) + DexScreener largest pool $537,799 (verified 2026-09-30)
      ['abstract', '0x3439153EB7AF838Ad19d56E1571FBD09333C2809'], // WETH: LI.FI token list + DexScreener largest pool $746,144 (verified 2026-09-30)
      ['celo', '0xD221812de1BD094f35587EE8E174B07B6167D9Af'], // WETH: LI.FI token list (verified) + DexScreener largest pool $204,212 (verified 2026-09-30)
      ['celo', '0x122013fd7dF1C6F636a5bb8f03108E876548b455'], // WETH: LI.FI token list (verified) + DexScreener largest pool $195,733 (verified 2026-09-30)
      ['ink', '0x4200000000000000000000000000000000000006'], // WETH: LI.FI token list (verified) + DexScreener largest pool $2,831,520 (verified 2026-09-30)
      ['cronos', '0xe44Fd7fCb2b1581822D0c862B68222998a0c299a'], // WETH: LI.FI token list + DexScreener largest pool $8,855,552 (verified 2026-09-30)
    ],
  },
  {
    symbol: 'BNB',
    aliases: ['bnb', 'wbnb'],
    tokens: [
      ['bsc', '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'],
    ],
  },
  {
    symbol: 'SOL',
    aliases: ['sol', 'solana', 'wsol'],
    tokens: [
      ['solana', 'So11111111111111111111111111111111111111112'],
      ['bsc', '0x570A5D26f7765Ecb712C0924E4De545B89fD43dF'],
    ],
  },
  {
    symbol: 'USDT',
    stable: true,
    aliases: ['usdt', 'tether', 'usdt0'],
    tokens: [
      ['bsc', '0x55d398326f99059fF775485246999027B3197955'],
      ['ethereum', '0xdAC17F958D2ee523a2206206994597C13D831ec7'],
      ['base', '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2'],
      ['arbitrum', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9'],
      ['optimism', '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58'],
      ['polygon', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'], // On-chain it's now called USDT0, mostly appearing on the quote-token side; verified via quote token ($46M liquidity)
      ['solana', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'], // Verified 2026-09-30: $76M liquidity (lib/chains.ts and server gifts.ts had the wrong address …McCdmaqyxgt, which doesn't exist on-chain; corrected together)
      ['hyperevm', '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb'],
      ['optimism', '0x01bFF41798a0BcF287b996046Ca68b395DbC1071'], // USDT0: LI.FI token list (verified) + DexScreener largest pool $6,262,529 (verified 2026-09-30)
      ['monad', '0xe7cd86e13AC4309349F30B3435a9d337750fC82D'], // USDT0: LI.FI token list (verified) + DexScreener largest pool $100,881 (verified 2026-09-30)
      ['seiv2', '0x9151434b16b9763660705744891fA906F660EcC5'], // USD₮0: LI.FI token list (verified) + DexScreener largest pool $272,000 (verified 2026-09-30)
      ['plasma', '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb'], // USDT0: LI.FI token list (verified) + DexScreener largest pool $2,814,618 (verified 2026-09-30)
      ['katana', '0x2DCa96907fde857dd3D816880A0df407eeB2D2F2'], // USDT: LI.FI token list (verified) + DexScreener largest pool $2,297,311 (verified 2026-09-30)
      ['avalanche', '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7'], // USDt: LI.FI token list (verified) + DexScreener largest pool $3,707,418 (verified 2026-09-30)
      ['avalanche', '0xc7198437980c041c805A1EDcbA50c1Ce5db95118'], // USDT.e: LI.FI token list (verified) + DexScreener largest pool $627,226 (verified 2026-09-30)
      ['linea', '0xA219439258ca9da29E9Cc4cE5596924745e12B93'], // USDT: LI.FI token list (verified) + DexScreener largest pool $299,369 (verified 2026-09-30)
      ['zksync', '0x493257fD37EDB34451f62EDf8D2a0C418852bA4C'], // USDT: LI.FI token list (verified) + DexScreener largest pool $175,716 (verified 2026-09-30)
      ['scroll', '0xf55BEC9cafDbE8730f096Aa55dad6D22d44099Df'], // USDT: LI.FI token list (verified) + DexScreener largest pool $335,326 (verified 2026-09-30)
      ['mantle', '0x779Ded0c9e1022225f8E0630b35a9b54bE713736'], // USDT0: LI.FI token list (verified) + DexScreener largest pool $4,987,780 (verified 2026-09-30)
      ['mantle', '0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE'], // USDT: LI.FI token list (verified) + DexScreener largest pool $1,528,342 (verified 2026-09-30)
      ['sonic', '0x6047828dc181963ba44974801FF68e538dA5eaF9'], // USDT: LI.FI token list (verified) + DexScreener largest pool $536,327 (verified 2026-09-30)
      ['berachain', '0x779Ded0c9e1022225f8E0630b35a9b54bE713736'], // USD₮0: LI.FI token list (verified) + DexScreener largest pool $628,826 (verified 2026-09-30)
      ['unichain', '0x9151434b16b9763660705744891fA906F660EcC5'], // USD₮0: LI.FI token list (verified) + DexScreener largest pool $885,339 (verified 2026-09-30)
      ['ink', '0x0200C29006150606B650577BBE7B6248F58470c1'], // USD₮0: LI.FI token list (verified) + DexScreener largest pool $1,251,544 (verified 2026-09-30)
      ['cronos', '0x66e428c3f67a68878562e79A0234c1F83c208770'], // USDT: LI.FI token list + DexScreener largest pool $10,359,537 (verified 2026-09-30)
    ],
  },
  {
    symbol: 'USDC',
    stable: true,
    aliases: ['usdc', 'usdcoin'],
    tokens: [
      ['bsc', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'],
      ['ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
      ['base', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'],
      ['arbitrum', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'],
      ['optimism', '0x0b2C639c533813f4Aa9D7837CAF62653d097Ff85'],
      ['polygon', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'],
      ['solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'],
      ['hyperevm', '0xb88339CB7199b77E23DB6E890353E22632Ba630f'],
      ['avalanche', '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'],
      ['arbitrum', '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8'], // USDC.e: LI.FI token list (verified) + DexScreener largest pool $1,125,122 (verified 2026-09-30)
      ['polygon', '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'], // USDC.e: LI.FI token list (verified) + DexScreener largest pool $1,123,461 (verified 2026-09-30)
      ['optimism', '0x7F5c764cBc14f9669B88837ca1490cCa17c31607'], // USDC.e: LI.FI token list (verified) + DexScreener largest pool $261,922 (verified 2026-09-30)
      ['arc', '0x3600000000000000000000000000000000000000'], // USDC: LI.FI token list + DexScreener largest pool $11,477,010 (verified 2026-09-30)
      ['monad', '0x754704Bc059F8C67012fEd69BC8A327a5aafb603'], // USDC: LI.FI token list (verified) + DexScreener largest pool $1,187,384 (verified 2026-09-30)
      ['seiv2', '0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392'], // USDC: LI.FI token list (verified) + DexScreener largest pool $9,553,680 (verified 2026-09-30)
      ['avalanche', '0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664'], // USDC.e: LI.FI token list (verified) + DexScreener largest pool $479,965 (verified 2026-09-30)
      ['linea', '0x176211869cA2b568f2A7D4EE941E073a821EE1ff'], // USDC: LI.FI token list (verified) + DexScreener largest pool $403,812 (verified 2026-09-30)
      ['zksync', '0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4'], // USDC: LI.FI token list (verified) + DexScreener largest pool $61,020 (verified 2026-09-30)
      ['zksync', '0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4'], // USDC.e: LI.FI token list (verified) + DexScreener largest pool $4,471,262 (verified 2026-09-30)
      ['scroll', '0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4'], // USDC: LI.FI token list (verified) + DexScreener largest pool $653,582 (verified 2026-09-30)
      ['mantle', '0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9'], // USDC: LI.FI token list (verified) + DexScreener largest pool $1,444,989 (verified 2026-09-30)
      ['sonic', '0x29219dd400f2Bf60E5a23d13Be72B486D4038894'], // USDC: LI.FI token list (verified) + DexScreener largest pool $536,327 (verified 2026-09-30)
      ['berachain', '0x549943e04f40284185054145c6E4e9568C1D3241'], // USDC.e: LI.FI token list (verified) + DexScreener largest pool $373,769 (verified 2026-09-30)
      ['unichain', '0x078D782b760474a361dDA0AF3839290b0EF57AD6'], // USDC: LI.FI token list (verified) + DexScreener largest pool $8,565,367 (verified 2026-09-30)
      ['abstract', '0x84A71ccD554Cc1b02749b35d22F684CC8ec987e1'], // USDC.e: LI.FI token list + DexScreener largest pool $822,394 (verified 2026-09-30)
      ['celo', '0xcebA9300f2b948710d2653dD7B07f33A8B32118C'], // USDC: LI.FI token list (verified) + DexScreener largest pool $187,560 (verified 2026-09-30)
      ['ink', '0x2D270e6886d130D724215A266106e6832161EAEd'], // USDC: LI.FI token list (verified) + DexScreener largest pool $1,002,573 (verified 2026-09-30)
      ['ink', '0xF1815bd50389c46847f0Bda824eC8da914045D14'], // USDC.e: LI.FI token list (verified) + DexScreener largest pool $66,410 (verified 2026-09-30)
      ['worldchain', '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1'], // USDC: LI.FI token list + DexScreener largest pool $1,000,002,644 (verified 2026-09-30)
      ['cronos', '0x3D7F2C478aAfdB65542BCB44bCeeC05849999d2D'], // USDC: LI.FI token list + DexScreener largest pool $988,098 (verified 2026-09-30)
      ['cronos', '0xc21223249CA28397B4B6541dfFaEcC539BfF0c59'], // USDC.e: LI.FI token list + DexScreener largest pool $10,359,537 (verified 2026-09-30)
    ],
  },
  {
    symbol: 'DOGE',
    aliases: ['doge', 'dogecoin'],
    tokens: [['bsc', '0xbA2aE424d960c26247Dd6c32edC70B295c744C43']],
  },
  {
    symbol: 'XRP',
    aliases: ['xrp'],
    tokens: [['bsc', '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE']],
  },
  {
    symbol: 'ADA',
    aliases: ['ada', 'cardano'],
    tokens: [['bsc', '0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47']],
  },
  {
    symbol: 'CAKE',
    aliases: ['cake'],
    tokens: [['bsc', '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82']],
  },
  {
    symbol: 'LINK',
    aliases: ['link', 'chainlink'],
    tokens: [
      ['bsc', '0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD'],
      ['ethereum', '0x514910771AF9Ca656af840dff83E8264EcF986CA'],
    ],
  },
  {
    symbol: 'UNI',
    aliases: ['uni', 'uniswap'],
    tokens: [
      ['ethereum', '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'],
      ['bsc', '0xBf5140A22578168FD562DCcF235E5D43A02ce9B1'], // Binance-Peg UNI (verified 2026-10-03 on DexScreener: UNI / Uniswap, ~$270K liquidity)
    ],
  },
  {
    symbol: 'HYPE',
    aliases: ['hype', 'whype', 'hyperliquid'],
    // WHYPE: only appears on the quote-token side of pools; verified via quote token ($30M)
    tokens: [['hyperevm', '0x5555555555555555555555555555555555555555']],
  },
  {
    symbol: 'AVAX',
    aliases: ['avax', 'wavax', 'avalanche'],
    tokens: [['avalanche', '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7']],
  },
  {
    symbol: 'POL',
    aliases: ['pol', 'wpol', 'matic', 'wmatic', 'polygon'],
    tokens: [['polygon', '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270']],
  },
  // ---- Other blue-chip stablecoins (2026-09-30 goat: stablecoins show official only; sources: LI.FI token list + DexScreener lookups, price 0.97–1.03 with real pools; ambiguous collisions USDA / mUSD / USDX excluded) ----
  {
    symbol: 'USDe',
    stable: true,
    aliases: ['usde', 'ethenausd'],
    tokens: [
      ['bsc', '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34'], // USDe: LI.FI (verified) + DexScreener largest pool $1,269,097
      ['ethereum', '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3'], // USDe: LI.FI (verified) + DexScreener largest pool $34,041,666
      ['berachain', '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34'], // USDe: LI.FI (verified) + DexScreener largest pool $5,149,365
      ['solana', 'DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT'], // USDe: LI.FI (verified) + DexScreener largest pool $2,503,915
      ['mantle', '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34'], // USDe: LI.FI (verified) + DexScreener largest pool $1,528,342
      ['blast', '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34'], // Blast Bridged USDE (Blast): LI.FI (verified) + DexScreener largest pool $1,041,989
      ['base', '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34'], // USDe: LI.FI (verified) + DexScreener largest pool $1,000,482
      ['robinhood', '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34'], // USDe: LI.FI + DexScreener largest pool $998,326
      ['arbitrum', '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34'], // USDe: LI.FI (verified) + DexScreener largest pool $775,806
      ['avalanche', '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34'], // USDe: LI.FI (verified) + DexScreener largest pool $502,878
    ],
  },
  {
    symbol: 'USD1',
    stable: true,
    aliases: ['usd1'],
    tokens: [
      ['bsc', '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d'], // USD1: LI.FI (verified) + DexScreener largest pool $26,228,728
      ['solana', 'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB'], // World Liberty Financial USD: LI.FI (verified) + DexScreener largest pool $9,900,968
      ['ethereum', '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d'], // World Liberty Financial USD: LI.FI (verified) + DexScreener largest pool $3,453,831
    ],
  },
  {
    symbol: 'DAI',
    stable: true,
    aliases: ['dai'],
    tokens: [
      ['bsc', '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3'], // DAI Stablecoin: LI.FI (verified) + DexScreener largest pool $2,288,583
      ['ethereum', '0x6B175474E89094C44Da98b954EedeAC495271d0F'], // DAI Stablecoin: LI.FI (verified) + DexScreener largest pool $124,476,367
      ['polygon', '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063'], // (PoS) DAI Stablecoin: LI.FI (verified) + DexScreener largest pool $7,828,546
      ['arbitrum', '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1'], // DAI Stablecoin: LI.FI (verified) + DexScreener largest pool $838,229
      ['optimism', '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1'], // DAI Stablecoin: LI.FI (verified) + DexScreener largest pool $353,809
      ['base', '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb'], // DAI Stablecoin: LI.FI (verified) + DexScreener largest pool $64,902
    ],
  },
  {
    symbol: 'USDS',
    stable: true,
    aliases: ['usds', 'skydollar'],
    tokens: [
      ['ethereum', '0xdC035D45d973E3EC169d2276DDab16f1e407384F'], // USDS: LI.FI (verified) + DexScreener largest pool $100,173,173
      ['solana', 'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA'], // USDS: LI.FI (verified) + DexScreener largest pool $1,078,007
      ['arbitrum', '0x6491c05A82219b8D1479057361ff1654749b876b'], // USDS Stablecoin: LI.FI (verified) + DexScreener largest pool $541,365
    ],
  },
  {
    symbol: 'FDUSD',
    stable: true,
    aliases: ['fdusd'],
    tokens: [
      ['bsc', '0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409'], // FDUSD: LI.FI (verified) + DexScreener largest pool $92,665
    ],
  },
  {
    symbol: 'PYUSD',
    stable: true,
    aliases: ['pyusd', 'paypalusd'],
    tokens: [
      ['ethereum', '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8'], // PayPal USD: LI.FI (verified) + DexScreener largest pool $100,173,173
      ['solana', '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo'], // PayPal USD: LI.FI + DexScreener largest pool $16,648,922
      ['arbitrum', '0x46850aD61C2B7d64d08c9C754F45254596696984'], // PayPal USD: LI.FI (verified) + DexScreener largest pool $531,953
    ],
  },
  {
    symbol: 'RLUSD',
    stable: true,
    aliases: ['rlusd'],
    tokens: [
      ['ethereum', '0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD'], // RLUSD: LI.FI (verified) + DexScreener largest pool $64,211,999
    ],
  },
  {
    symbol: 'USDG',
    stable: true,
    aliases: ['usdg'],
    tokens: [
      ['ethereum', '0xe343167631d89B6Ffc58B88d6b7fB0228795491D'], // Global Dollar: LI.FI (verified) + DexScreener largest pool $20,035,859
      ['solana', '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH'], // Global Dollar: LI.FI + DexScreener largest pool $19,135,777
      ['robinhood', '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'], // USDG: LI.FI + DexScreener largest pool $6,227,355
      ['ink', '0xe343167631d89B6Ffc58B88d6b7fB0228795491D'], // Global Dollar: LI.FI (verified) + DexScreener largest pool $1,251,544
    ],
  },
  {
    symbol: 'USDtb',
    stable: true,
    aliases: ['usdtb'],
    tokens: [
      ['ethereum', '0xC139190F447e929f090Edeb554D95AbB8b18aC1C'], // USDtb: LI.FI (verified) + DexScreener largest pool $20,073,932
    ],
  },
  {
    symbol: 'lisUSD',
    stable: true,
    aliases: ['lisusd'],
    tokens: [
      ['bsc', '0x0782b6d8c4551B9760e74c0545a9bCD90bdc41E5'], // Lista USD: LI.FI (verified) + DexScreener largest pool $27,880,901
    ],
  },
  {
    symbol: 'TUSD',
    stable: true,
    aliases: ['tusd', 'trueusd'],
    tokens: [
      ['bsc', '0x40af3827F39D0EAcBF4A168f8D4ee67c121D11c9'], // TrueUSD: LI.FI (verified) + DexScreener largest pool $993,413
      ['ethereum', '0x0000000000085d4780B73119b644AE5ecd22b376'], // TrueUSD: LI.FI (verified) + DexScreener largest pool $221,213
    ],
  },
  {
    symbol: 'GHO',
    stable: true,
    aliases: ['gho'],
    tokens: [
      ['ethereum', '0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f'], // GHO: LI.FI (verified) + DexScreener largest pool $3,000,793
      ['ink', '0xfc421aD3C883Bf9E7C4f42dE845C4e4405799e73'], // Gho Token: LI.FI (verified) + DexScreener largest pool $1,031,937
      ['base', '0x6Bb7a212910682DCFdbd5BCBb3e28FB4E8da10Ee'], // GHO: LI.FI (verified) + DexScreener largest pool $54,115
    ],
  },
  {
    symbol: 'crvUSD',
    stable: true,
    aliases: ['crvusd'],
    tokens: [
      ['ethereum', '0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E'], // crvUSD: LI.FI (verified) + DexScreener largest pool $56,503,164
    ],
  },
  {
    symbol: 'FRAX',
    stable: true,
    aliases: ['frax'],
    tokens: [
      ['bsc', '0x90C97F71E18723b0Cf0dfa30ee176Ab653E89F40'], // FRAX: LI.FI (verified) + DexScreener largest pool $302,536
      ['ethereum', '0x853d955aCEf822Db058eb8505911ED77F175b99e'], // FRAX: LI.FI (verified) + DexScreener largest pool $34,041,666
      ['avalanche', '0xD24C2Ad096400B6FBcd2ad8B24E7acBc21A1da64'], // Frax: LI.FI (verified) + DexScreener largest pool $246,394
      ['polygon', '0x45c32fA6DF82ead1e2EF74d17b76547EDdFaFF89'], // Frax: LI.FI (verified) + DexScreener largest pool $137,551
      ['optimism', '0x2E3D870790dC77A83DD1d18184Acc7439A53f475'], // FRAX: LI.FI (verified) + DexScreener largest pool $96,167
    ],
  },
  {
    symbol: 'frxUSD',
    stable: true,
    aliases: ['frxusd'],
    tokens: [
      ['ethereum', '0xCAcd6fd266aF91b8AeD52aCCc382b4e165586E29'], // Frax USD: LI.FI (verified) + DexScreener largest pool $16,033,253
    ],
  },
  {
    symbol: 'USDD',
    stable: true,
    aliases: ['usdd'],
    tokens: [
      ['bsc', '0x45E51bc23D592EB2DBA86da3985299f7895d66Ba'], // Decentralized USD: LI.FI (verified) + DexScreener largest pool $100,322
      ['ethereum', '0x4f8e5DE400DE08B164E7421B3EE387f461beCD1A'], // Usdd Stablecoin: LI.FI (verified) + DexScreener largest pool $50,006
    ],
  },
  {
    symbol: 'USDB',
    stable: true,
    aliases: ['usdb'],
    tokens: [
      ['blast', '0x4300000000000000000000000000000000000003'], // USDB: LI.FI (verified) + DexScreener largest pool $156,358
    ],
  },
  {
    symbol: 'AUSD',
    stable: true,
    aliases: ['ausd'],
    tokens: [
      ['ethereum', '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a'], // AUSD: LI.FI (verified) + DexScreener largest pool $34,037,365
      ['monad', '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a'], // Agora USD: LI.FI (verified) + DexScreener largest pool $4,239,082
      ['katana', '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a'], // AUSD: LI.FI (verified) + DexScreener largest pool $153,766
    ],
  },
]

/**
 * All official assets = hand-written + auto-generated top-200 by market cap (officialTokens.generated.ts, regenerated monthly by scripts/build-official-tokens.mjs).
 * Hand-written first: the generator already skips symbols present in the hand-written table; ordering here gives hand-written entries priority on alias conflicts
 */
/**
 * Auto-included tokens treated leniently: two letters or fewer (except OP, universally recognized) plus a few common words.
 * Short but highly recognizable ones (WIF, ARB, JUP) still hide counterfeits
 */
const LOOSE_WORDS = new Set(['ai', 'lit', 'met', 'one', 'cat', 'dog', 'sun', 'max', 'moon'])
const isLoose = (sym: string) => { const n = sym.toLowerCase().replace(/[$.\-_\s]/g, ''); return (n.length <= 2 && n !== 'op') || LOOSE_WORDS.has(n) }
export const OFFICIAL_ASSETS: OfficialAsset[] = [...MANUAL_ASSETS, ...GENERATED_ASSETS.map((a) => (isLoose(a.symbol) ? { ...a, loose: true } : a))]

/** Normalized symbol/search-term form: lowercase, strip $ . - _ and spaces ("$BTC", "btc.b", "W-BTC" all unify) */
export const normSymbol = (s: string) => s.toLowerCase().replace(/[$.\-_\s]/g, '')

const officialKey = (chain: string, address: string) => `${chain}:${address.toLowerCase()}`
const OFFICIAL_BY_KEY = new Map<string, OfficialAsset>()
const ASSET_BY_ALIAS = new Map<string, OfficialAsset>()
for (const a of OFFICIAL_ASSETS) {
  for (const [c, addr] of a.tokens) OFFICIAL_BY_KEY.set(officialKey(c, addr), a)
  for (const al of a.aliases) ASSET_BY_ALIAS.set(al, a)
}

/** Whether this token is some blue-chip token's official contract; returns that token if so */
export function officialAssetOf(chain: string, address: string): OfficialAsset | undefined {
  return OFFICIAL_BY_KEY.get(officialKey(chain, address))
}

/** Which blue-chip token a search term (or a token's symbol) maps to: btc / wbtc / btcb / $BTC all count as BTC */
export function assetForSymbol(s: string): OfficialAsset | undefined {
  return ASSET_BY_ALIAS.get(normSymbol(s))
}

/**
 * Common counterfeit spellings of blue-chip symbols: these affixes around the symbol (ERC20-USDT, USDT-BEP20, BTCPOS, WETH2…), or digits only.
 * Only "wrapped / cross-chain / standard" words count; ordinary meme names (e.g. BTCAT) don't, to avoid misflagging legit tokens
 */
const IMPOSTOR_AFFIXES = ['erc20', 'bep20', 'bep2', 'trc20', 'spl', 'pos', 'wrapped', 'bridged', 'pegged', 'peg', 'token', 'coin']
/** Single letters only count in these positions (WBTC, XBTC, BTC.e, BTC.b); other single-letter combos (SOLE, LINKS) don't, to avoid false flags */
const PREFIX_LETTERS = ['w', 'x']
const SUFFIX_LETTERS = ['e', 'b']

/** Whether this symbol is some blue-chip token (or a common counterfeit spelling of one); returns that token if so */
export function mainstreamLookalike(symbol: string): OfficialAsset | undefined {
  const n = normSymbol(symbol)
  const exact = ASSET_BY_ALIAS.get(n)
  if (exact) return exact
  for (const [al, a] of ASSET_BY_ALIAS) {
    if (al.length < 3 || n.length <= al.length) continue
    const suffix = n.startsWith(al) ? n.slice(al.length) : null
    const prefix = n.endsWith(al) ? n.slice(0, n.length - al.length) : null
    const ok = (r: string | null, letters: string[]) => r !== null && (/^\d{1,3}$/.test(r) || IMPOSTOR_AFFIXES.includes(r) || letters.includes(r))
    // A trailing single letter only counts when the original symbol uses a separator (BTC.e, USDC-b); run-together ones like SOLE are legitimate names
    const sepSuffix = suffix !== null && SUFFIX_LETTERS.includes(suffix) ? /[.\-_\s][a-z]$/i.test(symbol.trim()) : true
    if ((ok(suffix, SUFFIX_LETTERS) && sepSuffix) || ok(prefix, PREFIX_LETTERS)) return a
  }
  return undefined
}
