// 全局共享的数据类型

/** 代币基础信息 */
export interface TokenInfo {
  address: string
  symbol: string
  name: string
  logo?: string
  decimals?: number
}

/** 带行情的代币（来自 DexScreener 的交易对数据） */
export interface MarketToken extends TokenInfo {
  /** DexScreener 链标识，如 solana / base */
  chain: string
  /** LI.FI 链 id */
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
  /** 搜索结果里：主流币的官方合约（lib/officialTokens.ts） */
  official?: boolean
  /** 搜索结果里：符号和某个主流币一样但不是官方合约（可能是仿冒）。2026-09-30 起只在粘贴合约地址搜索时会出现 */
  impostor?: boolean
  /** 搜索结果里：非官方、交易池 3 天内刚创建（界面标「新创建」，风险较高） */
  fresh?: boolean
}

/** 钱包里的持仓 */
export interface Holding {
  /** 所在链（LI.FI chainId，Solana 为 1151111081099710） */
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

/** 链上活动记录 */
export interface ActivityItem {
  signature: string
  slot: number
  blockTime?: number | null
  err: boolean
  memo?: string | null
}

/** 本地加密保存的钱包金库 */
export interface Vault {
  version: 1 | 2
  publicKey: string
  /** EVM 地址（v2 起有） */
  evmAddress?: string
  /** 比特币收款地址 bc1q…（明文，锁着也能显示；2026-09-25 起新建 / 解锁时补上） */
  btcAddress?: string
  /** Solana 私钥密文（AES-GCM） */
  secret: CipherBlob
  /** EVM 私钥密文（v2 起有） */
  evmSecret?: CipherBlob
  /** 助记词密文（仅通过助记词创建/导入时存在） */
  mnemonic?: CipherBlob
  createdAt: number
}

export interface CipherBlob {
  salt: string
  iv: string
  data: string
  iterations: number
}
