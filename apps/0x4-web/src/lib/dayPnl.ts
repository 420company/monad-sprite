// 今日盈亏的账本（2026-09-29 goat：「总资产这里看起来太空了，能不能做一个 binance 那样的功能，有总余额的今日盈亏显示」
//                       「总盈亏里面充值进来的钱不要算到盈利和亏损里面，这个你要好好设计」）。
//
// 只算价格涨跌。做法：每次首页刷新余额，拿「这一次」和「上一次」比：
//   · 两次都持有的那部分数量 × 价格变化 = 盈亏（min(上次数量, 这次数量) × (这次价格 − 上次价格)）；
//   · 数量变多 = 转入（充值、别人转来、空投、打赏、兑换 / 跨链换进来），按这次的价格记进「转入」，之后的涨跌才算；
//   · 数量变少 = 转出（提现、转给别人、兑换 / 跨链换出去、付燃料费），按这次的价格记进「转出」，转出之前那段涨跌已经算过了。
// 所以资金进出和资产换形态都不会变成盈亏；兑换的手续费和滑点（换出去的价值 − 换进来的价值）也落在转入转出里，不算成亏损。
// App 拿不到每一笔的链上记录，所以不看交易记录，统一按数量变化判断；两次刷新之间既买又卖同一个币，中间那段涨跌不计。
//
// 0 点起点：数量用前一天最后一次读到的；价格用服务器 0 点记的（和首页同一个来源）。
//   服务器没记到价格的币、这台设备第一次打开（没有前一天的数量），这些币从今天第一次读到时起算，面板里注明。
// 稳定币价格按 1 算，免得几厘钱的报价抖动显示成盈亏。
// 百分比分母 = 0 点资产 + 当天净转入（按转入时的价值，净转出不减），分母不到 1 美元不显示百分比。

const DAY_MS = 86400_000
const TZ = 8 * 3600_000
/** 北京时间当天 0 点（毫秒） */
export const startOfDayCst = (now: number) => Math.floor((now + TZ) / DAY_MS) * DAY_MS - TZ
/** 分母小于这个数（美元）不显示百分比，免得几毛钱的账户显示成 +5000% */
export const MIN_BASE = 1

/** 这一次读到的一项资产。key = 链 id:代币地址（EVM 小写）；p ≤ 0 表示这次没有价格 */
export interface Obs { key: string; q: number; p: number; stable?: boolean }
export interface Entry { q: number; p: number; s?: 1 }
export interface Ledger {
  v: 1
  day: number
  /** 今天的价格涨跌盈亏（美元） */
  pnl: number
  /** 0 点资产（美元）；从今天首次读取起算的币按首次读到时的价值计 */
  base: number
  /** 今天转入 / 转出的价值（按发生那次刷新的价格） */
  inflow: number
  outflow: number
  /** 从今天首次读取时起算的币 */
  partial: string[]
  /** 0 点就持有、但还不知道起点价格的币（等第一次读到价格） */
  pending: Record<string, number>
  last: Record<string, Entry>
  t: number
}

export interface ObserveInput {
  now: number
  assets: Obs[]
  /** 这个币所在的链这次读成功了没有：读成功了而列表里没有 = 数量为 0；没读成功 = 这次不算它 */
  fresh: (key: string) => boolean
  /** 服务器记的 0 点价（换日那次用） */
  open?: Record<string, number> | null
}

/** 换日：用前一天最后读到的数量当 0 点数量，0 点价有就用，没有就等第一次读到 */
function startDay(prev: Ledger | null, day: number, now: number, open?: Record<string, number> | null): Ledger {
  const L: Ledger = { v: 1, day, pnl: 0, base: 0, inflow: 0, outflow: 0, partial: [], pending: {}, last: {}, t: now }
  if (!prev) return L
  for (const [k, e] of Object.entries(prev.last)) {
    if (!(e.q > 0)) continue
    const p0 = e.s ? 1 : open?.[k]
    if (p0 && p0 > 0) { L.base += e.q * p0; L.last[k] = { q: e.q, p: p0, ...(e.s ? { s: 1 as const } : {}) } }
    else L.pending[k] = e.q
  }
  // 前一天还没等到价格的，照样带过来
  for (const [k, q] of Object.entries(prev.pending)) if (!(k in L.last) && q > 0) {
    const p0 = open?.[k]
    if (p0 && p0 > 0) { L.base += q * p0; L.last[k] = { q, p: p0 } } else L.pending[k] = q
  }
  return L
}

/** 记一次读数，返回新账本（不改原来的） */
export function observe(prev: Ledger | null, inp: ObserveInput): Ledger {
  const day = startOfDayCst(inp.now)
  const first = !prev
  const L: Ledger = !prev || prev.day !== day
    ? startDay(prev, day, inp.now, inp.open)
    : { ...prev, partial: [...prev.partial], pending: { ...prev.pending }, last: { ...prev.last } }
  const seen = new Map(inp.assets.map((a) => [a.key, a]))
  const keys = new Set([...Object.keys(L.last), ...Object.keys(L.pending), ...seen.keys()])
  for (const key of keys) {
    const a = seen.get(key)
    if (a && !(a.p > 0)) continue // 这次没价格：不算，等下次
    if (!a && !inp.fresh(key)) continue // 这条链这次没读到：不算
    const q = a ? Math.max(0, a.q) : 0
    const p = a ? (a.stable ? 1 : a.p) : 0
    const s = a?.stable ? { s: 1 as const } : {}
    // 这台设备第一次打开：现有的都当 0 点就有，从现在起算
    if (first) { if (q > 0) { L.base += q * p; L.last[key] = { q, p, ...s }; L.partial.push(key) } continue }
    // 0 点就有但当时没价格：第一次读到价格时补进 0 点资产，从这里起算
    if (key in L.pending) {
      const q0 = L.pending[key]
      delete L.pending[key]
      if (!a) continue // 没等到价格就已经转走了：估不了价，不算
      L.base += q0 * p
      L.partial.push(key)
      L.last[key] = { q: q0, p, ...s }
    }
    const e = L.last[key]
    if (!e || !(e.q > 0)) {
      // 今天新出现的币：整笔算转入，之后的涨跌才算盈亏
      if (q > 0) { L.inflow += q * p; L.last[key] = { q, p, ...s } }
      continue
    }
    if (!a) {
      // 全部转走 / 卖光：按上次的价格记转出（这次列表里没有它，拿不到新价格）
      L.outflow += e.q * e.p
      L.last[key] = { q: 0, p: e.p, ...s }
      continue
    }
    L.pnl += Math.min(e.q, q) * (p - e.p)
    if (q > e.q) L.inflow += (q - e.q) * p
    else if (q < e.q) L.outflow += (e.q - q) * p
    L.last[key] = { q, p, ...s }
  }
  L.t = inp.now
  return L
}

/** 服务器给的合约部分（读不到就是 null） */
export interface PerpPart { pnl: number; base: number; netIn: number; equity: number; since: number }
export interface DaySummary {
  pnl: number
  /** null = 不显示百分比 */
  pct: number | null
  spot: { pnl: number; partial: number } | null
  perp: (PerpPart & { late: boolean }) | null
}

/** 合约起点比 0 点晚这么久以上，面板注明「合约从今天首次读取时起算」 */
const LATE_MS = 15 * 60_000

/** 合起来：现货 + 合约的金额、百分比、分项 */
export function summarize(L: Ledger | null, perp: PerpPart | null, now: number): DaySummary | null {
  const day = startOfDayCst(now)
  const spot = L && L.day === day ? L : null
  const p = perp && startOfDayCst(perp.since) === day ? perp : null
  if (!spot && !p) return null
  const pnl = (spot?.pnl || 0) + (p?.pnl || 0)
  const netIn = (spot ? spot.inflow - spot.outflow : 0) + (p?.netIn || 0)
  const denom = (spot?.base || 0) + (p?.base || 0) + Math.max(0, netIn)
  return {
    pnl,
    pct: denom >= MIN_BASE ? (pnl / denom) * 100 : null,
    spot: spot ? { pnl: spot.pnl, partial: spot.partial.length } : null,
    perp: p ? { ...p, late: p.since - day > LATE_MS } : null,
  }
}

/** 正 / 负 / 零（不到半分钱算零，显示中性色） */
export const pnlSign = (v: number): 1 | -1 | 0 => (v >= 0.005 ? 1 : v <= -0.005 ? -1 : 0)
