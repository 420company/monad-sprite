import { getAddress } from 'viem'
// 多链注册表：支持的链、原生币、常用代币（USDC / USDT）
// LI.FI 用 chainId 数字标识链，Solana 的 id 是 1151111081099710
import {
  mainnet, base, arbitrum, bsc, polygon, optimism,
  robinhood, hyperEvm, arc, monad, monadTestnet, megaeth, sei, plasma, katana, flowMainnet, avalanche, linea, zksync, scroll, blast, mantle, sonic, berachain, unichain, abstract, gnosis, celo, fantom, ink, soneium, worldchain, mode, zora, cronos, opBNB, apeChain,
  type Chain as ViemChain,
} from 'viem/chains'

export const SOLANA_CHAIN_ID = 1151111081099710
/** LI.FI 中表示原生币的地址 */
export const NATIVE_EVM = '0x0000000000000000000000000000000000000000'
export const NATIVE_SOL = '11111111111111111111111111111111'

export interface ChainToken {
  chainId: number
  address: string
  symbol: string
  name: string
  decimals: number
  logo?: string
  priceUsd?: number
}

export interface ChainInfo {
  id: number
  key: string
  /** DexScreener 使用的链标识 */
  dexKey: string
  name: string
  type: 'evm' | 'svm' | 'utxo'
  logo: string
  native: ChainToken
  /** 常用代币（用于余额扫描与快捷选择） */
  tokens: ChainToken[]
  viem?: ViemChain
  /** GeckoTerminal 网络 id（发现页榜单、K 线用）；没有就是 GeckoTerminal 不收这条链 */
  gecko?: string
  explorerTx: (hash: string) => string
}

const lifiLogo = (key: string) => `https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/${key}.svg`
// LI.FI 那个 icons 仓库的 tokens/ 目录已经 404，DexScreener 的 CDN 只有付费档案的币才有图（实测 USDC 都 404）。
// 所以代币图给一串候选（TokenLogo 逐个试）：TrustWallet（要校验和地址）→ DexScreener。原生币走 TrustWallet。
const TW = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains'
const TW_DIR: Record<string, string> = { ethereum: 'ethereum', base: 'base', arbitrum: 'arbitrum', bsc: 'smartchain', polygon: 'polygon', optimism: 'optimism', avalanche: 'avalanchec', linea: 'linea', zksync: 'zksync', scroll: 'scroll', blast: 'blast', mantle: 'mantle', sonic: 'sonic', gnosischain: 'xdai', celo: 'celo', fantom: 'fantom', cronos: 'cronos', solana: 'solana' }
const checksum = (a: string) => { try { return getAddress(a) } catch { return a } }
/** 代币图候选串（| 分隔），交给 TokenLogo 逐个尝试 */
export function tokenLogo(dexKey: string, addr: string, primary?: string | null): string {
  const tw = TW_DIR[dexKey]
  const list = [primary || '', tw ? `${TW}/${tw}/assets/${addr.startsWith('0x') ? checksum(addr) : addr}/logo.png` : '', `https://dd.dexscreener.com/ds-data/tokens/${dexKey}/${addr.startsWith('0x') ? addr.toLowerCase() : addr}.png`]
  return list.filter(Boolean).join('|')
}
const NATIVE_LOGO: Record<string, string> = { eth: `${TW}/ethereum/info/logo.png`, bnb: `${TW}/smartchain/info/logo.png`, pol: `${TW}/polygon/info/logo.png`, sol: `${TW}/solana/info/logo.png`, avax: `${TW}/avalanchec/info/logo.png`, ftm: `${TW}/fantom/info/logo.png`, celo: `${TW}/celo/info/logo.png`, xdai: `${TW}/xdai/info/logo.png`, cro: `${TW}/cronos/info/logo.png`, mnt: `${TW}/mantle/info/logo.png`, s: `${TW}/sonic/info/logo.png`, bera: 'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/tokens/bera.svg' } // TrustWallet 没有 berachain 目录（404）
const nativeLogo = (key: string) => NATIVE_LOGO[key] || `${TW}/${key}/info/logo.png`

/**
 * DexScreener 链标识 → GeckoTerminal 网络 id。2026-09-25 用 scripts/check-market-chains.mjs 对过两边的实时列表，
 * 每条都用 GeckoTerminal 热门池里的真实交易对去 DexScreener 反查过，别凭名字猜（XLayer 在 DexScreener 叫 xlayer，Sei 叫 seiv2）。
 */
export const GECKO_NETWORK: Record<string, string> = {
  solana: 'solana', ethereum: 'eth', base: 'base', arbitrum: 'arbitrum', bsc: 'bsc', polygon: 'polygon_pos', optimism: 'optimism',
  avalanche: 'avax', linea: 'linea', zksync: 'zksync', scroll: 'scroll', blast: 'blast', mantle: 'mantle', sonic: 'sonic',
  berachain: 'berachain', unichain: 'unichain', abstract: 'abstract', gnosischain: 'xdai', celo: 'celo', fantom: 'ftm', ink: 'ink', mode: 'mode', cronos: 'cro',
  robinhood: 'robinhood', soneium: 'soneium', worldchain: 'world-chain', opbnb: 'opbnb', apechain: 'apechain',
  hyperevm: 'hyperevm', arc: 'arc', monad: 'monad', megaeth: 'megaeth', seiv2: 'sei-evm', plasma: 'plasma', katana: 'katana', flowevm: 'flow-evm',
}

/**
 * 额外选项（2026-09-25 发现页扩链时加）：
 *  - logo / nativeLogo：LI.FI 的图标文件名跟我们的 key 不一样、或 TrustWallet 没有这条链的原生币图时直接给完整地址（都用 curl 验过能打开）
 *  - native：原生币在 LI.FI 里是 ERC-20 地址的链。Arc 的 gas 就是 USDC，LI.FI 把它记成 0x3600…0000、6 位精度，
 *    拿 0x0 去报价会被当成 6 位精度算出 99.99% 价差。这类链的原生币直接用 LI.FI 的地址和精度，
 *    余额扫描读到的原生余额（18 位）按数值换算后与 ERC-20 余额是同一笔钱。
 */
interface EvmExtra { logo?: string; nativeLogo?: string; native?: { address: string; decimals: number } }

function evmChain(viem: ViemChain, key: string, nativeSymbol: string, nativeName: string, nativeLogoKey: string, tokens: [string, string, string, number][], dexKey = key, extra: EvmExtra = {}): ChainInfo {
  const id = viem.id
  return {
    id,
    key,
    dexKey,
    name: viem.name,
    type: 'evm',
    logo: extra.logo || lifiLogo(key),
    gecko: GECKO_NETWORK[dexKey],
    native: { chainId: id, address: extra.native?.address || NATIVE_EVM, symbol: nativeSymbol, name: nativeName, decimals: extra.native?.decimals ?? 18, logo: extra.nativeLogo || nativeLogo(nativeLogoKey) },
    tokens: tokens.map(([address, symbol, name, decimals]) => ({ chainId: id, address, symbol, name, decimals, logo: tokenLogo(dexKey, address) })),
    viem,
    explorerTx: (h) => `${viem.blockExplorers?.default.url}/tx/${h}`,
  }
}

export const CHAINS: ChainInfo[] = [
  {
    id: SOLANA_CHAIN_ID,
    key: 'sol',
    dexKey: 'solana',
    name: 'Solana',
    type: 'svm',
    logo: lifiLogo('solana'),
    gecko: 'solana',
    native: { chainId: SOLANA_CHAIN_ID, address: NATIVE_SOL, symbol: 'SOL', name: 'Solana', decimals: 9, logo: nativeLogo('sol') },
    tokens: [
      { chainId: SOLANA_CHAIN_ID, address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6, logo: tokenLogo('solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') },
      { chainId: SOLANA_CHAIN_ID, address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', name: 'Tether USD', decimals: 6, logo: tokenLogo('solana', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB') },
    ],
    explorerTx: (h) => `https://solscan.io/tx/${h}`,
  },
  evmChain(mainnet, 'ethereum', 'ETH', 'Ether', 'eth', [
    ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'USDC', 'USD Coin', 6],
    ['0xdAC17F958D2ee523a2206206994597C13D831ec7', 'USDT', 'Tether USD', 6],
  ]),
  evmChain(base, 'base', 'ETH', 'Ether', 'eth', [
    ['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'USDC', 'USD Coin', 6],
    ['0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', 'USDT', 'Tether USD', 6],
  ]),
  evmChain(arbitrum, 'arbitrum', 'ETH', 'Ether', 'eth', [
    ['0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 'USDC', 'USD Coin', 6],
    ['0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 'USDT', 'Tether USD', 6],
  ]),
  evmChain(bsc, 'bsc', 'BNB', 'BNB', 'bnb', [
    ['0x6652b21538fcdee00be8fd534673428760dc5505', 'BNG', 'BNG', 18], // 平台代币，精度启动时会按链上实际值修正
    ['0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 'USDC', 'USD Coin', 18],
    ['0x55d398326f99059fF775485246999027B3197955', 'USDT', 'Tether USD', 18],
  ]),
  evmChain(polygon, 'polygon', 'POL', 'Polygon', 'pol', [
    ['0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 'USDC', 'USD Coin', 6],
    ['0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 'USDT', 'Tether USD', 6],
  ]),
  evmChain(optimism, 'optimism', 'ETH', 'Ether', 'eth', [
    ['0x0b2C639c533813f4Aa9D7837CAF62653d097Ff85', 'USDC', 'USD Coin', 6],
    ['0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', 'USDT', 'Tether USD', 6],
  ]),
  // 以下链默认不扫描常用代币余额（只扫原生币与收藏的代币），但都可以通过 LI.FI 交易
  // Robinhood Chain（2026-07-01 主网，Arbitrum Orbit L2，gas 用 ETH）。LI.FI（chainId 4663）和 DexScreener（robinhood）都已支持。
  // USDG 用 Paxos 的 Global Dollar 0x5fc5…（链上发行量 6.89 亿）；另有一个自称「Paxos USDG」的 0x0A3B… 只有 1100 枚，是冒牌，别收
  evmChain(robinhood, 'robinhood', 'ETH', 'Ether', 'eth', [
    ['0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', 'USDG', 'Global Dollar', 6],
    ['0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34', 'USDe', 'USDe', 18],
  ]),
  // HyperEVM（Hyperliquid 的 EVM 链，gas 用 HYPE）。USDC 是 Circle 原生发行、USDT0 是 LayerZero 版 USDT，2026-09-25 链上读过 symbol / decimals
  evmChain(hyperEvm, 'hyperevm', 'HYPE', 'Hyperliquid', 'hype', [
    ['0xb88339CB7199b77E23DB6E890353E22632Ba630f', 'USDC', 'USD Coin', 6],
    ['0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', 'USDT0', 'USDT0', 6],
  ], 'hyperevm', { nativeLogo: 'https://static.debank.com/image/hyper_token/logo_url/hyper/0b3e288cfe418e9ce69eef4c96374583.png' }),
  // Arc（Circle 的链，gas 就是 USDC）。viem 的定义里没有 RPC 和 multicall3，这里补上：RPC 用 LI.FI 给的公共节点（eth_chainId 实测 5042），
  // multicall3 在标准地址上已部署（eth_getCode 实测非空）。原生币按 LI.FI 的记法（见 EvmExtra 注释），不另列 USDC，免得同一笔钱显示两遍
  evmChain({ ...arc, rpcUrls: { default: { http: ['https://rpc.drpc.mainnet.arc.io'] } }, contracts: { ...arc.contracts, multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } } }, 'arc', 'USDC', 'USD Coin', 'usdc', [], 'arc', {
    native: { address: '0x3600000000000000000000000000000000000000', decimals: 6 },
    nativeLogo: `${TW}/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png`,
  }),
  evmChain(monad, 'monad', 'MON', 'Monad', 'mon', [], 'monad', { nativeLogo: 'https://static.debank.com/image/monad_token/logo_url/monad/9df1611d238781f78045fba9101359a3.png' }),
  // Monad testnet (added 2026-10-07 for hackathon): key 'monad-testnet' avoids clash with mainnet 'monad';
  // dexKey shares 'monad' (DexScreener/GeckoTerminal id); excluded from MAIN_CHAIN_IDS (testnet skips balance scan).
  evmChain(monadTestnet, 'monad-testnet', 'MON', 'Testnet MON', 'mon', [], 'monad', {
    logo: 'https://static.debank.com/image/monad_token/logo_url/monad/9df1611d238781f78045fba9101359a3.png',
    nativeLogo: 'https://static.debank.com/image/monad_token/logo_url/monad/9df1611d238781f78045fba9101359a3.png',
  }),
  // 以下 5 条是 2026-09-25 发现页「更多」新增的：不扫常用代币（只扫原生币与收藏），但能通过 LI.FI 交易。DexScreener 的链标识跟 key 不同的已单独写
  evmChain(megaeth, 'megaeth', 'ETH', 'Ether', 'eth', []),
  evmChain(sei, 'sei', 'SEI', 'Sei', 'sei', [], 'seiv2', { nativeLogo: 'https://cdn.sei.io/sei-app/sei-icon.png' }),
  evmChain(plasma, 'plasma', 'XPL', 'Plasma', 'xpl', [], 'plasma', { nativeLogo: 'https://s2.coinmarketcap.com/static/img/coins/64x64/36645.png' }),
  evmChain(katana, 'katana', 'ETH', 'Ether', 'eth', []),
  evmChain(flowMainnet, 'flow', 'FLOW', 'Flow', 'flow', [], 'flowevm', { nativeLogo: 'https://raw.githubusercontent.com/onflow/assets/main/tokens/registry/0xd3bF53DAC106A0290B0483EcBC89d40FcC961f3e/logo.png' }),
  evmChain(avalanche, 'avalanche', 'AVAX', 'Avalanche', 'avax', [['0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', 'USDC', 'USD Coin', 6]]),
  evmChain(linea, 'linea', 'ETH', 'Ether', 'eth', [['0x176211869cA2b568f2A7D4EE941E073a821EE1ff', 'USDC', 'USD Coin', 6]]),
  evmChain(zksync, 'zksync', 'ETH', 'Ether', 'eth', []),
  evmChain(scroll, 'scroll', 'ETH', 'Ether', 'eth', []),
  evmChain(blast, 'blast', 'ETH', 'Ether', 'eth', []),
  evmChain(mantle, 'mantle', 'MNT', 'Mantle', 'mnt', []),
  evmChain(sonic, 'sonic', 'S', 'Sonic', 's', []),
  evmChain(berachain, 'berachain', 'BERA', 'Bera', 'bera', []),
  evmChain(unichain, 'unichain', 'ETH', 'Ether', 'eth', []),
  evmChain(abstract, 'abstract', 'ETH', 'Ether', 'eth', []),
  evmChain(gnosis, 'gnosis', 'xDAI', 'xDAI', 'xdai', [], 'gnosischain'),
  evmChain(celo, 'celo', 'CELO', 'Celo', 'celo', []),
  evmChain(fantom, 'fantom', 'FTM', 'Fantom', 'ftm', []),
  evmChain(ink, 'ink', 'ETH', 'Ether', 'eth', []),
  evmChain(soneium, 'soneium', 'ETH', 'Ether', 'eth', []),
  evmChain(worldchain, 'worldchain', 'ETH', 'Ether', 'eth', [], 'worldchain', { logo: lifiLogo('world') }), // LI.FI 的图标叫 world.svg，worldchain.svg 是 404
  evmChain(mode, 'mode', 'ETH', 'Ether', 'eth', []),
  evmChain(zora, 'zora', 'ETH', 'Ether', 'eth', []),
  evmChain(cronos, 'cronos', 'CRO', 'Cronos', 'cro', []),
  evmChain(opBNB, 'opbnb', 'BNB', 'BNB', 'bnb', []),
  evmChain(apeChain, 'apechain', 'APE', 'ApeCoin', 'ape', []),
]

/**
 * 发现页链筛选（2026-09-25 goat 定的顺序，BSC 打头）。值是 DexScreener 链标识。
 * 主筛选的链由服务器常驻轮询；「更多」里的链选中时才按需拉。两份都必须和 server/src/marketNetworks.ts 一致（有单测对拍）。
 * 收录标准（scripts/check-market-chains.mjs 实查）：EVM / Solana、LI.FI 能报价、GeckoTerminal 有流动性 ≥ $5k 的池子、
 * viem 能连上 RPC、DexScreener 能按链标识反查到币（币详情页靠它）。
 */
export const MARKET_PRIMARY: { dexKey: string; label: string }[] = [
  { dexKey: 'bsc', label: 'BSC' }, { dexKey: 'solana', label: 'Solana' }, { dexKey: 'base', label: 'Base' }, { dexKey: 'ethereum', label: 'ETH' },
  { dexKey: 'hyperevm', label: 'HyperEVM' }, { dexKey: 'robinhood', label: 'Robinhood' }, { dexKey: 'arbitrum', label: 'Arbitrum' },
  { dexKey: 'arc', label: 'Arc' }, { dexKey: 'polygon', label: 'Polygon' },
]
/** 「更多」按 2026-09-25 GeckoTerminal 热门池 24h 成交额从高到低排 */
export const MARKET_MORE: { dexKey: string; label: string }[] = [
  { dexKey: 'monad', label: 'Monad' }, { dexKey: 'optimism', label: 'Optimism' }, { dexKey: 'seiv2', label: 'Sei' }, { dexKey: 'avalanche', label: 'Avalanche' },
  { dexKey: 'mantle', label: 'Mantle' }, { dexKey: 'plasma', label: 'Plasma' }, { dexKey: 'unichain', label: 'Unichain' }, { dexKey: 'cronos', label: 'Cronos' },
  { dexKey: 'ink', label: 'Ink' }, { dexKey: 'flowevm', label: 'Flow' }, { dexKey: 'worldchain', label: 'World Chain' }, { dexKey: 'berachain', label: 'Berachain' },
  { dexKey: 'sonic', label: 'Sonic' }, { dexKey: 'megaeth', label: 'MegaETH' }, { dexKey: 'katana', label: 'Katana' }, { dexKey: 'soneium', label: 'Soneium' },
  { dexKey: 'linea', label: 'Linea' }, { dexKey: 'zksync', label: 'zkSync' }, { dexKey: 'abstract', label: 'Abstract' }, { dexKey: 'blast', label: 'Blast' },
]

/** 常用的主链（用于常规余额扫描与选币弹层的快捷链） */
export const MAIN_CHAIN_IDS = [SOLANA_CHAIN_ID, 1, 8453, 42161, 56, 137, 10]
/**
 * 选 NFT 头像时能挑的链。比交易那份多几条 NFT 大户链（ApeChain、Zora、Abstract 等），
 * 但不进 MAIN_CHAIN_IDS，免得交易和群门槛的选择器跟着变长。
 */
export const NFT_CHAIN_IDS = [SOLANA_CHAIN_ID, 1, 8453, 42161, 56, 137, 10, 33139, 7777777, 2741, 80094]
export const chainByDexKey = (key: string): ChainInfo | undefined => CHAINS.find((c) => c.dexKey === key)
/** GeckoTerminal 网络 id → 链 */
export const chainByGecko = (net: string): ChainInfo | undefined => CHAINS.find((c) => c.gecko === net)

/**
 * 永续合约不是链上代币，交易记录里的「链」存的是交易所标识。
 * 'hyperliquid' 是旧名：2026-09-18 合约切到 BSC 原生永续（Aster）时用了 import 别名，
 * 存进库的字符串没跟着改，历史记录与统计 SQL 都还认它，所以两个都要认。
 */
const PERP_KEYS = ['hyperliquid', 'aster']
export const isPerpMarket = (key: string) => PERP_KEYS.includes(key)
/** 永续记录的 token 形如 BTC:long，取出币种；认不出就返回 null */
export const perpCoinOf = (token: string): string | null => {
  const coin = token.split(':')[0].trim().toUpperCase()
  return coin && /^[A-Z0-9]{1,12}$/.test(coin) ? coin : null
}
/** 这条交易记录该跳去哪：永续跳合约页并选中币种，现货跳代币行情页 */
export const marketLinkOf = (chainKey: string, token: string): string => {
  if (!isPerpMarket(chainKey)) return `/token/${chainKey}/${token}`
  const coin = perpCoinOf(token)
  return coin ? `/perp?coin=${coin}` : '/perp'
}
/** 粗略判断地址属于哪类链 */
export function detectAddressType(addr: string): 'evm' | 'svm' | null {
  const a = addr.trim()
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return 'evm'
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return 'svm'
  return null
}

/**
 * 比特币（原生 BTC，2026-09-25 起）。不放进 CHAINS：CHAINS 被闪兑、授权扫描、选币器当成「能跑合约的链」遍历，
 * 比特币第一步只做收款 / 余额 / 发送。id 用 LI.FI 的比特币链 id，第二步闪兑直接拿去报价。
 */
export const BTC_CHAIN_ID = 20000000000001
export const BTC_CHAIN: ChainInfo = {
  id: BTC_CHAIN_ID,
  key: 'btc',
  dexKey: 'bitcoin',
  name: 'Bitcoin',
  type: 'utxo',
  logo: nativeLogo('bitcoin'),
  native: { chainId: BTC_CHAIN_ID, address: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', decimals: 8, logo: nativeLogo('bitcoin') },
  tokens: [],
  explorerTx: (h) => `https://mempool.space/tx/${h}`,
}

export const chainById = (id: number): ChainInfo | undefined => CHAINS.find((c) => c.id === id) ?? (id === BTC_CHAIN_ID ? BTC_CHAIN : undefined)
export const chainName = (id: number): string => chainById(id)?.name || `Chain ${id}`
/** 原生币的「包装版」地址。
 *
 *  钱包里原生 SOL 用 System Program（全 1）、原生 ETH 用 0x0 表示余额，这在转账
 *  场景下是对的。但 DEX 上不存在原生币的交易对——交易的是 wSOL / WETH / WBNB。
 *  拿全 1 去查行情，dexscreener 返回空，果蝇会直接崩在 "Token has no DEX pair"。
 *
 *  下面每个地址都用 dexscreener 实测过确有交易对，别凭记忆改。
 *  没列出的链不做映射：那些链上原生币的行情不是我们要覆盖的场景，
 *  用户可以直接选具体代币。 */
const WRAPPED_NATIVE: Record<string, string> = {
  solana: 'So11111111111111111111111111111111111111112',
  ethereum: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  bsc: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  base: '0x4200000000000000000000000000000000000006',
  arbitrum: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  polygon: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  optimism: '0x4200000000000000000000000000000000000006',
  avalanche: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
}

/** 查行情时把原生币换成包装版；不是原生币、或这条链没映射，就原样返回 */
export function forQuote(dexKey: string, address: string): string {
  if (!isNative(address)) return address
  return WRAPPED_NATIVE[dexKey] || address
}

export const isNative = (addr: string) => addr === NATIVE_EVM || addr === NATIVE_SOL || addr.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
export const sameAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
/**
 * 这个币是不是这条链的燃料费币（2026-09-29 审查 P1）。只看 isNative 会漏两种：
 *  - Arc 的燃料费是 USDC，LI.FI 和余额扫描都把它记成 0x3600…0000（见上面 Arc 的注释）；
 *  - Solana 的 SOL 在持仓里记成包装地址 So111…112（行情接口认这个），不是 NATIVE_SOL。
 * 漏了燃料费就恒为 0，自动补充会一直判定「缺燃料费」反复花 BNB。判断燃料费一律用这个，别直接用 isNative。
 */
export const WSOL_MINT = 'So11111111111111111111111111111111111111112'
export function isGasToken(chainId: number, addr: string): boolean {
  if (isNative(addr)) return true
  if (chainId === SOLANA_CHAIN_ID) return addr === WSOL_MINT
  const c = chainById(chainId)
  return !!c && sameAddr(addr, c.native.address)
}
/** 稳定币符号（闪兑默认目标、价格兜底为 1 美元） */
export const isStable = (symbol: string) => ['USDC', 'USDT', 'USDC.E', 'DAI', 'USDE', 'FDUSD'].includes(symbol.toUpperCase())
