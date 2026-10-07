// Web perp "write ops" (place / cancel orders, change leverage / margin mode) are executed by the 0x4 browser extension (2026-09-30 goat: authorize once at login, no per-order popups on web afterwards).
//
// Why the extension sends requests itself: the exchange's proxy signature covers only params, not the request path and method. Hand the signature back to web and web could reuse a same-shaped signature against other write endpoints.
// So, same as read-only queries (asterPerpRead.ts): web only declares "which operation, which params"; the extension checks each against the whitelist here,
// fills in asterChain / user / signer / nonce itself, signs itself, sends the request itself — only the exchange's reply goes back to web; the signature never leaves the extension.
// Only four ops exist here: place, cancel, leverage, margin mode. Withdraw, transfer, noop, assetExchange etc. are not included — the extension never sends those for web.
// The extension (perpWrite in extension/src/background/ox4.ts) and web (lib/aster.ts) share this one whitelist — a single source of rules.
// The phone app doesn't go through here (the native vault keeps signing for itself).

/** Platform fee address (the exchange's builder). lib/aster.ts re-exports this same value */
export const BUILDER = '0x5F472529166c8897E6FfcC5Aa5258620c7bED338'
/**
 * The platform-fee cap the user authorized (0.06% of volume). The extension only places web orders with
 * feeRate at or under it; lib/aster.ts re-exports this same value.
 * ⚠️ Raising it requires everyone to re-authorize (FEE_REAUTH in lib/aster.ts) AND a new extension release,
 * or the extension will reject higher-fee orders
 */
export const BUILDER_FEE = '0.0006'

export type PerpWriteKind = 'order' | 'cancel' | 'leverage' | 'marginType'

/** Fixed path and method per operation */
export const PERP_WRITE_ROUTES: Record<PerpWriteKind, { method: 'POST' | 'DELETE'; path: string }> = {
  order: { method: 'POST', path: '/fapi/v3/order' },
  cancel: { method: 'DELETE', path: '/fapi/v3/order' },
  leverage: { method: 'POST', path: '/fapi/v3/leverage' },
  marginType: { method: 'POST', path: '/fapi/v3/marginType' },
}

/** One action web hands to the extension: op kind + exchange params (no asterChain / user / signer / nonce — the extension fills those in) */
export interface PerpWriteAction { action: PerpWriteKind; params: Record<string, string> }

/** One validated action: path, method, normalized params, plus what the extension needs to decide "popup or not" and display fields */
export interface PerpWriteOp {
  action: PerpWriteKind
  method: 'POST' | 'DELETE'
  path: string
  params: Record<string, string>
  symbol: string
  /** order: main order (market / limit) or TP/SL (closes the whole position on trigger) */
  role?: 'main' | 'protect'
}

/** Max actions per batch: leverage + margin mode + main order + TP + SL */
export const PERP_WRITE_MAX_ACTIONS = 5

const SYMBOL = /^[A-Z0-9]{1,20}USDT$/
/** Positive decimal: max 18 integer and 18 fraction digits; no scientific notation, signs, or spaces */
const DECIMAL = /^\d{1,18}(\.\d{1,18})?$/
const INT = /^\d{1,20}$/

const bad = (why: string): never => { throw new Error(`perpWrite: ${why}`) }
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

/** Extract params: strings only (numbers accepted, coerced to string); nothing outside allowed may be present */
function take(params: unknown, allowed: readonly string[]): Record<string, string> {
  if (!params || typeof params !== 'object' || Array.isArray(params)) bad('params')
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (!allowed.includes(k)) bad(`param ${k}`)
    const s = typeof v === 'number' && Number.isFinite(v) ? String(v) : v
    if (typeof s !== 'string' || !s || s.length > 64) bad(`param ${k}`)
    out[k] = s as string
  }
  return out
}
const positive = (s: string | undefined, name: string) => {
  if (s === undefined || !DECIMAL.test(s) || !(Number(s) > 0)) bad(name)
  return s as string
}

/**
 * Validate and normalize one write op. Returns the fixed path, method, and params in fixed order on success;
 * throws on failure. Used both when the extension receives a web request and before web sends one.
 *   order: symbol / side (BUY / SELL) / type, plus builder (must be the platform address) and feeRate (≤ BUILDER_FEE)
 *     - MARKET: quantity, optional reduceOnly=true
 *     - LIMIT: quantity + price + timeInForce=GTC, optional reduceOnly=true
 *     - STOP_MARKET / TAKE_PROFIT_MARKET: TP/SL only (stopPrice + closePosition=true, closes the whole position on trigger), no quantity
 *   cancel: symbol + orderId
 *   leverage: symbol + integer 1–125
 *   marginType: symbol + CROSSED / ISOLATED
 */
export function perpWriteOp(input: unknown): PerpWriteOp {
  if (!input || typeof input !== 'object' || Array.isArray(input)) bad('action')
  const { action, params } = input as { action?: unknown; params?: unknown }
  if (typeof action !== 'string' || !own(PERP_WRITE_ROUTES, action)) bad('action')
  const kind = action as PerpWriteKind
  const route = PERP_WRITE_ROUTES[kind]
  const symbolOf = (p: Record<string, string>) => { if (!p.symbol || !SYMBOL.test(p.symbol)) bad('symbol'); return p.symbol }

  if (kind === 'cancel') {
    const p = take(params, ['symbol', 'orderId'])
    const symbol = symbolOf(p)
    if (!p.orderId || !INT.test(p.orderId)) bad('orderId')
    return { action: kind, ...route, symbol, params: { symbol, orderId: String(BigInt(p.orderId)) } }
  }
  if (kind === 'leverage') {
    const p = take(params, ['symbol', 'leverage'])
    const symbol = symbolOf(p)
    if (!p.leverage || !/^\d{1,3}$/.test(p.leverage)) bad('leverage')
    const lev = Number(p.leverage)
    if (lev < 1 || lev > 125) bad('leverage')
    return { action: kind, ...route, symbol, params: { symbol, leverage: String(lev) } }
  }
  if (kind === 'marginType') {
    const p = take(params, ['symbol', 'marginType'])
    const symbol = symbolOf(p)
    if (p.marginType !== 'CROSSED' && p.marginType !== 'ISOLATED') bad('marginType')
    return { action: kind, ...route, symbol, params: { symbol, marginType: p.marginType } }
  }

  // Place order
  const p = take(params, ['symbol', 'side', 'type', 'quantity', 'price', 'timeInForce', 'reduceOnly', 'closePosition', 'stopPrice', 'builder', 'feeRate'])
  const symbol = symbolOf(p)
  if (p.side !== 'BUY' && p.side !== 'SELL') bad('side')
  if (!p.builder || p.builder.toLowerCase() !== BUILDER.toLowerCase()) bad('builder')
  if (!p.feeRate || !DECIMAL.test(p.feeRate) || Number(p.feeRate) > Number(BUILDER_FEE)) bad('feeRate')
  const fee = { builder: BUILDER, feeRate: p.feeRate }
  const has = (k: string) => own(p, k)
  if (p.type === 'MARKET' || p.type === 'LIMIT') {
    if (has('stopPrice') || has('closePosition')) bad('trigger')
    if (has('reduceOnly') && p.reduceOnly !== 'true') bad('reduceOnly')
    const quantity = positive(p.quantity, 'quantity')
    const out: Record<string, string> = { symbol, side: p.side, type: p.type, quantity }
    if (p.type === 'LIMIT') {
      out.price = positive(p.price, 'price')
      if (p.timeInForce !== 'GTC') bad('timeInForce')
      out.timeInForce = 'GTC'
    } else if (has('price') || has('timeInForce')) bad('price')
    if (p.reduceOnly === 'true') out.reduceOnly = 'true'
    return { action: kind, ...route, symbol, role: 'main', params: { ...out, ...fee } }
  }
  if (p.type === 'STOP_MARKET' || p.type === 'TAKE_PROFIT_MARKET') {
    // TP/SL only: market-closes the whole position on trigger. Trigger orders with quantity (which could open new positions) are rejected
    if (has('quantity') || has('price') || has('timeInForce') || has('reduceOnly')) bad('protect')
    if (p.closePosition !== 'true') bad('closePosition')
    const stopPrice = positive(p.stopPrice, 'stopPrice')
    return { action: kind, ...route, symbol, role: 'protect', params: { symbol, side: p.side, type: p.type, stopPrice, closePosition: 'true', ...fee } }
  }
  return bad('type')
}

/**
 * Validate a batch of actions (one user operation): 1–5, all the same coin; at most one leverage change,
 * one margin-mode change, one main order, two TP/SL; cancels must stand alone; TP/SL must oppose the main
 * order's side. Returns actions in execution order: leverage → margin mode → main order → TP/SL.
 */
export function perpWriteBatch(actions: unknown): PerpWriteOp[] {
  if (!Array.isArray(actions) || actions.length < 1 || actions.length > PERP_WRITE_MAX_ACTIONS) bad('actions')
  const ops = (actions as unknown[]).map(perpWriteOp)
  if (new Set(ops.map((o) => o.symbol)).size !== 1) bad('symbol')
  const count = (f: (o: PerpWriteOp) => boolean) => ops.filter(f).length
  if (count((o) => o.action === 'cancel') && ops.length !== 1) bad('cancel')
  if (count((o) => o.action === 'leverage') > 1 || count((o) => o.action === 'marginType') > 1) bad('settings')
  if (count((o) => o.role === 'main') > 1 || count((o) => o.role === 'protect') > 2) bad('orders')
  const protects = ops.filter((o) => o.role === 'protect')
  if (new Set(protects.map((o) => o.params.type)).size !== protects.length) bad('protect')
  const main = ops.find((o) => o.role === 'main')
  if (main && protects.some((o) => o.params.side === main.params.side)) bad('protect side')
  const rank = (o: PerpWriteOp) => o.action === 'leverage' ? 0 : o.action === 'marginType' ? 1 : o.role === 'main' ? 2 : o.role === 'protect' ? 3 : 4
  return [...ops].sort((a, b) => rank(a) - rank(b))
}

/**
 * Whether the exchange's reply counts as success: HTTP 2xx with no negative code.
 * Margin-mode changes returning "No need to change margin type" (already in that mode) also count as success.
 */
export function perpWriteOk(op: Pick<PerpWriteOp, 'action'>, status: number, body: unknown): boolean {
  const code = body && typeof body === 'object' && 'code' in body ? Number((body as { code: unknown }).code) : 0
  if (status >= 200 && status < 300 && !(code < 0)) return true
  const msg = body && typeof body === 'object' ? String((body as { msg?: unknown }).msg ?? '') : String(body ?? '')
  return op.action === 'marginType' && /No need to change/i.test(msg)
}

/** Per-action results handed back to web: executed ones carry the exchange's HTTP status and reply; when an earlier action fails, later ones don't run (skipped) */
export type PerpWriteResult = { action: PerpWriteKind; status: number; body: unknown } | { action: PerpWriteKind; skipped: true }

// ---------- Web express-trading session (authorize once at login; no per-order popups on web afterwards) ----------

/** Max session lifetime (wallet lock, site disconnect, or browser close end it early). 2026-09-30 goat: no amount / leverage / cumulative caps — the session has only an expiry */
export const PERP_SESSION_TTL_MS = 24 * 3600_000
