// 网页版合约的「写操作」（下单 / 撤单 / 改杠杆 / 改保证金模式）由 0x4 浏览器插件代办（2026-09-30 goat：登录时授权一次，之后网页下单不再逐笔弹窗）。
//
// 为什么插件要自己发请求：交易所的代理签名只覆盖参数、不含请求路径和方法。签名交回网页，网页就能把同样形状的签名拿去调别的写接口。
// 所以和只读查询（asterPerpRead.ts）一样：网页只说「做哪一种操作、参数是什么」，插件按这里的白名单逐项核对，
// 自己补上 asterChain / user / signer / nonce、自己签、自己发请求，只把交易所的回复交回网页，签名不离开插件。
// 这里只有下单、撤单、改杠杆、改保证金模式四种。提现、转账、noop、assetExchange 这类接口不在里面，插件永远不会替网页发。
// 插件（extension/src/background/ox4.ts 的 perpWrite）和网页（lib/aster.ts）用同一份白名单，规则只有这一份。
// 手机 App 不走这里（原生金库照旧由 App 自己签）。

/** 平台收费地址（交易所的 builder）。lib/aster.ts 从这里导出同一个值 */
export const BUILDER = '0x5F472529166c8897E6FfcC5Aa5258620c7bED338'
/**
 * 用户授权时签的平台费上限（成交额的 0.06%）。插件只替网页下 feeRate 不超过它的单；lib/aster.ts 从这里导出同一个值。
 * ⚠️ 调高要所有人重新授权（lib/aster.ts 的 FEE_REAUTH），而且要同时发新版插件，否则插件会拒掉费率更高的单
 */
export const BUILDER_FEE = '0.0006'

export type PerpWriteKind = 'order' | 'cancel' | 'leverage' | 'marginType'

/** 每种操作的固定路径和方法 */
export const PERP_WRITE_ROUTES: Record<PerpWriteKind, { method: 'POST' | 'DELETE'; path: string }> = {
  order: { method: 'POST', path: '/fapi/v3/order' },
  cancel: { method: 'DELETE', path: '/fapi/v3/order' },
  leverage: { method: 'POST', path: '/fapi/v3/leverage' },
  marginType: { method: 'POST', path: '/fapi/v3/marginType' },
}

/** 网页交给插件的一个动作：操作种类 + 交易所参数（不含 asterChain / user / signer / nonce，插件自己补） */
export interface PerpWriteAction { action: PerpWriteKind; params: Record<string, string> }

/** 核对之后的一个动作：路径、方法、规范化后的参数，另附插件判断「要不要弹窗」和显示用的几个字段 */
export interface PerpWriteOp {
  action: PerpWriteKind
  method: 'POST' | 'DELETE'
  path: string
  params: Record<string, string>
  symbol: string
  /** order：主单（市价 / 限价）还是止盈止损（触发后平掉整个仓位） */
  role?: 'main' | 'protect'
}

/** 一次最多几个动作：改杠杆 + 改保证金模式 + 主单 + 止盈 + 止损 */
export const PERP_WRITE_MAX_ACTIONS = 5

const SYMBOL = /^[A-Z0-9]{1,20}USDT$/
/** 十进制正数：最多 18 位整数、18 位小数，不许科学计数法、正负号、空格 */
const DECIMAL = /^\d{1,18}(\.\d{1,18})?$/
const INT = /^\d{1,20}$/

const bad = (why: string): never => { throw new Error(`perpWrite: ${why}`) }
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

/** 取出参数：一律要字符串（数字也接受，转成字符串），不在 allowed 里的一个都不许带 */
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
 * 核对并规范化一个写操作。通过返回固定路径、方法和按固定顺序排好的参数，不通过抛错。
 * 插件收到网页请求时、网页发出前都用它。
 *   order：symbol / side（BUY / SELL）/ type，另加 builder（必须是平台地址）和 feeRate（不超过 BUILDER_FEE）
 *     · MARKET：quantity，可带 reduceOnly=true
 *     · LIMIT：quantity + price + timeInForce=GTC，可带 reduceOnly=true
 *     · STOP_MARKET / TAKE_PROFIT_MARKET：只能是止盈止损（stopPrice + closePosition=true，触发后平掉整个仓位），不带数量
 *   cancel：symbol + orderId
 *   leverage：symbol + 1~125 的整数
 *   marginType：symbol + CROSSED / ISOLATED
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

  // 下单
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
    // 只收止盈止损：触发后市价平掉整个仓位。带数量的触发单（可以用来开新仓）不收
    if (has('quantity') || has('price') || has('timeInForce') || has('reduceOnly')) bad('protect')
    if (p.closePosition !== 'true') bad('closePosition')
    const stopPrice = positive(p.stopPrice, 'stopPrice')
    return { action: kind, ...route, symbol, role: 'protect', params: { symbol, side: p.side, type: p.type, stopPrice, closePosition: 'true', ...fee } }
  }
  return bad('type')
}

/**
 * 核对一批动作（一次用户操作）：1~5 个，全是同一个币；最多一个改杠杆、一个改保证金模式、一个主单、两个止盈止损；
 * 撤单只能单独一个；止盈止损的方向必须和主单相反。返回按执行顺序排好的动作：改杠杆 → 改保证金模式 → 主单 → 止盈止损。
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
 * 交易所的回复算不算成功：HTTP 2xx 且没有负数 code。
 * 改保证金模式时交易所回「No need to change margin type」（本来就是这个模式）也算成功。
 */
export function perpWriteOk(op: Pick<PerpWriteOp, 'action'>, status: number, body: unknown): boolean {
  const code = body && typeof body === 'object' && 'code' in body ? Number((body as { code: unknown }).code) : 0
  if (status >= 200 && status < 300 && !(code < 0)) return true
  const msg = body && typeof body === 'object' ? String((body as { msg?: unknown }).msg ?? '') : String(body ?? '')
  return op.action === 'marginType' && /No need to change/i.test(msg)
}

/** 插件交回网页的每个动作的结果：执行了就是交易所的 HTTP 状态码和回复；前面的动作失败了，后面的不执行（skipped） */
export type PerpWriteResult = { action: PerpWriteKind; status: number; body: unknown } | { action: PerpWriteKind; skipped: true }

// ---------- 网页快捷交易会话（登录时授权一次，之后网页下单不再逐笔弹窗） ----------

/** 会话最长多久（锁定钱包、断开网站、关浏览器都会提前结束）。2026-09-30 goat 定不设金额 / 杠杆 / 累计上限，会话只有有效期 */
export const PERP_SESSION_TTL_MS = 24 * 3600_000
