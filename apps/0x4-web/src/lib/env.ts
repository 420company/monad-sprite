// Read env vars with defaults (injected by Vite at build time)
declare const __NATIVE_BUILD__: boolean

/** Public nodes, heavily rate-limited — fallback only */
export const PUBLIC_SOLANA_RPC = 'https://api.mainnet-beta.solana.com'
/**
 * Backend address. Web leaves it empty for same-origin relative paths; in the native app relative paths
 * point at the app's own bundled files (fetching back the home HTML — social, balances, sprites all fail),
 * so it must be absolute.
 */
export const API_BASE = ((import.meta.env.VITE_SOCIAL_API || '').replace(/\/$/, '')
  || (__NATIVE_BUILD__ ? 'https://api.420.meme' : ''))
const socialApi = API_BASE
const configuredRpc = (import.meta.env.VITE_SOLANA_RPC || '').trim()

/**
 * Native apps bundle the dev machine's .env, which lacks the paid node from the server's web.env —
 * configuring a public node equals not configuring (balances and holdings never load). In that case use
 * the backend's /rpc proxy, the same node as production web.
 */
const rpcUrl = __NATIVE_BUILD__ && socialApi && (!configuredRpc || configuredRpc === PUBLIC_SOLANA_RPC)
  ? `${socialApi}/rpc`
  : configuredRpc || PUBLIC_SOLANA_RPC

/** The web URL used for external sharing. In-app location.origin is capacitor://localhost — shared links wouldn't open */
export const WEB_BASE = (import.meta.env.VITE_WEB_BASE || '').replace(/\/$/, '')
  || (__NATIVE_BUILD__ ? 'https://420.meme' : `${location.origin}${location.pathname}`.replace(/\/$/, ''))

/**
 * WalletConnect project ID (public value, not a secret).
 * Only used for "link another wallet to view NFTs"; shared with the 420.meme website project.
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
  lifiIntegrator: import.meta.env.VITE_LIFI_INTEGRATOR || '0x4',  // Integrator name registered with LI.FI; the server's fees.ts only recognizes 0x4
  bngAddress: (import.meta.env.VITE_BNG_ADDRESS || '0x6652b21538fcdee00be8fd534673428760dc5505').trim(),
  bngChain: (import.meta.env.VITE_BNG_CHAIN || 'bsc').trim(),
}
