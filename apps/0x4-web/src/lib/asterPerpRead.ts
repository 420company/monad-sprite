// 网页版合约的「只读查询」由 0x4 浏览器插件代办（2026-09-29 安全审查后改）。
//
// 以前的做法：网页把「查账户」这类请求的代理签名交给插件，插件看参数里只有 asterChain / user / signer / nonce / limit
// 就当只读、不弹窗签，签名交回网页，网页自己去请求交易所。问题：交易所的签名只覆盖参数、不含请求路径和方法，
// 不带业务参数的写接口（按 nonce 撤掉排队请求的 noop、联合保证金模式下强制兑换资产的 assetExchange 等）
// 需要的签名和「查账户」一字不差，网页拿到这种签名就能去调写接口，插件又不限次数、nonce 随网页填。
//
// 现在的做法：签名不离开插件。网页只说「查哪一项」（下面白名单里的四个固定 GET 接口）和少数白名单参数，
// 插件自己生成 nonce、自己签、自己向交易所发 GET，只把结果 JSON 交回网页。
// 插件（extension/src/background/ox4.ts 的 perpRead）和网页（lib/aster.ts 的 call）用同一份白名单，规则只有这一份。
// 手机 App 不走这里（原生金库照旧由 App 自己签只读请求）。

/** 交易所接口地址（和 lib/aster.ts 的 HOST 同一个；插件的 manifest 里给了这个域名的访问权限） */
export const ASTER_HOST = 'https://fapi.asterdex.com'
/** 合约交易代理签名用的 EIP-712 域（lib/aster.ts DOMAIN_AGENT） */
export const ASTER_AGENT_DOMAIN = { name: 'AsterSignTransaction', version: '1', chainId: 1666, verifyingContract: '0x0000000000000000000000000000000000000000' } as const
export const ASTER_AGENT_TYPES = { Message: [{ name: 'msg', type: 'string' }] } as const

/** 允许插件代办的只读接口：名字 → 固定路径（一律 GET）。网页版合约页实际用到的就这四个 */
export const PERP_READ_PATHS = {
  account: '/fapi/v3/account',
  openOrders: '/fapi/v3/openOrders',
  userTrades: '/fapi/v3/userTrades',
  leverageBracket: '/fapi/v3/leverageBracket',
} as const
export type PerpReadEndpoint = keyof typeof PERP_READ_PATHS

/** 每个接口允许带的参数（值一律按十进制正整数校验）。没列出的参数一个都不许带 */
const PARAM_RULES: Record<PerpReadEndpoint, Record<string, { min: number; max: number }>> = {
  account: {},
  openOrders: {},
  userTrades: { limit: { min: 1, max: 1000 } },   // 成交记录条数（交易所上限 1000）
  leverageBracket: {},
}

const isEndpoint = (x: unknown): x is PerpReadEndpoint => typeof x === 'string' && Object.prototype.hasOwnProperty.call(PERP_READ_PATHS, x)

/** 网页侧：路径 → 接口名；不在白名单里返回 null */
export function perpReadEndpointOf(path: string): PerpReadEndpoint | null {
  for (const k of Object.keys(PERP_READ_PATHS) as PerpReadEndpoint[]) if (PERP_READ_PATHS[k] === path) return k
  return null
}

/**
 * 校验并规范化一次只读查询：接口必须在白名单里，参数只能是该接口允许的、值是范围内的整数。
 * 通过返回固定路径和规范化后的参数（字符串），不通过抛错。插件收到网页请求时、网页发出前都用它。
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
