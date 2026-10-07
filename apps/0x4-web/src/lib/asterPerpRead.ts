// Web perp "read-only queries" are delegated to the 0x4 browser extension (changed after the 2026-09-29 security review).
//
// The old way: the page handed the extension the agent signature for requests like "query account"; the extension saw only asterChain / user / signer / nonce / limit in the params
// treated it as read-only and signed without a popup, handing the signature back to the page, which then queried the exchange itself. The problem: the exchange's signature covers only the params — not the request path or method,
// and write endpoints without business params (noop, which cancels queued requests by nonce; assetExchange, which force-converts assets in portfolio-margin mode; etc.)
// need a signature identical to "query account" — the page could use such a signature to call write endpoints, and the extension neither limited the count nor controlled the nonce.
//
// The new way: the signature never leaves the extension. The page only says "which item to query" (the four fixed GET endpoints in the whitelist below) plus a few whitelisted params,
// and the extension generates the nonce, signs, and sends the GET to the exchange itself — only the resulting JSON goes back to the page.
// The extension (perpRead in extension/src/background/ox4.ts) and the web page (call in lib/aster.ts) share this one whitelist — this is the single source of the rule.
// The mobile app doesn't go through here (native vault still signs its own read-only requests).

/** Exchange API host (same as lib/aster.ts's HOST; the extension's manifest grants access to this domain) */
export const ASTER_HOST = 'https://fapi.asterdex.com'
/** EIP-712 domain for perp-trading agent signatures (lib/aster.ts DOMAIN_AGENT) */
export const ASTER_AGENT_DOMAIN = { name: 'AsterSignTransaction', version: '1', chainId: 1666, verifyingContract: '0x0000000000000000000000000000000000000000' } as const
export const ASTER_AGENT_TYPES = { Message: [{ name: 'msg', type: 'string' }] } as const

/** Read-only endpoints the extension may proxy: name → fixed path (always GET). The web perp page only actually uses these four */
export const PERP_READ_PATHS = {
  account: '/fapi/v3/account',
  openOrders: '/fapi/v3/openOrders',
  userTrades: '/fapi/v3/userTrades',
  leverageBracket: '/fapi/v3/leverageBracket',
} as const
export type PerpReadEndpoint = keyof typeof PERP_READ_PATHS

/** Allowed params per endpoint (values always validated as decimal positive integers). Unlisted params are never allowed */
const PARAM_RULES: Record<PerpReadEndpoint, Record<string, { min: number; max: number }>> = {
  account: {},
  openOrders: {},
  userTrades: { limit: { min: 1, max: 1000 } },   // Fill history count (exchange cap 1000)
  leverageBracket: {},
}

const isEndpoint = (x: unknown): x is PerpReadEndpoint => typeof x === 'string' && Object.prototype.hasOwnProperty.call(PERP_READ_PATHS, x)

/** Web side: path → endpoint name; null when not in the whitelist */
export function perpReadEndpointOf(path: string): PerpReadEndpoint | null {
  for (const k of Object.keys(PERP_READ_PATHS) as PerpReadEndpoint[]) if (PERP_READ_PATHS[k] === path) return k
  return null
}

/**
 * Validate and normalize a read-only query: the endpoint must be whitelisted, params must be the endpoint's allowed ones with in-range integer values.
 * Returns the fixed path and normalized params (strings) on success; throws on failure. Used by the extension when receiving page requests and by the page before sending.
 */
export function perpReadQuery(endpoint: unknown, params: unknown): { endpoint: PerpReadEndpoint; path: string; params: Record<string, string> } {
  if (!isEndpoint(endpoint)) throw new Error('perpRead: endpoint')
  if (params !== undefined && params !== null && (typeof params !== 'object' || Array.isArray(params))) throw new Error('perpRead: params')
  const rules = PARAM_RULES[endpoint]
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries((params ?? {}) as Record<string, unknown>)) {
    const rule = Object.prototype.hasOwnProperty.call(rules, k) ? rules[k] : undefined
    if (!rule) throw new Error(`perpRead: param ${k}`)
    const s = typeof v === 'number' ? String(v) : v
    if (typeof s !== 'string' || !/^\d{1,7}$/.test(s)) throw new Error(`perpRead: param ${k}`)
    const n = Number(s)
    if (n < rule.min || n > rule.max) throw new Error(`perpRead: param ${k}`)
    out[k] = String(n)
  }
  return { endpoint, path: PERP_READ_PATHS[endpoint], params: out }
}
