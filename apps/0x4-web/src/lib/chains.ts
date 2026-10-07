import { getAddress } from 'viem'
// Multi-chain registry: supported chains, native coins, common tokens (USDC / USDT)
// LI.FI identifies chains by numeric chainId; Solana's id is 1151111081099710
import {
  mainnet, base, arbitrum, bsc, polygon, optimism,
  robinhood, hyperEvm, arc, monad, monadTestnet, megaeth, sei, plasma, katana, flowMainnet, avalanche, linea, zksync, scroll, blast, mantle, sonic, berachain, unichain, abstract, gnosis, celo, fantom, ink, soneium, worldchain, mode, zora, cronos, opBNB, apeChain,
  type Chain as ViemChain,
} from 'viem/chains'

export const SOLANA_CHAIN_ID = 1151111081099710
/** The address representing the native coin in LI.FI */
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
  /** The chain identifier DexScreener uses */
  dexKey: string
  name: string
  type: 'evm' | 'svm' | 'utxo'
  logo: string
  native: ChainToken
  /** Common tokens (for balance scans and quick picks) */
  tokens: ChainToken[]
  viem?: ViemChain
  /** GeckoTerminal network id (for the Discover rankings and K-lines); absent means GeckoTerminal doesn't list this chain */
  gecko?: string
  explorerTx: (hash: string) => string
}

const lifiLogo = (key: string) => `https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/${key}.svg`
// LI.FI's icons repo tokens/ directory is 404 now; DexScreener's CDN only has images for paid-profile coins (measured: even USDC 404s).
// So token images get a candidate list (TokenLogo tries each): TrustWallet (checksummed address required) → DexScreener. Native coins go through TrustWallet.
const TW = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains'
const TW_DIR: Record<string, string> = { ethereum: 'ethereum', base: 'base', arbitrum: 'arbitrum', bsc: 'smartchain', polygon: 'polygon', optimism: 'optimism', avalanche: 'avalanchec', linea: 'linea', zksync: 'zksync', scroll: 'scroll', blast: 'blast', mantle: 'mantle', sonic: 'sonic', gnosischain: 'xdai', celo: 'celo', fantom: 'fantom', cronos: 'cronos', solana: 'solana' }
const checksum = (a: string) => { try { return getAddress(a) } catch { return a } }
/** Token image candidate string (| separated), handed to TokenLogo to try one by one */
export function tokenLogo(dexKey: string, addr: string, primary?: string | null): string {
  const tw = TW_DIR[dexKey]
  const list = [primary || '', tw ? `${TW}/${tw}/assets/${addr.startsWith('0x') ? checksum(addr) : addr}/logo.png` : '', `https://dd.dexscreener.com/ds-data/tokens/${dexKey}/${addr.startsWith('0x') ? addr.toLowerCase() : addr}.png`]
  return list.filter(Boolean).join('|')
}
const NATIVE_LOGO: Record<string, string> = { eth: `${TW}/ethereum/info/logo.png`, bnb: `${TW}/smartchain/info/logo.png`, pol: `${TW}/polygon/info/logo.png`, sol: `${TW}/solana/info/logo.png`, avax: `${TW}/avalanchec/info/logo.png`, ftm: `${TW}/fantom/info/logo.png`, celo: `${TW}/celo/info/logo.png`, xdai: `${TW}/xdai/info/logo.png`, cro: `${TW}/cronos/info/logo.png`, mnt: `${TW}/mantle/info/logo.png`, s: `${TW}/sonic/info/logo.png`, bera: 'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/tokens/bera.svg' } // TrustWallet has no berachain directory (404)
const nativeLogo = (key: string) => NATIVE_LOGO[key] || `${TW}/${key}/info/logo.png`

/**
 * DexScreener chain identifier -> GeckoTerminal network id. Cross-checked against both live lists on 2026-09-25 with scripts/check-market-chains.mjs;
 * every chain was reverse-verified on DexScreener with a real pair from GeckoTerminal's hot pools — don't guess from names (XLayer is "xlayer" on DexScreener, Sei is "seiv2").
 */
export const GECKO_NETWORK: Record<string, string> = {
  solana: 'solana', ethereum: 'eth', base: 'base', arbitrum: 'arbitrum', bsc: 'bsc', polygon: 'polygon_pos', optimism: 'optimism',
  avalanche: 'avax', linea: 'linea', zksync: 'zksync', scroll: 'scroll', blast: 'blast', mantle: 'mantle', sonic: 'sonic',
  berachain: 'berachain', unichain: 'unichain', abstract: 'abstract', gnosischain: 'xdai', celo: 'celo', fantom: 'ftm', ink: 'ink', mode: 'mode', cronos: 'cro',
  robinhood: 'robinhood', soneium: 'soneium', worldchain: 'world-chain', opbnb: 'opbnb', apechain: 'apechain',
  hyperevm: 'hyperevm', arc: 'arc', monad: 'monad', megaeth: 'megaeth', seiv2: 'sei-evm', plasma: 'plasma', katana: 'katana', flowevm: 'flow-evm',
}

/**
 * Extra options (added 2026-09-25 during the Discover page chain expansion):
 *  - logo / nativeLogo: LI.FI's icon filenames don't match our keys, or TrustWallet has no native-coin image for the chain — give a full URL instead (all verified openable with curl)
 *  - native: chains whose native coin is an ERC-20 address in LI.FI. Arc's gas is USDC, which LI.FI records as 0x3600…0000 with 6 decimals;
 *    quoting with 0x0 would be treated as 6-decimal and compute a 99.99% price gap. For such chains, use LI.FI's address and decimals directly for the native coin;
 *    the scanned native balance (18 decimals) converts numerically to the same money as the ERC-20 balance.
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
    ['0x6652b21538fcdee00be8fd534673428760dc5505', 'BNG', 'BNG', 18], // Platform token; its decimals are corrected to the on-chain value at startup
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
  // These chains don't scan common token balances by default (only native coins and favorited tokens), but all are tradable via LI.FI
  // Robinhood Chain (mainnet 2026-07-01, Arbitrum Orbit L2, gas in ETH). Supported by both LI.FI (chainId 4663) and DexScreener (robinhood).
  // USDG is Paxos's Global Dollar 0x5fc5… (689M on-chain supply); another token calling itself "Paxos USDG" at 0x0A3B… has only 1,100 — a fake, don't accept it
  evmChain(robinhood, 'robinhood', 'ETH', 'Ether', 'eth', [
    ['0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', 'USDG', 'Global Dollar', 6],
    ['0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34', 'USDe', 'USDe', 18],
  ]),
  // HyperEVM (Hyperliquid's EVM chain, gas in HYPE). USDC is Circle-native, USDT0 is the LayerZero USDT; symbol / decimals were read on-chain 2026-09-25
  evmChain(hyperEvm, 'hyperevm', 'HYPE', 'Hyperliquid', 'hype', [
    ['0xb88339CB7199b77E23DB6E890353E22632Ba630f', 'USDC', 'USD Coin', 6],
    ['0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', 'USDT0', 'USDT0', 6],
  ], 'hyperevm', { nativeLogo: 'https://static.debank.com/image/hyper_token/logo_url/hyper/0b3e288cfe418e9ce69eef4c96374583.png' }),
  // Arc (Circle's chain, gas is USDC). viem's definitions lack its RPC and multicall3 — added here: RPC uses LI.FI's public node (eth_chainId measured 5042),
  // multicall3 is deployed at the canonical address (eth_getCode measured non-empty). Native coins follow LI.FI's notation (see the EvmExtra note); USDC isn't listed separately, so the same money doesn't show twice
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
  // The 5 below were added 2026-09-25 under Discover's "more": popular tokens aren't scanned (only native coins and favorites), but they're tradable via LI.FI. Chains whose DexScreener identifier differs from the key are written out separately
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
  evmChain(worldchain, 'worldchain', 'ETH', 'Ether', 'eth', [], 'worldchain', { logo: lifiLogo('world') }), // LI.FI's icon is named world.svg; worldchain.svg is a 404
  evmChain(mode, 'mode', 'ETH', 'Ether', 'eth', []),
  evmChain(zora, 'zora', 'ETH', 'Ether', 'eth', []),
  evmChain(cronos, 'cronos', 'CRO', 'Cronos', 'cro', []),
  evmChain(opBNB, 'opbnb', 'BNB', 'BNB', 'bnb', []),
  evmChain(apeChain, 'apechain', 'APE', 'ApeCoin', 'ape', []),
]

/**
 * Discover page chain filter (order set by goat 2026-09-25, BSC first). Values are DexScreener chain identifiers.
 * The main filter's chains are polled by a resident server loop; chains under "more" are fetched on demand when selected. Both must match server/src/marketNetworks.ts (a unit test cross-checks them).
 * Listing bar (verified with scripts/check-market-chains.mjs): EVM / Solana, LI.FI quotable, GeckoTerminal pool liquidity >= $5k,
 * viem can reach an RPC, DexScreener can resolve the coin by chain identifier (the coin detail page relies on it).
 */
export const MARKET_PRIMARY: { dexKey: string; label: string }[] = [
  { dexKey: 'bsc', label: 'BSC' }, { dexKey: 'solana', label: 'Solana' }, { dexKey: 'base', label: 'Base' }, { dexKey: 'ethereum', label: 'ETH' },
  { dexKey: 'hyperevm', label: 'HyperEVM' }, { dexKey: 'robinhood', label: 'Robinhood' }, { dexKey: 'arbitrum', label: 'Arbitrum' },
  { dexKey: 'arc', label: 'Arc' }, { dexKey: 'polygon', label: 'Polygon' },
]
/** "More" is sorted by 2026-09-25 GeckoTerminal hot-pool 24h volume, high to low */
export const MARKET_MORE: { dexKey: string; label: string }[] = [
  { dexKey: 'monad', label: 'Monad' }, { dexKey: 'optimism', label: 'Optimism' }, { dexKey: 'seiv2', label: 'Sei' }, { dexKey: 'avalanche', label: 'Avalanche' },
  { dexKey: 'mantle', label: 'Mantle' }, { dexKey: 'plasma', label: 'Plasma' }, { dexKey: 'unichain', label: 'Unichain' }, { dexKey: 'cronos', label: 'Cronos' },
  { dexKey: 'ink', label: 'Ink' }, { dexKey: 'flowevm', label: 'Flow' }, { dexKey: 'worldchain', label: 'World Chain' }, { dexKey: 'berachain', label: 'Berachain' },
  { dexKey: 'sonic', label: 'Sonic' }, { dexKey: 'megaeth', label: 'MegaETH' }, { dexKey: 'katana', label: 'Katana' }, { dexKey: 'soneium', label: 'Soneium' },
  { dexKey: 'linea', label: 'Linea' }, { dexKey: 'zksync', label: 'zkSync' }, { dexKey: 'abstract', label: 'Abstract' }, { dexKey: 'blast', label: 'Blast' },
]

/** Common main chains (for routine balance scans and the coin picker's quick chains) */
export const MAIN_CHAIN_IDS = [SOLANA_CHAIN_ID, 1, 8453, 42161, 56, 137, 10]
/**
 * Chains available when picking an NFT avatar. A few more NFT-heavy chains than the trading set (ApeChain, Zora, Abstract, etc.),
 * but kept out of MAIN_CHAIN_IDS so the trading and group-gating pickers don't get longer.
 */
export const NFT_CHAIN_IDS = [SOLANA_CHAIN_ID, 1, 8453, 42161, 56, 137, 10, 33139, 7777777, 2741, 80094]
export const chainByDexKey = (key: string): ChainInfo | undefined => CHAINS.find((c) => c.dexKey === key)
/** GeckoTerminal network id → chain */
export const chainByGecko = (net: string): ChainInfo | undefined => CHAINS.find((c) => c.gecko === net)

/**
 * Perps aren't on-chain tokens — the "chain" stored in trade records is the exchange identifier.
 * 'hyperliquid' is the old name: when perps moved to BSC-native perps (Aster) on 2026-09-18, an import alias was used,
 * but the strings stored in the DB weren't renamed; history and stats SQL still recognize it, so both must be recognized.
 */
const PERP_KEYS = ['hyperliquid', 'aster']
export const isPerpMarket = (key: string) => PERP_KEYS.includes(key)
/** Perp record tokens look like BTC:long — extract the coin; return null when unrecognized */
export const perpCoinOf = (token: string): string | null => {
  const coin = token.split(':')[0].trim().toUpperCase()
  return coin && /^[A-Z0-9]{1,12}$/.test(coin) ? coin : null
}
/** Where this trade record should jump: perps jump to the perps page with the coin selected, spot jumps to the token market page */
export const marketLinkOf = (chainKey: string, token: string): string => {
  if (!isPerpMarket(chainKey)) return `/token/${chainKey}/${token}`
  const coin = perpCoinOf(token)
  return coin ? `/perp?coin=${coin}` : '/perp'
}
/** Roughly determine which chain family an address belongs to */
export function detectAddressType(addr: string): 'evm' | 'svm' | null {
  const a = addr.trim()
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return 'evm'
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return 'svm'
  return null
}

/**
 * Bitcoin (native BTC, since 2026-09-25). Not in CHAINS: CHAINS is traversed by swaps, approval scans, and the coin picker as "chains that can run contracts";
 * Bitcoin step one is only receive / balance / send. id uses LI.FI's Bitcoin chain id; step two swaps quote with it directly.
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
/** The "wrapped" address of the native coin.
 *
 *  Wallets represent native SOL as the System Program (all 1s) and native ETH as 0x0 for balances, which is right for
 *  transfers. But there are no native-coin pairs on a DEX — what's traded is wSOL / WETH / WBNB.
 *  Looking up all-1s for market data returns empty on DexScreener, and the fly crashes straight into "Token has no DEX pair".
 *
 *  Every address below was verified on DexScreener to actually have a pair — don't change from memory.
 *  Chains not listed get no mapping: native-coin quotes on those chains aren't a scenario we cover;
 *  users can pick a specific token directly. */
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

/** Swap native coins for the wrapped version when quoting; return as-is for non-native coins or chains without a mapping */
export function forQuote(dexKey: string, address: string): string {
  if (!isNative(address)) return address
  return WRAPPED_NATIVE[dexKey] || address
}

export const isNative = (addr: string) => addr === NATIVE_EVM || addr === NATIVE_SOL || addr.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
export const sameAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
/**
 * Whether this coin is the chain's gas token (2026-09-29 review P1). Checking only isNative misses two cases:
 *  - Arc's gas is USDC, recorded by both LI.FI and the balance scanner as 0x3600…0000 (see the Arc note above);
 *  - SOL in positions is recorded as the wrapped address So111…112 (the quote API knows this one), not NATIVE_SOL.
 * Missing the gas token pins it at 0 forever, and auto-topup keeps judging "gas missing" and burning BNB repeatedly. Always use this to judge gas — never isNative directly.
 */
export const WSOL_MINT = 'So11111111111111111111111111111111111111112'
export function isGasToken(chainId: number, addr: string): boolean {
  if (isNative(addr)) return true
  if (chainId === SOLANA_CHAIN_ID) return addr === WSOL_MINT
  const c = chainById(chainId)
  return !!c && sameAddr(addr, c.native.address)
}
/** Stablecoin symbols (swap default target, price fallback $1) */
export const isStable = (symbol: string) => ['USDC', 'USDT', 'USDC.E', 'DAI', 'USDE', 'FDUSD'].includes(symbol.toUpperCase())
