// Globally shared data types

/** Basic token info */
export interface TokenInfo {
  address: string
  symbol: string
  name: string
  logo?: string
  decimals?: number
}

/** Token with quote (from DexScreener pair data) */
export interface MarketToken extends TokenInfo {
  /** DexScreener chain key, e.g. solana / base */
  chain: string
  /** LI.FI chain id */
  chainId: number
  priceUsd: number
  priceNative?: number
  change5m?: number
  change1h?: number
  change6h?: number
  change24h?: number
  volume24h?: number
  liquidityUsd?: number
  marketCap?: number
  fdv?: number
  buys24h?: number
  sells24h?: number
  pairAddress?: string
  dexId?: string
  createdAt?: number
  description?: string
  url?: string
  /** In search results: a major's official contract (lib/officialTokens.ts) */
  official?: boolean
  /** In search results: same symbol as a major but not the official contract (possible impersonation). Since 2026-09-30 it only appears when searching a pasted contract address */
  impostor?: boolean
  /** In search results: unofficial, pool created within 3 days (UI tags it "newly created" — higher risk) */
  fresh?: boolean
}

/** Holdings in the wallet */
export interface Holding {
  /** Home chain (LI.FI chainId; Solana is 1151111081099710) */
  chainId: number
  mint: string
  amount: number
  decimals: number
  symbol: string
  name: string
  logo?: string
  priceUsd: number
  valueUsd: number
  change24h?: number
}

/** On-chain activity record */
export interface ActivityItem {
  signature: string
  slot: number
  blockTime?: number | null
  err: boolean
  memo?: string | null
}

/** Locally encrypted wallet vault */
export interface Vault {
  version: 1 | 2
  publicKey: string
  /** EVM address (present since v2) */
  evmAddress?: string
  /** Bitcoin receiving address bc1q… (plaintext, shown even when locked; backfilled on create / unlock since 2026-09-25) */
  btcAddress?: string
  /** Solana private key ciphertext (AES-GCM) */
  secret: CipherBlob
  /** EVM private key ciphertext (present since v2) */
  evmSecret?: CipherBlob
  /** Mnemonic ciphertext (only exists when created / imported via mnemonic) */
  mnemonic?: CipherBlob
  createdAt: number
}

export interface CipherBlob {
  salt: string
  iv: string
  data: string
  iterations: number
}
