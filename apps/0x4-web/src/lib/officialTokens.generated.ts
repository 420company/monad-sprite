// ⚠️ Auto-generated, do not hand-edit: node scripts/build-official-tokens.mjs (re-run monthly, then verify with scripts/verify-official-tokens.mjs).
// Top 200 by market cap (excluding stablecoins, staked, wrapped, bridged, yield-bearing, and tokenized treasuries); only tokens on chains we support with a DexScreener largest pool ≥ $50,000
// and contracts whose price differs from CoinGecko by ≤ 5%. Hand-curated majors and stablecoins live in officialTokens.ts and are not duplicated here.
// Generated 2026-09-30
import type { OfficialAsset } from './officialTokens'

export const GENERATED_ASSETS: OfficialAsset[] = [
  {
    symbol: 'WBT',
    aliases: ['wbt'],
    tokens: [
      ['ethereum', '0x925206b8a707096ed26ae47c84747fe0bb734f59'], // CoinGecko whitebit (mcap rank #16) · DexScreener largest pool $846,181 · price diff 0.1%
    ],
  },
  {
    symbol: 'RAIN',
    aliases: ['rain'],
    tokens: [
      ['arbitrum', '0x25118290e6a5f4139381d072181157035864099d'], // CoinGecko rain (mcap rank #18) · DexScreener largest pool $1,139,961 · price diff 0.0%
    ],
  },
  {
    symbol: 'GRAM',
    aliases: ['gram'],
    tokens: [
      ['bsc', '0x76a797a59ba2c17726896976b7b3747bfd1d220f'], // CoinGecko the-open-network (mcap rank #33) · DexScreener largest pool $56,187 · price diff 4.7%
    ],
  },
  {
    symbol: 'BTW',
    aliases: ['btw'],
    tokens: [
      ['bsc', '0x444045b0ee1ee319a660a5e3d604ca0ffa35acaa'], // CoinGecko bitway (mcap rank #34) · DexScreener largest pool $84,708 · price diff 0.7%
    ],
  },
  {
    symbol: 'SHIB',
    aliases: ['shib'],
    tokens: [
      ['ethereum', '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce'], // CoinGecko shiba-inu (mcap rank #36) · DexScreener largest pool $3,109,103 · price diff 0.3%
    ],
  },
  {
    symbol: 'XAUT',
    aliases: ['xaut'],
    tokens: [
      ['ethereum', '0x68749665ff8d2d112fa859aa293f07a622782f38'], // CoinGecko tether-gold (mcap rank #37) · DexScreener largest pool $5,725,725 · price diff 0.0%
    ],
  },
  {
    symbol: 'PUMP',
    aliases: ['pump'],
    tokens: [
      ['solana', 'pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn'], // CoinGecko pump-fun (mcap rank #41) · DexScreener largest pool $27,787,622 · price diff 0.4%
    ],
  },
  {
    symbol: 'OKB',
    aliases: ['okb'],
    tokens: [
      ['ethereum', '0x75231f58b43240c9718dd58b4967c5114342a86c'], // CoinGecko okb (mcap rank #42) · DexScreener largest pool $53,927 · price diff 1.4%
    ],
  },
  {
    symbol: 'ENA',
    aliases: ['ena'],
    tokens: [
      ['ethereum', '0x57e114b691db790c35207b2e685d4a43181e6061'], // CoinGecko ethena (mcap rank #43) · DexScreener largest pool $2,946,957 · price diff 0.3%
      ['base', '0x58538e6a46e07434d7e7375bc268d3cb839c0133'], // CoinGecko ethena (mcap rank #43) · DexScreener largest pool $55,931 · price diff 0.1%
      ['solana', '72QvBVwpxqmheEPfaCwWSWqEFsUy3rhWt6JhQBMNTwD1'], // CoinGecko ethena (mcap rank #43) · DexScreener largest pool $112,081 · price diff 0.6%
    ],
  },
  {
    symbol: 'AAVE',
    aliases: ['aave'],
    tokens: [
      ['solana', 'AavE1kKKnesPw4MuRJmJ9jZs9QzEE8CPxQ3ViczUDfc1'], // CoinGecko aave (mcap rank #45) · DexScreener largest pool $59,346 · price diff 0.2%
      ['base', '0x63706e401c06ac8513145b7687a14804d17f814b'], // CoinGecko aave (mcap rank #45) · DexScreener largest pool $1,462,574 · price diff 0.3%
      ['polygon', '0xd6df932a45c0f255f85145f286ea0b292b21c90b'], // CoinGecko aave (mcap rank #45) · DexScreener largest pool $553,640 · price diff 0.3%
      ['bsc', '0xfb6115445bff7b52feb98650c87f44907e58f802'], // CoinGecko aave (mcap rank #45) · DexScreener largest pool $127,080 · price diff 0.0%
      ['arbitrum', '0xba5ddd1f9d7f570dc94a51479a000e3bce967196'], // CoinGecko aave (mcap rank #45) · DexScreener largest pool $431,224 · price diff 0.2%
      ['optimism', '0x76fb31fb4af56892a25e32cfc43de717950c9278'], // CoinGecko aave (mcap rank #45) · DexScreener largest pool $153,792 · price diff 1.1%
      ['avalanche', '0x63a72806098bd3d9520cc43356dd78afe5d386d9'], // CoinGecko aave (mcap rank #45) · DexScreener largest pool $448,469 · price diff 0.1%
    ],
  },
  {
    symbol: 'ONDO',
    aliases: ['ondo'],
    tokens: [
      ['ethereum', '0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3'], // CoinGecko ondo-finance (mcap rank #46) · DexScreener largest pool $4,805,052 · price diff 0.4%
    ],
  },
  {
    symbol: 'MNT',
    aliases: ['mnt'],
    tokens: [
      ['ethereum', '0x3c3a81e81dc49a522a592e7622a7e711c06bf354'], // CoinGecko mantle (mcap rank #51) · DexScreener largest pool $3,856,867 · price diff 0.1%
    ],
  },
  {
    symbol: 'ASTER',
    aliases: ['aster'],
    tokens: [
      ['bsc', '0x000ae314e2a2172a039b26378814c252734f556a'], // CoinGecko aster-2 (mcap rank #53) · DexScreener largest pool $1,175,652 · price diff 0.1%
    ],
  },
  {
    symbol: 'ICP',
    aliases: ['icp'],
    tokens: [
      ['base', '0x00f3c42833c3170159af4e92dbb451fb3f708917'], // CoinGecko internet-computer (mcap rank #54) · DexScreener largest pool $723,681 · price diff 1.2%
      ['ethereum', '0x00f3c42833c3170159af4e92dbb451fb3f708917'], // CoinGecko internet-computer (mcap rank #54) · DexScreener largest pool $607,609 · price diff 1.2%
    ],
  },
  {
    symbol: 'SKY',
    aliases: ['sky'],
    tokens: [
      ['ethereum', '0x56072c95faa701256059aa122697b133aded9279'], // CoinGecko sky (mcap rank #55) · DexScreener largest pool $9,861,020 · price diff 0.3%
    ],
  },
  {
    symbol: 'WLD',
    aliases: ['wld'],
    tokens: [
      ['ethereum', '0x163f8c2467924be0ae7b5347228cabf260318753'], // CoinGecko worldcoin-wld (mcap rank #56) · DexScreener largest pool $212,201 · price diff 0.0%
      ['worldchain', '0x2cfc85d8e48f8eab294be644d9e25c3030863003'], // CoinGecko worldcoin-wld (mcap rank #56) · DexScreener largest pool $445,799 · price diff 0.6%
      ['optimism', '0xdc6ff44d5d932cbd77b52e5612ba0529dc6226f1'], // CoinGecko worldcoin-wld (mcap rank #56) · DexScreener largest pool $62,507 · price diff 0.0%
    ],
  },
  {
    symbol: 'PAXG',
    aliases: ['paxg'],
    tokens: [
      ['ethereum', '0x45804880de22913dafe09f4980848ece6ecbaf78'], // CoinGecko pax-gold (mcap rank #57) · DexScreener largest pool $16,114,128 · price diff 0.2%
    ],
  },
  {
    symbol: 'WLFI',
    aliases: ['wlfi'],
    tokens: [
      ['ethereum', '0xda5e1988097297dcdc1f90d4dfe7909e847cbef6'], // CoinGecko world-liberty-financial (mcap rank #58) · DexScreener largest pool $4,167,939 · price diff 0.9%
      ['bsc', '0x47474747477b199288bf72a1d702f7fe0fb1deea'], // CoinGecko world-liberty-financial (mcap rank #58) · DexScreener largest pool $2,857,927 · price diff 0.5%
    ],
  },
  {
    symbol: 'PEPE',
    aliases: ['pepe'],
    tokens: [
      ['ethereum', '0x6982508145454ce325ddbe47a25d4ec3d2311933'], // CoinGecko pepe (mcap rank #59) · DexScreener largest pool $31,430,700 · price diff 0.0%
      ['bsc', '0x25d887ce7a35172c62febfd67a1856f20faebb00'], // CoinGecko pepe (mcap rank #59) · DexScreener largest pool $303,609 · price diff 0.6%
    ],
  },
  {
    symbol: 'MORPHO',
    aliases: ['morpho'],
    tokens: [
      ['ethereum', '0x58d97b57bb95320f9a05dc918aef65434969c2b2'], // CoinGecko morpho (mcap rank #60) · DexScreener largest pool $123,141 · price diff 0.4%
      ['base', '0xbaa5cc21fd487b8fcc2f632f3f4e8d37262a0842'], // CoinGecko morpho (mcap rank #60) · DexScreener largest pool $1,683,266 · price diff 0.4%
    ],
  },
  {
    symbol: 'HTX',
    aliases: ['htx'],
    tokens: [
      ['bsc', '0x61ec85ab89377db65762e234c946b5c25a56e99e'], // CoinGecko htx-dao (mcap rank #61) · DexScreener largest pool $3,532,898 · price diff 1.3%
    ],
  },
  {
    symbol: 'ARB',
    aliases: ['arb'],
    tokens: [
      ['arbitrum', '0x912ce59144191c1204e64559fe8253a0e49e6548'], // CoinGecko arbitrum (mcap rank #66) · DexScreener largest pool $1,898,590 · price diff 0.2%
    ],
  },
  {
    symbol: 'BGB',
    aliases: ['bgb'],
    tokens: [
      ['ethereum', '0x54d2252757e1672eead234d27b1270728ff90581'], // CoinGecko bitget-token (mcap rank #67) · DexScreener largest pool $485,682 · price diff 1.0%
    ],
  },
  {
    symbol: 'VVV',
    aliases: ['vvv'],
    tokens: [
      ['base', '0xacfe6019ed1a7dc6f7b508c02d1b04ec88cc21bf'], // CoinGecko venice-token (mcap rank #70) · DexScreener largest pool $17,820,645 · price diff 0.1%
    ],
  },
  {
    symbol: 'JUP',
    aliases: ['jup'],
    tokens: [
      ['solana', 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'], // CoinGecko jupiter-exchange-solana (mcap rank #76) · DexScreener largest pool $2,117,198 · price diff 0.0%
    ],
  },
  {
    symbol: 'RENDER',
    aliases: ['render'],
    tokens: [
      ['ethereum', '0x6de037ef9ad2725eb40118bb1702ebb27e4aeb24'], // CoinGecko render-token (mcap rank #80) · DexScreener largest pool $411,112 · price diff 0.5%
      ['solana', 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof'], // CoinGecko render-token (mcap rank #80) · DexScreener largest pool $370,696 · price diff 0.5%
    ],
  },
  {
    symbol: 'LIT',
    aliases: ['lit'],
    tokens: [
      ['ethereum', '0x232ce3bd40fcd6f80f3d55a522d03f25df784ee2'], // CoinGecko lighter (mcap rank #82) · DexScreener largest pool $379,731 · price diff 0.8%
      ['robinhood', '0xeeca2e7dc194a320d349122d88259bb9595a4cb0'], // CoinGecko lighter (mcap rank #82) · DexScreener largest pool $547,419 · price diff 1.6%
    ],
  },
  {
    symbol: 'NEXO',
    aliases: ['nexo'],
    tokens: [
      ['ethereum', '0xb62132e35a6c13ee1ee0f84dc5d40bad8d815206'], // CoinGecko nexo (mcap rank #86) · DexScreener largest pool $1,382,215 · price diff 0.1%
    ],
  },
  {
    symbol: 'AERO',
    aliases: ['aero'],
    tokens: [
      ['base', '0x940181a94a35a4569e4529a3cdfb74e38fd98631'], // CoinGecko aerodrome-finance (mcap rank #87) · DexScreener largest pool $41,785,087 · price diff 0.3%
    ],
  },
  {
    symbol: 'INJ',
    aliases: ['inj'],
    tokens: [
      ['ethereum', '0xe28b3b32b6c345a34ff64674606124dd5aceca30'], // CoinGecko injective-protocol (mcap rank #90) · DexScreener largest pool $477,591 · price diff 0.1%
      ['bsc', '0xa2b726b1145a4773f68593cf171187d8ebe4d495'], // CoinGecko injective-protocol (mcap rank #90) · DexScreener largest pool $223,229 · price diff 0.4%
      ['solana', '1NJMqVM4PadjuzYmeB7zV7q7DV8oB3ExaQCd9x6KsLz'], // CoinGecko injective-protocol (mcap rank #90) · DexScreener largest pool $195,326 · price diff 0.3%
    ],
  },
  {
    symbol: 'STABLE',
    aliases: ['stable'],
    tokens: [
      ['bsc', '0x011ebe7d75e2c9d1e0bd0be0bef5c36f0a90075f'], // CoinGecko stable-2 (mcap rank #91) · DexScreener largest pool $901,575 · price diff 0.2%
    ],
  },
  {
    symbol: 'ETHFI',
    aliases: ['ethfi'],
    tokens: [
      ['ethereum', '0xfe0c30065b384f05761f15d0cc899d4f9f9cc0eb'], // CoinGecko ether-fi (mcap rank #93) · DexScreener largest pool $1,224,793 · price diff 1.0%
      ['base', '0x6c240dda6b5c336df09a4d011139beaaa1ea2aa2'], // CoinGecko ether-fi (mcap rank #93) · DexScreener largest pool $180,192 · price diff 0.2%
      ['arbitrum', '0x7189fb5b6504bbff6a852b13b7b82a3c118fdc27'], // CoinGecko ether-fi (mcap rank #93) · DexScreener largest pool $147,917 · price diff 0.3%
    ],
  },
  {
    symbol: 'AKE',
    aliases: ['ake'],
    tokens: [
      ['bsc', '0x2c3a8ee94ddd97244a93bc48298f97d2c412f7db'], // CoinGecko akedo (mcap rank #95) · DexScreener largest pool $2,698,855 · price diff 0.3%
    ],
  },
  {
    symbol: 'PENGU',
    aliases: ['pengu'],
    tokens: [
      ['solana', '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv'], // CoinGecko pudgy-penguins (mcap rank #100) · DexScreener largest pool $4,460,736 · price diff 1.0%
      ['abstract', '0x9ebe3a824ca958e4b3da772d2065518f009cba62'], // CoinGecko pudgy-penguins (mcap rank #100) · DexScreener largest pool $447,891 · price diff 0.9%
      ['robinhood', '0x74be72affafbc8de30f0c11247814036314d625f'], // CoinGecko pudgy-penguins (mcap rank #100) · DexScreener largest pool $206,238 · price diff 0.7%
      ['bsc', '0x6418c0dd099a9fda397c766304cdd918233e8847'], // CoinGecko pudgy-penguins (mcap rank #100) · DexScreener largest pool $113,263 · price diff 0.7%
    ],
  },
  {
    symbol: 'PYTH',
    aliases: ['pyth'],
    tokens: [
      ['solana', 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3'], // CoinGecko pyth-network (mcap rank #101) · DexScreener largest pool $429,532 · price diff 0.1%
    ],
  },
  {
    symbol: 'ZRO',
    aliases: ['zro'],
    tokens: [
      ['ethereum', '0x6985884c4392d348587b19cb9eaaf157f13271cd'], // CoinGecko layerzero (mcap rank #102) · DexScreener largest pool $62,766 · price diff 0.0%
      ['base', '0x6985884c4392d348587b19cb9eaaf157f13271cd'], // CoinGecko layerzero (mcap rank #102) · DexScreener largest pool $178,886 · price diff 0.0%
      ['arbitrum', '0x6985884c4392d348587b19cb9eaaf157f13271cd'], // CoinGecko layerzero (mcap rank #102) · DexScreener largest pool $104,388 · price diff 0.0%
      ['optimism', '0x6985884c4392d348587b19cb9eaaf157f13271cd'], // CoinGecko layerzero (mcap rank #102) · DexScreener largest pool $67,905 · price diff 0.0%
    ],
  },
  {
    symbol: 'CRV',
    aliases: ['crv'],
    tokens: [
      ['base', '0x8ee73c484a26e0a5df2ee2a4960b789967dd0415'], // CoinGecko curve-dao-token (mcap rank #103) · DexScreener largest pool $161,116 · price diff 0.3%
      ['polygon', '0x172370d5cd63279efa6d502dab29171933a610af'], // CoinGecko curve-dao-token (mcap rank #103) · DexScreener largest pool $54,671 · price diff 0.0%
      ['arbitrum', '0x11cdb42b0eb46d95f990bedd4695a6e3fa034978'], // CoinGecko curve-dao-token (mcap rank #103) · DexScreener largest pool $568,521 · price diff 0.1%
    ],
  },
  {
    symbol: 'TRUMP',
    aliases: ['trump'],
    tokens: [
      ['solana', '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN'], // CoinGecko official-trump (mcap rank #106) · DexScreener largest pool $12,828,137 · price diff 0.1%
    ],
  },
  {
    symbol: 'GRASS',
    aliases: ['grass'],
    tokens: [
      ['solana', 'Grass7B4RdKfBCjTKgSqnXkqjwiGvQyFbuSCUJr3XXjs'], // CoinGecko grass (mcap rank #110) · DexScreener largest pool $569,836 · price diff 0.3%
    ],
  },
  {
    symbol: 'VIRTUAL',
    aliases: ['virtual'],
    tokens: [
      ['ethereum', '0x44ff8620b8ca30902395a7bd3f2407e1a091bf73'], // CoinGecko virtual-protocol (mcap rank #111) · DexScreener largest pool $293,188 · price diff 0.5%
      ['base', '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b'], // CoinGecko virtual-protocol (mcap rank #111) · DexScreener largest pool $4,522,441 · price diff 0.2%
      ['solana', '3iQL8BFS2vE7mww4ehAqQHAsbmRNCrPxizWAT2Zfyr9y'], // CoinGecko virtual-protocol (mcap rank #111) · DexScreener largest pool $1,304,128 · price diff 0.7%
      ['robinhood', '0xc6911796042b15d7fa4f6cde69e245ddcd3d9c31'], // CoinGecko virtual-protocol (mcap rank #111) · DexScreener largest pool $2,486,416 · price diff 0.4%
      ['arc', '0x8c4252c87081c88c6ad57d6dd97e1cafebf842b7'], // CoinGecko virtual-protocol (mcap rank #111) · DexScreener largest pool $457,837 · price diff 0.4%
    ],
  },
  {
    symbol: 'FET',
    aliases: ['fet'],
    tokens: [
      ['ethereum', '0xaea46a60368a7bd060eec7df8cba43b7ef41ad85'], // CoinGecko fetch-ai (mcap rank #112) · DexScreener largest pool $1,677,520 · price diff 0.6%
      ['bsc', '0x031b41e504677879370e9dbcf937283a8691fa7f'], // CoinGecko fetch-ai (mcap rank #112) · DexScreener largest pool $100,784 · price diff 0.3%
    ],
  },
  {
    symbol: 'RAY',
    aliases: ['ray'],
    tokens: [
      ['solana', '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R'], // CoinGecko raydium (mcap rank #113) · DexScreener largest pool $6,604,510 · price diff 0.5%
    ],
  },
  {
    symbol: '币安人生',
    aliases: ['币安人生'],
    tokens: [
      ['bsc', '0x924fa68a0fc644485b8df8abfa0a41c2e7744444'], // CoinGecko bianrensheng (mcap rank #114) · DexScreener largest pool $8,179,759 · price diff 0.0%
    ],
  },
  {
    symbol: 'FF',
    aliases: ['ff'],
    tokens: [
      ['bsc', '0xac23b90a79504865d52b49b327328411a23d4db2'], // CoinGecko falcon-finance-ff (mcap rank #125) · DexScreener largest pool $4,271,608 · price diff 0.8%
    ],
  },
  {
    symbol: 'PENDLE',
    aliases: ['pendle'],
    tokens: [
      ['ethereum', '0x808507121b80c02388fad14726482e061b8da827'], // CoinGecko pendle (mcap rank #126) · DexScreener largest pool $464,034 · price diff 1.3%
      ['base', '0xa99f6e6785da0f5d6fb42495fe424bce029eeb3e'], // CoinGecko pendle (mcap rank #126) · DexScreener largest pool $217,993 · price diff 0.9%
      ['bsc', '0xb3ed0a426155b79b898849803e3b36552f7ed507'], // CoinGecko pendle (mcap rank #126) · DexScreener largest pool $779,461 · price diff 0.0%
      ['arbitrum', '0x0c880f6761f1af8d9aa9c466984b80dab9a8c9e8'], // CoinGecko pendle (mcap rank #126) · DexScreener largest pool $2,397,195 · price diff 0.0%
      ['robinhood', '0x5e49e1f85813f2b65858860a3fa231b4186f2e0e'], // CoinGecko pendle (mcap rank #126) · DexScreener largest pool $113,537 · price diff 1.3%
    ],
  },
  {
    symbol: 'LDO',
    aliases: ['ldo'],
    tokens: [
      ['ethereum', '0x5a98fcbea516cf06857215779fd812ca3bef1b32'], // CoinGecko lido-dao (mcap rank #129) · DexScreener largest pool $580,408 · price diff 0.1%
      ['polygon', '0xc3c7d422809852031b44ab29eec9f1eff2a58756'], // CoinGecko lido-dao (mcap rank #129) · DexScreener largest pool $102,696 · price diff 0.3%
      ['arbitrum', '0x13ad51ed4f1b7e9dc168d8a00cb3f4ddd85efa60'], // CoinGecko lido-dao (mcap rank #129) · DexScreener largest pool $72,960 · price diff 0.5%
    ],
  },
  {
    symbol: 'DRV',
    aliases: ['drv'],
    tokens: [
      ['ethereum', '0xb1d1eae60eea9525032a6dcb4c1ce336a1de71be'], // CoinGecko derive (mcap rank #131) · DexScreener largest pool $136,740 · price diff 1.6%
      ['base', '0x9d0e8f5b25384c7310cb8c6ae32c8fbeb645d083'], // CoinGecko derive (mcap rank #131) · DexScreener largest pool $4,843,080 · price diff 0.0%
      ['hyperevm', '0x9628bba16db41ea7fe1fd84f9ce53bc27c63f59b'], // CoinGecko derive (mcap rank #131) · DexScreener largest pool $194,509 · price diff 0.1%
    ],
  },
  {
    symbol: 'UB',
    aliases: ['ub'],
    tokens: [
      ['bsc', '0x40b8129b786d766267a7a118cf8c07e31cdb6fde'], // CoinGecko unibase (mcap rank #132) · DexScreener largest pool $4,097,283 · price diff 0.1%
    ],
  },
  {
    symbol: 'PONS',
    aliases: ['pons'],
    tokens: [
      ['robinhood', '0x39dbed3a2bd333467115de45665cc57f813c4571'], // CoinGecko pons (mcap rank #133) · DexScreener largest pool $6,223,021 · price diff 0.4%
    ],
  },
  {
    symbol: 'BTT',
    aliases: ['btt'],
    tokens: [
      ['bsc', '0x352cb5e19b12fc216548a2677bd0fce83bae434b'], // CoinGecko bittorrent (mcap rank #134) · DexScreener largest pool $95,615 · price diff 0.9%
    ],
  },
  {
    symbol: '2Z',
    aliases: ['2z'],
    tokens: [
      ['solana', 'J6pQQ3FAcJQeWPPGppWRb4nM8jU3wLyYbRrLh7feMfvd'], // CoinGecko doublezero (mcap rank #136) · DexScreener largest pool $1,008,460 · price diff 0.1%
    ],
  },
  {
    symbol: 'BONK',
    aliases: ['bonk'],
    tokens: [
      ['solana', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'], // CoinGecko bonk (mcap rank #138) · DexScreener largest pool $427,783 · price diff 0.1%
      ['bsc', '0xa697e272a73744b343528c3bc4702f2565b2f422'], // CoinGecko bonk (mcap rank #138) · DexScreener largest pool $91,424 · price diff 0.3%
    ],
  },
  {
    symbol: 'KITE',
    aliases: ['kite'],
    tokens: [
      ['ethereum', '0x118b70df4f06fa5678e7d543e6066e028c8ea0c0'], // CoinGecko kite-2 (mcap rank #142) · DexScreener largest pool $806,636 · price diff 0.1%
    ],
  },
  {
    symbol: 'GRT',
    aliases: ['grt'],
    tokens: [
      ['ethereum', '0xc944e90c64b2c07662a292be6244bdf05cda44a7'], // CoinGecko the-graph (mcap rank #147) · DexScreener largest pool $178,592 · price diff 0.0%
      ['arbitrum', '0x9623063377ad1b27544c965ccd7342f7ea7e88c7'], // CoinGecko the-graph (mcap rank #147) · DexScreener largest pool $82,858 · price diff 0.1%
    ],
  },
  {
    symbol: 'GNO',
    aliases: ['gno'],
    tokens: [
      ['ethereum', '0x6810e776880c02933d47db1b9fc05908e5386b96'], // CoinGecko gnosis (mcap rank #149) · DexScreener largest pool $99,757 · price diff 0.4%
    ],
  },
  {
    symbol: 'STRK',
    aliases: ['strk'],
    tokens: [
      ['ethereum', '0xca14007eff0db1f8135f4c25b34de49ab0d42766'], // CoinGecko starknet (mcap rank #150) · DexScreener largest pool $94,506 · price diff 0.5%
      ['solana', 'HsRpHQn6VbyMs5b5j5SV6xQ2VvpvvCCzu19GjytVSCoz'], // CoinGecko starknet (mcap rank #150) · DexScreener largest pool $187,225 · price diff 0.6%
    ],
  },
  {
    symbol: 'BP',
    aliases: ['bp'],
    tokens: [
      ['solana', 'BPxxfRCXkUVhig4HS1Lh7kZqV6SPJhzfEk4x6fVBjPCy'], // CoinGecko backpack (mcap rank #151) · DexScreener largest pool $5,762,138 · price diff 0.0%
    ],
  },
  {
    symbol: 'OP',
    aliases: ['op'],
    tokens: [
      ['optimism', '0x4200000000000000000000000000000000000042'], // CoinGecko optimism (mcap rank #152) · DexScreener largest pool $373,060 · price diff 0.1%
    ],
  },
  {
    symbol: 'ENS',
    aliases: ['ens'],
    tokens: [
      ['ethereum', '0xc18360217d8f7ab5e7c516566761ea12ce7f9d72'], // CoinGecko ethereum-name-service (mcap rank #153) · DexScreener largest pool $746,327 · price diff 0.4%
    ],
  },
  {
    symbol: 'JTO',
    aliases: ['jto'],
    tokens: [
      ['solana', 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL'], // CoinGecko jito-governance-token (mcap rank #154) · DexScreener largest pool $1,406,401 · price diff 0.4%
    ],
  },
  {
    symbol: 'OHM',
    aliases: ['ohm'],
    tokens: [
      ['ethereum', '0x64aa3364f17a4d01c6f1751fd97c2bd3d7e7f1d5'], // CoinGecko olympus (mcap rank #155) · DexScreener largest pool $11,577,935 · price diff 0.7%
      ['berachain', '0x18878df23e2a36f81e820e4b47b4a40576d3159c'], // CoinGecko olympus (mcap rank #155) · DexScreener largest pool $339,975 · price diff 3.2%
      ['arbitrum', '0xf0cb2dc0db5e6c66b9a70ac27b06b878da017028'], // CoinGecko olympus (mcap rank #155) · DexScreener largest pool $282,121 · price diff 3.1%
    ],
  },
  {
    symbol: 'TIBBIR',
    aliases: ['tibbir'],
    tokens: [
      ['base', '0xa4a2e2ca3fbfe21aed83471d28b6f65a233c6e00'], // CoinGecko ribbita-by-virtuals (mcap rank #156) · DexScreener largest pool $4,022,022 · price diff 0.2%
    ],
  },
  {
    symbol: 'SYRUP',
    aliases: ['syrup'],
    tokens: [
      ['ethereum', '0x643c4e15d7d62ad0abec4a9bd4b001aa3ef52d66'], // CoinGecko syrup (mcap rank #162) · DexScreener largest pool $2,014,782 · price diff 0.3%
      ['base', '0x688aee022aa544f150678b8e5720b6b96a9e9a2f'], // CoinGecko syrup (mcap rank #162) · DexScreener largest pool $54,815 · price diff 0.6%
    ],
  },
  {
    symbol: 'FLOKI',
    aliases: ['floki'],
    tokens: [
      ['ethereum', '0xcf0c122c6b73ff809c693db761e7baebe62b6a2e'], // CoinGecko floki (mcap rank #163) · DexScreener largest pool $8,160,418 · price diff 0.4%
      ['bsc', '0xfb5b838b6cfeedc2873ab27866079ac55363d37e'], // CoinGecko floki (mcap rank #163) · DexScreener largest pool $9,778,379 · price diff 0.4%
    ],
  },
  {
    symbol: 'COMP',
    aliases: ['comp'],
    tokens: [
      ['ethereum', '0xc00e94cb662c3520282e6f5717214004a7f26888'], // CoinGecko compound-governance-token (mcap rank #164) · DexScreener largest pool $1,643,989 · price diff 0.1%
    ],
  },
  {
    symbol: 'ZBCN',
    aliases: ['zbcn'],
    tokens: [
      ['solana', 'ZBCNpuD7YMXzTHB2fhGkGi78MNsHGLRXUhRewNRm9RU'], // CoinGecko zebec-network (mcap rank #166) · DexScreener largest pool $191,806 · price diff 0.8%
    ],
  },
  {
    symbol: 'SHFL',
    aliases: ['shfl'],
    tokens: [
      ['ethereum', '0x8881562783028f5c1bcb985d2283d5e170d88888'], // CoinGecko shuffle-2 (mcap rank #167) · DexScreener largest pool $9,974,529 · price diff 0.2%
    ],
  },
  {
    symbol: 'STONK',
    aliases: ['stonk'],
    tokens: [
      ['solana', '6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx'], // CoinGecko stonk-3 (mcap rank #168) · DexScreener largest pool $3,239,254 · price diff 0.2%
    ],
  },
  {
    symbol: 'TWT',
    aliases: ['twt'],
    tokens: [
      ['bsc', '0x4b0f1812e5df2a09796481ff14017e6005508003'], // CoinGecko trust-wallet-token (mcap rank #169) · DexScreener largest pool $615,270 · price diff 0.0%
    ],
  },
  {
    symbol: 'WIF',
    aliases: ['wif'],
    tokens: [
      ['solana', 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'], // CoinGecko dogwifcoin (mcap rank #171) · DexScreener largest pool $6,787,548 · price diff 0.1%
    ],
  },
  {
    symbol: 'KMNO',
    aliases: ['kmno'],
    tokens: [
      ['solana', 'KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS'], // CoinGecko kamino (mcap rank #172) · DexScreener largest pool $2,080,581 · price diff 0.3%
    ],
  },
  {
    symbol: 'EIGEN',
    aliases: ['eigen'],
    tokens: [
      ['ethereum', '0xec53bf9167f50cdeb3ae105f56099aaab9061f83'], // CoinGecko eigenlayer (mcap rank #173) · DexScreener largest pool $4,065,629 · price diff 0.1%
    ],
  },
  {
    symbol: 'USELESS',
    aliases: ['useless'],
    tokens: [
      ['solana', 'Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk'], // CoinGecko useless-3 (mcap rank #176) · DexScreener largest pool $5,345,795 · price diff 0.4%
      ['bsc', '0xba38b3c706f7a515ff7c8db04daa0a134ec46d2b'], // CoinGecko useless-3 (mcap rank #176) · DexScreener largest pool $882,091 · price diff 0.2%
    ],
  },
  {
    symbol: 'BR',
    aliases: ['br'],
    tokens: [
      ['bsc', '0xff7d6a96ae471bbcd7713af9cb1feeb16cf56b41'], // CoinGecko bedrock-token (mcap rank #178) · DexScreener largest pool $4,088,402 · price diff 0.1%
    ],
  },
  {
    symbol: 'KOGE',
    aliases: ['koge'],
    tokens: [
      ['bsc', '0xe6df05ce8c8301223373cf5b969afcb1498c5528'], // CoinGecko bnb48-club-token (mcap rank #180) · DexScreener largest pool $1,121,983 · price diff 0.3%
    ],
  },
  {
    symbol: 'CVX',
    aliases: ['cvx'],
    tokens: [
      ['ethereum', '0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b'], // CoinGecko convex-finance (mcap rank #188) · DexScreener largest pool $6,679,848 · price diff 0.5%
    ],
  },
  {
    symbol: 'AXS',
    aliases: ['axs'],
    tokens: [
      ['ethereum', '0xbb0e17ef65f82ab018d8edd776e8dd940327b28b'], // CoinGecko axie-infinity (mcap rank #190) · DexScreener largest pool $106,767 · price diff 0.0%
    ],
  },
  {
    symbol: 'MET',
    aliases: ['met'],
    tokens: [
      ['solana', 'METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL'], // CoinGecko meteora (mcap rank #193) · DexScreener largest pool $3,090,995 · price diff 0.3%
    ],
  },
  {
    symbol: 'ZAMA',
    aliases: ['zama'],
    tokens: [
      ['ethereum', '0xa12cc123ba206d4031d1c7f6223d1c2ec249f4f3'], // CoinGecko zama (mcap rank #194) · DexScreener largest pool $618,713 · price diff 0.1%
      ['solana', '4Zp52aF4hZi9fzH19xpbWKYKQvgLyCN67KFbrQDqeTKh'], // CoinGecko zama (mcap rank #194) · DexScreener largest pool $123,118 · price diff 0.7%
    ],
  },
  {
    symbol: 'XCN',
    aliases: ['xcn'],
    tokens: [
      ['ethereum', '0xa2cd3d43c775978a96bdbf12d733d5a1ed94fb18'], // CoinGecko chain-2 (mcap rank #195) · DexScreener largest pool $876,086 · price diff 0.2%
      ['base', '0x9c632e6aaa3ea73f91554f8a3cb2ed2f29605e0c'], // CoinGecko chain-2 (mcap rank #195) · DexScreener largest pool $186,914 · price diff 1.7%
    ],
  },
  {
    symbol: 'FARTCOIN',
    aliases: ['fartcoin'],
    tokens: [
      ['solana', '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump'], // CoinGecko fartcoin (mcap rank #199) · DexScreener largest pool $8,927,552 · price diff 0.6%
    ],
  },
  {
    symbol: 'AI',
    aliases: ['ai'],
    tokens: [
      ['robinhood', '0x2e8c31162b855a2ffa90f6f8634643ad6f111e18'], // CoinGecko artificial-inu-3 (mcap rank #200) · DexScreener largest pool $4,956,898 · price diff 0.1%
    ],
  },
]
