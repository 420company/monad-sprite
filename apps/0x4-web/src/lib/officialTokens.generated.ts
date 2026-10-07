// ⚠️ 自动生成，别手改：node scripts/build-official-tokens.mjs（每月重跑一次，再跑 scripts/verify-official-tokens.mjs 核对）。
// 市值前 200 的币（不含稳定币、质押、包装、跨链桥、生息、代币化国债），只收我们支持的链上、DexScreener 最大池 ≥ $50,000
// 且价格和 CoinGecko 相差 ≤ 5% 的合约。手写的主流币和稳定币在 officialTokens.ts，这里不重复。
// 生成时间 2026-09-30
import type { OfficialAsset } from './officialTokens'

export const GENERATED_ASSETS: OfficialAsset[] = [
  {
    symbol: 'WBT',
    aliases: ['wbt'],
    tokens: [
      ['ethereum', '0x925206b8a707096ed26ae47c84747fe0bb734f59'], // CoinGecko whitebit（市值第 16）· DexScreener 最大池 $846,181 · 价差 0.1%
    ],
  },
  {
    symbol: 'RAIN',
    aliases: ['rain'],
    tokens: [
      ['arbitrum', '0x25118290e6a5f4139381d072181157035864099d'], // CoinGecko rain（市值第 18）· DexScreener 最大池 $1,139,961 · 价差 0.0%
    ],
  },
  {
    symbol: 'GRAM',
    aliases: ['gram'],
    tokens: [
      ['bsc', '0x76a797a59ba2c17726896976b7b3747bfd1d220f'], // CoinGecko the-open-network（市值第 33）· DexScreener 最大池 $56,187 · 价差 4.7%
    ],
  },
  {
    symbol: 'BTW',
    aliases: ['btw'],
    tokens: [
      ['bsc', '0x444045b0ee1ee319a660a5e3d604ca0ffa35acaa'], // CoinGecko bitway（市值第 34）· DexScreener 最大池 $84,708 · 价差 0.7%
    ],
  },
  {
    symbol: 'SHIB',
    aliases: ['shib'],
    tokens: [
      ['ethereum', '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce'], // CoinGecko shiba-inu（市值第 36）· DexScreener 最大池 $3,109,103 · 价差 0.3%
    ],
  },
  {
    symbol: 'XAUT',
    aliases: ['xaut'],
    tokens: [
      ['ethereum', '0x68749665ff8d2d112fa859aa293f07a622782f38'], // CoinGecko tether-gold（市值第 37）· DexScreener 最大池 $5,725,725 · 价差 0.0%
    ],
  },
  {
    symbol: 'PUMP',
    aliases: ['pump'],
    tokens: [
      ['solana', 'pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn'], // CoinGecko pump-fun（市值第 41）· DexScreener 最大池 $27,787,622 · 价差 0.4%
    ],
  },
  {
    symbol: 'OKB',
    aliases: ['okb'],
    tokens: [
      ['ethereum', '0x75231f58b43240c9718dd58b4967c5114342a86c'], // CoinGecko okb（市值第 42）· DexScreener 最大池 $53,927 · 价差 1.4%
    ],
  },
  {
    symbol: 'ENA',
    aliases: ['ena'],
    tokens: [
      ['ethereum', '0x57e114b691db790c35207b2e685d4a43181e6061'], // CoinGecko ethena（市值第 43）· DexScreener 最大池 $2,946,957 · 价差 0.3%
      ['base', '0x58538e6a46e07434d7e7375bc268d3cb839c0133'], // CoinGecko ethena（市值第 43）· DexScreener 最大池 $55,931 · 价差 0.1%
      ['solana', '72QvBVwpxqmheEPfaCwWSWqEFsUy3rhWt6JhQBMNTwD1'], // CoinGecko ethena（市值第 43）· DexScreener 最大池 $112,081 · 价差 0.6%
    ],
  },
  {
    symbol: 'AAVE',
    aliases: ['aave'],
    tokens: [
      ['solana', 'AavE1kKKnesPw4MuRJmJ9jZs9QzEE8CPxQ3ViczUDfc1'], // CoinGecko aave（市值第 45）· DexScreener 最大池 $59,346 · 价差 0.2%
      ['base', '0x63706e401c06ac8513145b7687a14804d17f814b'], // CoinGecko aave（市值第 45）· DexScreener 最大池 $1,462,574 · 价差 0.3%
      ['polygon', '0xd6df932a45c0f255f85145f286ea0b292b21c90b'], // CoinGecko aave（市值第 45）· DexScreener 最大池 $553,640 · 价差 0.3%
      ['bsc', '0xfb6115445bff7b52feb98650c87f44907e58f802'], // CoinGecko aave（市值第 45）· DexScreener 最大池 $127,080 · 价差 0.0%
      ['arbitrum', '0xba5ddd1f9d7f570dc94a51479a000e3bce967196'], // CoinGecko aave（市值第 45）· DexScreener 最大池 $431,224 · 价差 0.2%
      ['optimism', '0x76fb31fb4af56892a25e32cfc43de717950c9278'], // CoinGecko aave（市值第 45）· DexScreener 最大池 $153,792 · 价差 1.1%
      ['avalanche', '0x63a72806098bd3d9520cc43356dd78afe5d386d9'], // CoinGecko aave（市值第 45）· DexScreener 最大池 $448,469 · 价差 0.1%
    ],
  },
  {
    symbol: 'ONDO',
    aliases: ['ondo'],
    tokens: [
      ['ethereum', '0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3'], // CoinGecko ondo-finance（市值第 46）· DexScreener 最大池 $4,805,052 · 价差 0.4%
    ],
  },
  {
    symbol: 'MNT',
    aliases: ['mnt'],
    tokens: [
      ['ethereum', '0x3c3a81e81dc49a522a592e7622a7e711c06bf354'], // CoinGecko mantle（市值第 51）· DexScreener 最大池 $3,856,867 · 价差 0.1%
    ],
  },
  {
    symbol: 'ASTER',
    aliases: ['aster'],
    tokens: [
      ['bsc', '0x000ae314e2a2172a039b26378814c252734f556a'], // CoinGecko aster-2（市值第 53）· DexScreener 最大池 $1,175,652 · 价差 0.1%
    ],
  },
  {
    symbol: 'ICP',
    aliases: ['icp'],
    tokens: [
      ['base', '0x00f3c42833c3170159af4e92dbb451fb3f708917'], // CoinGecko internet-computer（市值第 54）· DexScreener 最大池 $723,681 · 价差 1.2%
      ['ethereum', '0x00f3c42833c3170159af4e92dbb451fb3f708917'], // CoinGecko internet-computer（市值第 54）· DexScreener 最大池 $607,609 · 价差 1.2%
    ],
  },
  {
    symbol: 'SKY',
    aliases: ['sky'],
    tokens: [
      ['ethereum', '0x56072c95faa701256059aa122697b133aded9279'], // CoinGecko sky（市值第 55）· DexScreener 最大池 $9,861,020 · 价差 0.3%
    ],
  },
  {
    symbol: 'WLD',
    aliases: ['wld'],
    tokens: [
      ['ethereum', '0x163f8c2467924be0ae7b5347228cabf260318753'], // CoinGecko worldcoin-wld（市值第 56）· DexScreener 最大池 $212,201 · 价差 0.0%
      ['worldchain', '0x2cfc85d8e48f8eab294be644d9e25c3030863003'], // CoinGecko worldcoin-wld（市值第 56）· DexScreener 最大池 $445,799 · 价差 0.6%
      ['optimism', '0xdc6ff44d5d932cbd77b52e5612ba0529dc6226f1'], // CoinGecko worldcoin-wld（市值第 56）· DexScreener 最大池 $62,507 · 价差 0.0%
    ],
  },
  {
    symbol: 'PAXG',
    aliases: ['paxg'],
    tokens: [
      ['ethereum', '0x45804880de22913dafe09f4980848ece6ecbaf78'], // CoinGecko pax-gold（市值第 57）· DexScreener 最大池 $16,114,128 · 价差 0.2%
    ],
  },
  {
    symbol: 'WLFI',
    aliases: ['wlfi'],
    tokens: [
      ['ethereum', '0xda5e1988097297dcdc1f90d4dfe7909e847cbef6'], // CoinGecko world-liberty-financial（市值第 58）· DexScreener 最大池 $4,167,939 · 价差 0.9%
      ['bsc', '0x47474747477b199288bf72a1d702f7fe0fb1deea'], // CoinGecko world-liberty-financial（市值第 58）· DexScreener 最大池 $2,857,927 · 价差 0.5%
    ],
  },
  {
    symbol: 'PEPE',
    aliases: ['pepe'],
    tokens: [
      ['ethereum', '0x6982508145454ce325ddbe47a25d4ec3d2311933'], // CoinGecko pepe（市值第 59）· DexScreener 最大池 $31,430,700 · 价差 0.0%
      ['bsc', '0x25d887ce7a35172c62febfd67a1856f20faebb00'], // CoinGecko pepe（市值第 59）· DexScreener 最大池 $303,609 · 价差 0.6%
    ],
  },
  {
    symbol: 'MORPHO',
    aliases: ['morpho'],
    tokens: [
      ['ethereum', '0x58d97b57bb95320f9a05dc918aef65434969c2b2'], // CoinGecko morpho（市值第 60）· DexScreener 最大池 $123,141 · 价差 0.4%
      ['base', '0xbaa5cc21fd487b8fcc2f632f3f4e8d37262a0842'], // CoinGecko morpho（市值第 60）· DexScreener 最大池 $1,683,266 · 价差 0.4%
    ],
  },
  {
    symbol: 'HTX',
    aliases: ['htx'],
    tokens: [
      ['bsc', '0x61ec85ab89377db65762e234c946b5c25a56e99e'], // CoinGecko htx-dao（市值第 61）· DexScreener 最大池 $3,532,898 · 价差 1.3%
    ],
  },
  {
    symbol: 'ARB',
    aliases: ['arb'],
    tokens: [
      ['arbitrum', '0x912ce59144191c1204e64559fe8253a0e49e6548'], // CoinGecko arbitrum（市值第 66）· DexScreener 最大池 $1,898,590 · 价差 0.2%
    ],
  },
  {
    symbol: 'BGB',
    aliases: ['bgb'],
    tokens: [
      ['ethereum', '0x54d2252757e1672eead234d27b1270728ff90581'], // CoinGecko bitget-token（市值第 67）· DexScreener 最大池 $485,682 · 价差 1.0%
    ],
  },
  {
    symbol: 'VVV',
    aliases: ['vvv'],
    tokens: [
      ['base', '0xacfe6019ed1a7dc6f7b508c02d1b04ec88cc21bf'], // CoinGecko venice-token（市值第 70）· DexScreener 最大池 $17,820,645 · 价差 0.1%
    ],
  },
  {
    symbol: 'JUP',
    aliases: ['jup'],
    tokens: [
      ['solana', 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'], // CoinGecko jupiter-exchange-solana（市值第 76）· DexScreener 最大池 $2,117,198 · 价差 0.0%
    ],
  },
  {
    symbol: 'RENDER',
    aliases: ['render'],
    tokens: [
      ['ethereum', '0x6de037ef9ad2725eb40118bb1702ebb27e4aeb24'], // CoinGecko render-token（市值第 80）· DexScreener 最大池 $411,112 · 价差 0.5%
      ['solana', 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof'], // CoinGecko render-token（市值第 80）· DexScreener 最大池 $370,696 · 价差 0.5%
    ],
  },
  {
    symbol: 'LIT',
    aliases: ['lit'],
    tokens: [
      ['ethereum', '0x232ce3bd40fcd6f80f3d55a522d03f25df784ee2'], // CoinGecko lighter（市值第 82）· DexScreener 最大池 $379,731 · 价差 0.8%
      ['robinhood', '0xeeca2e7dc194a320d349122d88259bb9595a4cb0'], // CoinGecko lighter（市值第 82）· DexScreener 最大池 $547,419 · 价差 1.6%
    ],
  },
  {
    symbol: 'NEXO',
    aliases: ['nexo'],
    tokens: [
      ['ethereum', '0xb62132e35a6c13ee1ee0f84dc5d40bad8d815206'], // CoinGecko nexo（市值第 86）· DexScreener 最大池 $1,382,215 · 价差 0.1%
    ],
  },
  {
    symbol: 'AERO',
    aliases: ['aero'],
    tokens: [
      ['base', '0x940181a94a35a4569e4529a3cdfb74e38fd98631'], // CoinGecko aerodrome-finance（市值第 87）· DexScreener 最大池 $41,785,087 · 价差 0.3%
    ],
  },
  {
    symbol: 'INJ',
    aliases: ['inj'],
    tokens: [
      ['ethereum', '0xe28b3b32b6c345a34ff64674606124dd5aceca30'], // CoinGecko injective-protocol（市值第 90）· DexScreener 最大池 $477,591 · 价差 0.1%
      ['bsc', '0xa2b726b1145a4773f68593cf171187d8ebe4d495'], // CoinGecko injective-protocol（市值第 90）· DexScreener 最大池 $223,229 · 价差 0.4%
      ['solana', '1NJMqVM4PadjuzYmeB7zV7q7DV8oB3ExaQCd9x6KsLz'], // CoinGecko injective-protocol（市值第 90）· DexScreener 最大池 $195,326 · 价差 0.3%
    ],
  },
  {
    symbol: 'STABLE',
    aliases: ['stable'],
    tokens: [
      ['bsc', '0x011ebe7d75e2c9d1e0bd0be0bef5c36f0a90075f'], // CoinGecko stable-2（市值第 91）· DexScreener 最大池 $901,575 · 价差 0.2%
    ],
  },
  {
    symbol: 'ETHFI',
    aliases: ['ethfi'],
    tokens: [
      ['ethereum', '0xfe0c30065b384f05761f15d0cc899d4f9f9cc0eb'], // CoinGecko ether-fi（市值第 93）· DexScreener 最大池 $1,224,793 · 价差 1.0%
      ['base', '0x6c240dda6b5c336df09a4d011139beaaa1ea2aa2'], // CoinGecko ether-fi（市值第 93）· DexScreener 最大池 $180,192 · 价差 0.2%
      ['arbitrum', '0x7189fb5b6504bbff6a852b13b7b82a3c118fdc27'], // CoinGecko ether-fi（市值第 93）· DexScreener 最大池 $147,917 · 价差 0.3%
    ],
  },
  {
    symbol: 'AKE',
    aliases: ['ake'],
    tokens: [
      ['bsc', '0x2c3a8ee94ddd97244a93bc48298f97d2c412f7db'], // CoinGecko akedo（市值第 95）· DexScreener 最大池 $2,698,855 · 价差 0.3%
    ],
  },
  {
    symbol: 'PENGU',
    aliases: ['pengu'],
    tokens: [
      ['solana', '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv'], // CoinGecko pudgy-penguins（市值第 100）· DexScreener 最大池 $4,460,736 · 价差 1.0%
      ['abstract', '0x9ebe3a824ca958e4b3da772d2065518f009cba62'], // CoinGecko pudgy-penguins（市值第 100）· DexScreener 最大池 $447,891 · 价差 0.9%
      ['robinhood', '0x74be72affafbc8de30f0c11247814036314d625f'], // CoinGecko pudgy-penguins（市值第 100）· DexScreener 最大池 $206,238 · 价差 0.7%
      ['bsc', '0x6418c0dd099a9fda397c766304cdd918233e8847'], // CoinGecko pudgy-penguins（市值第 100）· DexScreener 最大池 $113,263 · 价差 0.7%
    ],
  },
  {
    symbol: 'PYTH',
    aliases: ['pyth'],
    tokens: [
      ['solana', 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3'], // CoinGecko pyth-network（市值第 101）· DexScreener 最大池 $429,532 · 价差 0.1%
    ],
  },
  {
    symbol: 'ZRO',
    aliases: ['zro'],
    tokens: [
      ['ethereum', '0x6985884c4392d348587b19cb9eaaf157f13271cd'], // CoinGecko layerzero（市值第 102）· DexScreener 最大池 $62,766 · 价差 0.0%
      ['base', '0x6985884c4392d348587b19cb9eaaf157f13271cd'], // CoinGecko layerzero（市值第 102）· DexScreener 最大池 $178,886 · 价差 0.0%
      ['arbitrum', '0x6985884c4392d348587b19cb9eaaf157f13271cd'], // CoinGecko layerzero（市值第 102）· DexScreener 最大池 $104,388 · 价差 0.0%
      ['optimism', '0x6985884c4392d348587b19cb9eaaf157f13271cd'], // CoinGecko layerzero（市值第 102）· DexScreener 最大池 $67,905 · 价差 0.0%
    ],
  },
  {
    symbol: 'CRV',
    aliases: ['crv'],
    tokens: [
      ['base', '0x8ee73c484a26e0a5df2ee2a4960b789967dd0415'], // CoinGecko curve-dao-token（市值第 103）· DexScreener 最大池 $161,116 · 价差 0.3%
      ['polygon', '0x172370d5cd63279efa6d502dab29171933a610af'], // CoinGecko curve-dao-token（市值第 103）· DexScreener 最大池 $54,671 · 价差 0.0%
      ['arbitrum', '0x11cdb42b0eb46d95f990bedd4695a6e3fa034978'], // CoinGecko curve-dao-token（市值第 103）· DexScreener 最大池 $568,521 · 价差 0.1%
    ],
  },
  {
    symbol: 'TRUMP',
    aliases: ['trump'],
    tokens: [
      ['solana', '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN'], // CoinGecko official-trump（市值第 106）· DexScreener 最大池 $12,828,137 · 价差 0.1%
    ],
  },
  {
    symbol: 'GRASS',
    aliases: ['grass'],
    tokens: [
      ['solana', 'Grass7B4RdKfBCjTKgSqnXkqjwiGvQyFbuSCUJr3XXjs'], // CoinGecko grass（市值第 110）· DexScreener 最大池 $569,836 · 价差 0.3%
    ],
  },
  {
    symbol: 'VIRTUAL',
    aliases: ['virtual'],
    tokens: [
      ['ethereum', '0x44ff8620b8ca30902395a7bd3f2407e1a091bf73'], // CoinGecko virtual-protocol（市值第 111）· DexScreener 最大池 $293,188 · 价差 0.5%
      ['base', '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b'], // CoinGecko virtual-protocol（市值第 111）· DexScreener 最大池 $4,522,441 · 价差 0.2%
      ['solana', '3iQL8BFS2vE7mww4ehAqQHAsbmRNCrPxizWAT2Zfyr9y'], // CoinGecko virtual-protocol（市值第 111）· DexScreener 最大池 $1,304,128 · 价差 0.7%
      ['robinhood', '0xc6911796042b15d7fa4f6cde69e245ddcd3d9c31'], // CoinGecko virtual-protocol（市值第 111）· DexScreener 最大池 $2,486,416 · 价差 0.4%
      ['arc', '0x8c4252c87081c88c6ad57d6dd97e1cafebf842b7'], // CoinGecko virtual-protocol（市值第 111）· DexScreener 最大池 $457,837 · 价差 0.4%
    ],
  },
  {
    symbol: 'FET',
    aliases: ['fet'],
    tokens: [
      ['ethereum', '0xaea46a60368a7bd060eec7df8cba43b7ef41ad85'], // CoinGecko fetch-ai（市值第 112）· DexScreener 最大池 $1,677,520 · 价差 0.6%
      ['bsc', '0x031b41e504677879370e9dbcf937283a8691fa7f'], // CoinGecko fetch-ai（市值第 112）· DexScreener 最大池 $100,784 · 价差 0.3%
    ],
  },
  {
    symbol: 'RAY',
    aliases: ['ray'],
    tokens: [
      ['solana', '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R'], // CoinGecko raydium（市值第 113）· DexScreener 最大池 $6,604,510 · 价差 0.5%
    ],
  },
  {
    symbol: '币安人生',
    aliases: ['币安人生'],
    tokens: [
      ['bsc', '0x924fa68a0fc644485b8df8abfa0a41c2e7744444'], // CoinGecko bianrensheng（市值第 114）· DexScreener 最大池 $8,179,759 · 价差 0.0%
    ],
  },
  {
    symbol: 'FF',
    aliases: ['ff'],
    tokens: [
      ['bsc', '0xac23b90a79504865d52b49b327328411a23d4db2'], // CoinGecko falcon-finance-ff（市值第 125）· DexScreener 最大池 $4,271,608 · 价差 0.8%
    ],
  },
  {
    symbol: 'PENDLE',
    aliases: ['pendle'],
    tokens: [
      ['ethereum', '0x808507121b80c02388fad14726482e061b8da827'], // CoinGecko pendle（市值第 126）· DexScreener 最大池 $464,034 · 价差 1.3%
      ['base', '0xa99f6e6785da0f5d6fb42495fe424bce029eeb3e'], // CoinGecko pendle（市值第 126）· DexScreener 最大池 $217,993 · 价差 0.9%
      ['bsc', '0xb3ed0a426155b79b898849803e3b36552f7ed507'], // CoinGecko pendle（市值第 126）· DexScreener 最大池 $779,461 · 价差 0.0%
      ['arbitrum', '0x0c880f6761f1af8d9aa9c466984b80dab9a8c9e8'], // CoinGecko pendle（市值第 126）· DexScreener 最大池 $2,397,195 · 价差 0.0%
      ['robinhood', '0x5e49e1f85813f2b65858860a3fa231b4186f2e0e'], // CoinGecko pendle（市值第 126）· DexScreener 最大池 $113,537 · 价差 1.3%
    ],
  },
  {
    symbol: 'LDO',
    aliases: ['ldo'],
    tokens: [
      ['ethereum', '0x5a98fcbea516cf06857215779fd812ca3bef1b32'], // CoinGecko lido-dao（市值第 129）· DexScreener 最大池 $580,408 · 价差 0.1%
      ['polygon', '0xc3c7d422809852031b44ab29eec9f1eff2a58756'], // CoinGecko lido-dao（市值第 129）· DexScreener 最大池 $102,696 · 价差 0.3%
      ['arbitrum', '0x13ad51ed4f1b7e9dc168d8a00cb3f4ddd85efa60'], // CoinGecko lido-dao（市值第 129）· DexScreener 最大池 $72,960 · 价差 0.5%
    ],
  },
  {
    symbol: 'DRV',
    aliases: ['drv'],
    tokens: [
      ['ethereum', '0xb1d1eae60eea9525032a6dcb4c1ce336a1de71be'], // CoinGecko derive（市值第 131）· DexScreener 最大池 $136,740 · 价差 1.6%
      ['base', '0x9d0e8f5b25384c7310cb8c6ae32c8fbeb645d083'], // CoinGecko derive（市值第 131）· DexScreener 最大池 $4,843,080 · 价差 0.0%
      ['hyperevm', '0x9628bba16db41ea7fe1fd84f9ce53bc27c63f59b'], // CoinGecko derive（市值第 131）· DexScreener 最大池 $194,509 · 价差 0.1%
    ],
  },
  {
    symbol: 'UB',
    aliases: ['ub'],
    tokens: [
      ['bsc', '0x40b8129b786d766267a7a118cf8c07e31cdb6fde'], // CoinGecko unibase（市值第 132）· DexScreener 最大池 $4,097,283 · 价差 0.1%
    ],
  },
  {
    symbol: 'PONS',
    aliases: ['pons'],
    tokens: [
      ['robinhood', '0x39dbed3a2bd333467115de45665cc57f813c4571'], // CoinGecko pons（市值第 133）· DexScreener 最大池 $6,223,021 · 价差 0.4%
    ],
  },
  {
    symbol: 'BTT',
    aliases: ['btt'],
    tokens: [
      ['bsc', '0x352cb5e19b12fc216548a2677bd0fce83bae434b'], // CoinGecko bittorrent（市值第 134）· DexScreener 最大池 $95,615 · 价差 0.9%
    ],
  },
  {
    symbol: '2Z',
    aliases: ['2z'],
    tokens: [
      ['solana', 'J6pQQ3FAcJQeWPPGppWRb4nM8jU3wLyYbRrLh7feMfvd'], // CoinGecko doublezero（市值第 136）· DexScreener 最大池 $1,008,460 · 价差 0.1%
    ],
  },
  {
    symbol: 'BONK',
    aliases: ['bonk'],
    tokens: [
      ['solana', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'], // CoinGecko bonk（市值第 138）· DexScreener 最大池 $427,783 · 价差 0.1%
      ['bsc', '0xa697e272a73744b343528c3bc4702f2565b2f422'], // CoinGecko bonk（市值第 138）· DexScreener 最大池 $91,424 · 价差 0.3%
    ],
  },
  {
    symbol: 'KITE',
    aliases: ['kite'],
    tokens: [
      ['ethereum', '0x118b70df4f06fa5678e7d543e6066e028c8ea0c0'], // CoinGecko kite-2（市值第 142）· DexScreener 最大池 $806,636 · 价差 0.1%
    ],
  },
  {
    symbol: 'GRT',
    aliases: ['grt'],
    tokens: [
      ['ethereum', '0xc944e90c64b2c07662a292be6244bdf05cda44a7'], // CoinGecko the-graph（市值第 147）· DexScreener 最大池 $178,592 · 价差 0.0%
      ['arbitrum', '0x9623063377ad1b27544c965ccd7342f7ea7e88c7'], // CoinGecko the-graph（市值第 147）· DexScreener 最大池 $82,858 · 价差 0.1%
    ],
  },
  {
    symbol: 'GNO',
    aliases: ['gno'],
    tokens: [
      ['ethereum', '0x6810e776880c02933d47db1b9fc05908e5386b96'], // CoinGecko gnosis（市值第 149）· DexScreener 最大池 $99,757 · 价差 0.4%
    ],
  },
  {
    symbol: 'STRK',
    aliases: ['strk'],
    tokens: [
      ['ethereum', '0xca14007eff0db1f8135f4c25b34de49ab0d42766'], // CoinGecko starknet（市值第 150）· DexScreener 最大池 $94,506 · 价差 0.5%
      ['solana', 'HsRpHQn6VbyMs5b5j5SV6xQ2VvpvvCCzu19GjytVSCoz'], // CoinGecko starknet（市值第 150）· DexScreener 最大池 $187,225 · 价差 0.6%
    ],
  },
  {
    symbol: 'BP',
    aliases: ['bp'],
    tokens: [
      ['solana', 'BPxxfRCXkUVhig4HS1Lh7kZqV6SPJhzfEk4x6fVBjPCy'], // CoinGecko backpack（市值第 151）· DexScreener 最大池 $5,762,138 · 价差 0.0%
    ],
  },
  {
    symbol: 'OP',
    aliases: ['op'],
    tokens: [
      ['optimism', '0x4200000000000000000000000000000000000042'], // CoinGecko optimism（市值第 152）· DexScreener 最大池 $373,060 · 价差 0.1%
    ],
  },
  {
    symbol: 'ENS',
    aliases: ['ens'],
    tokens: [
      ['ethereum', '0xc18360217d8f7ab5e7c516566761ea12ce7f9d72'], // CoinGecko ethereum-name-service（市值第 153）· DexScreener 最大池 $746,327 · 价差 0.4%
    ],
  },
  {
    symbol: 'JTO',
    aliases: ['jto'],
    tokens: [
      ['solana', 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL'], // CoinGecko jito-governance-token（市值第 154）· DexScreener 最大池 $1,406,401 · 价差 0.4%
    ],
  },
  {
    symbol: 'OHM',
    aliases: ['ohm'],
    tokens: [
      ['ethereum', '0x64aa3364f17a4d01c6f1751fd97c2bd3d7e7f1d5'], // CoinGecko olympus（市值第 155）· DexScreener 最大池 $11,577,935 · 价差 0.7%
      ['berachain', '0x18878df23e2a36f81e820e4b47b4a40576d3159c'], // CoinGecko olympus（市值第 155）· DexScreener 最大池 $339,975 · 价差 3.2%
      ['arbitrum', '0xf0cb2dc0db5e6c66b9a70ac27b06b878da017028'], // CoinGecko olympus（市值第 155）· DexScreener 最大池 $282,121 · 价差 3.1%
    ],
  },
  {
    symbol: 'TIBBIR',
    aliases: ['tibbir'],
    tokens: [
      ['base', '0xa4a2e2ca3fbfe21aed83471d28b6f65a233c6e00'], // CoinGecko ribbita-by-virtuals（市值第 156）· DexScreener 最大池 $4,022,022 · 价差 0.2%
    ],
  },
  {
    symbol: 'SYRUP',
    aliases: ['syrup'],
    tokens: [
      ['ethereum', '0x643c4e15d7d62ad0abec4a9bd4b001aa3ef52d66'], // CoinGecko syrup（市值第 162）· DexScreener 最大池 $2,014,782 · 价差 0.3%
      ['base', '0x688aee022aa544f150678b8e5720b6b96a9e9a2f'], // CoinGecko syrup（市值第 162）· DexScreener 最大池 $54,815 · 价差 0.6%
    ],
  },
  {
    symbol: 'FLOKI',
    aliases: ['floki'],
    tokens: [
      ['ethereum', '0xcf0c122c6b73ff809c693db761e7baebe62b6a2e'], // CoinGecko floki（市值第 163）· DexScreener 最大池 $8,160,418 · 价差 0.4%
      ['bsc', '0xfb5b838b6cfeedc2873ab27866079ac55363d37e'], // CoinGecko floki（市值第 163）· DexScreener 最大池 $9,778,379 · 价差 0.4%
    ],
  },
  {
    symbol: 'COMP',
    aliases: ['comp'],
    tokens: [
      ['ethereum', '0xc00e94cb662c3520282e6f5717214004a7f26888'], // CoinGecko compound-governance-token（市值第 164）· DexScreener 最大池 $1,643,989 · 价差 0.1%
    ],
  },
  {
    symbol: 'ZBCN',
    aliases: ['zbcn'],
    tokens: [
      ['solana', 'ZBCNpuD7YMXzTHB2fhGkGi78MNsHGLRXUhRewNRm9RU'], // CoinGecko zebec-network（市值第 166）· DexScreener 最大池 $191,806 · 价差 0.8%
    ],
  },
  {
    symbol: 'SHFL',
    aliases: ['shfl'],
    tokens: [
      ['ethereum', '0x8881562783028f5c1bcb985d2283d5e170d88888'], // CoinGecko shuffle-2（市值第 167）· DexScreener 最大池 $9,974,529 · 价差 0.2%
    ],
  },
  {
    symbol: 'STONK',
    aliases: ['stonk'],
    tokens: [
      ['solana', '6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx'], // CoinGecko stonk-3（市值第 168）· DexScreener 最大池 $3,239,254 · 价差 0.2%
    ],
  },
  {
    symbol: 'TWT',
    aliases: ['twt'],
    tokens: [
      ['bsc', '0x4b0f1812e5df2a09796481ff14017e6005508003'], // CoinGecko trust-wallet-token（市值第 169）· DexScreener 最大池 $615,270 · 价差 0.0%
    ],
  },
  {
    symbol: 'WIF',
    aliases: ['wif'],
    tokens: [
      ['solana', 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'], // CoinGecko dogwifcoin（市值第 171）· DexScreener 最大池 $6,787,548 · 价差 0.1%
    ],
  },
  {
    symbol: 'KMNO',
    aliases: ['kmno'],
    tokens: [
      ['solana', 'KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS'], // CoinGecko kamino（市值第 172）· DexScreener 最大池 $2,080,581 · 价差 0.3%
    ],
  },
  {
    symbol: 'EIGEN',
    aliases: ['eigen'],
    tokens: [
      ['ethereum', '0xec53bf9167f50cdeb3ae105f56099aaab9061f83'], // CoinGecko eigenlayer（市值第 173）· DexScreener 最大池 $4,065,629 · 价差 0.1%
    ],
  },
  {
    symbol: 'USELESS',
    aliases: ['useless'],
    tokens: [
      ['solana', 'Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk'], // CoinGecko useless-3（市值第 176）· DexScreener 最大池 $5,345,795 · 价差 0.4%
      ['bsc', '0xba38b3c706f7a515ff7c8db04daa0a134ec46d2b'], // CoinGecko useless-3（市值第 176）· DexScreener 最大池 $882,091 · 价差 0.2%
    ],
  },
  {
    symbol: 'BR',
    aliases: ['br'],
    tokens: [
      ['bsc', '0xff7d6a96ae471bbcd7713af9cb1feeb16cf56b41'], // CoinGecko bedrock-token（市值第 178）· DexScreener 最大池 $4,088,402 · 价差 0.1%
    ],
  },
  {
    symbol: 'KOGE',
    aliases: ['koge'],
    tokens: [
      ['bsc', '0xe6df05ce8c8301223373cf5b969afcb1498c5528'], // CoinGecko bnb48-club-token（市值第 180）· DexScreener 最大池 $1,121,983 · 价差 0.3%
    ],
  },
  {
    symbol: 'CVX',
    aliases: ['cvx'],
    tokens: [
      ['ethereum', '0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b'], // CoinGecko convex-finance（市值第 188）· DexScreener 最大池 $6,679,848 · 价差 0.5%
    ],
  },
  {
    symbol: 'AXS',
    aliases: ['axs'],
    tokens: [
      ['ethereum', '0xbb0e17ef65f82ab018d8edd776e8dd940327b28b'], // CoinGecko axie-infinity（市值第 190）· DexScreener 最大池 $106,767 · 价差 0.0%
    ],
  },
  {
    symbol: 'MET',
    aliases: ['met'],
    tokens: [
      ['solana', 'METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL'], // CoinGecko meteora（市值第 193）· DexScreener 最大池 $3,090,995 · 价差 0.3%
    ],
  },
  {
    symbol: 'ZAMA',
    aliases: ['zama'],
    tokens: [
      ['ethereum', '0xa12cc123ba206d4031d1c7f6223d1c2ec249f4f3'], // CoinGecko zama（市值第 194）· DexScreener 最大池 $618,713 · 价差 0.1%
      ['solana', '4Zp52aF4hZi9fzH19xpbWKYKQvgLyCN67KFbrQDqeTKh'], // CoinGecko zama（市值第 194）· DexScreener 最大池 $123,118 · 价差 0.7%
    ],
  },
  {
    symbol: 'XCN',
    aliases: ['xcn'],
    tokens: [
      ['ethereum', '0xa2cd3d43c775978a96bdbf12d733d5a1ed94fb18'], // CoinGecko chain-2（市值第 195）· DexScreener 最大池 $876,086 · 价差 0.2%
      ['base', '0x9c632e6aaa3ea73f91554f8a3cb2ed2f29605e0c'], // CoinGecko chain-2（市值第 195）· DexScreener 最大池 $186,914 · 价差 1.7%
    ],
  },
  {
    symbol: 'FARTCOIN',
    aliases: ['fartcoin'],
    tokens: [
      ['solana', '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump'], // CoinGecko fartcoin（市值第 199）· DexScreener 最大池 $8,927,552 · 价差 0.6%
    ],
  },
  {
    symbol: 'AI',
    aliases: ['ai'],
    tokens: [
      ['robinhood', '0x2e8c31162b855a2ffa90f6f8634643ad6f111e18'], // CoinGecko artificial-inu-3（市值第 200）· DexScreener 最大池 $4,956,898 · 价差 0.1%
    ],
  },
]
