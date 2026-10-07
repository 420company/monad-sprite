// 读取环境变量并提供默认值（构建时由 Vite 注入）
declare const __NATIVE_BUILD__: boolean

/** 公共节点，限流严重，只当兜底 */
export const PUBLIC_SOLANA_RPC = 'https://api.mainnet-beta.solana.com'
/**
 * 后端地址。网页版留空走同源相对路径；原生 App 里相对路径会指向 App 自己的内置文件
 * （请求拿回首页 HTML，社交、余额、果蝇全部连不上），所以必须是绝对地址。
 */
export const API_BASE = ((import.meta.env.VITE_SOCIAL_API || '').replace(/\/$/, '')
  || (__NATIVE_BUILD__ ? 'https://api.420.meme' : ''))
const socialApi = API_BASE
const configuredRpc = (import.meta.env.VITE_SOLANA_RPC || '').trim()

/**
 * 原生 App 打包用的是开发机上的 .env，没有服务器上 web.env 里那条付费节点，
 * 配成公共节点等于没配（余额、持仓会一直拉不出来）。这种情况下走后端的 /rpc 代理，
 * 和线上网页版是同一个节点。
 */
const rpcUrl = __NATIVE_BUILD__ && socialApi && (!configuredRpc || configuredRpc === PUBLIC_SOLANA_RPC)
  ? `${socialApi}/rpc`
  : configuredRpc || PUBLIC_SOLANA_RPC

/** 对外分享用的网页版地址。App 里 location.origin 是 capacitor://localhost，分享出去打不开 */
export const WEB_BASE = (import.meta.env.VITE_WEB_BASE || '').replace(/\/$/, '')
  || (__NATIVE_BUILD__ ? 'https://420.meme' : `${location.origin}${location.pathname}`.replace(/\/$/, ''))

/**
 * WalletConnect 的 project ID（公开值，不是密钥）。
 * 只用于「关联其他钱包看 NFT」，与 420.meme 官网共用同一个项目。
 */
export const WALLETCONNECT_ID = (import.meta.env.VITE_WALLETCONNECT_ID || '').trim()
  || '902842f45d358b9a04a5a72af7b2e3b9'

export const ENV = {
  rpcUrl,
  jupiterApi: (import.meta.env.VITE_JUPITER_API || 'https://lite-api.jup.ag').replace(/\/$/, ''),
  dexscreenerApi: (import.meta.env.VITE_DEXSCREENER_API || 'https://api.dexscreener.com').replace(/\/$/, ''),
  platformFeeBps: Number(import.meta.env.VITE_PLATFORM_FEE_BPS || 0),
  platformFeeAccount: import.meta.env.VITE_PLATFORM_FEE_ACCOUNT || '',
  lifiApi: (import.meta.env.VITE_LIFI_API || 'https://li.quest/v1').replace(/\/$/, ''),
  lifiApiKey: import.meta.env.VITE_LIFI_API_KEY || '',
  lifiIntegrator: import.meta.env.VITE_LIFI_INTEGRATOR || '0x4',  // 在 LI.FI 注册的集成方名，服务器 fees.ts 只认 0x4
  bngAddress: (import.meta.env.VITE_BNG_ADDRESS || '0x6652b21538fcdee00be8fd534673428760dc5505').trim(),
  bngChain: (import.meta.env.VITE_BNG_CHAIN || 'bsc').trim(),
}
