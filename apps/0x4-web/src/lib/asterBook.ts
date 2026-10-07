// 合约盘口、最新成交、合约头部实时数据（2026-09-29 网页版合约终端，goat：盘口 + 最新成交要用交易所的真实数据）。
// 全是交易所公开行情接口，不用签名、不碰账户：
//   · REST 快照：/fapi/v3/depth（前 20 档）、/fapi/v3/aggTrades（最近逐笔）、/fapi/v3/premiumIndex、/fapi/v3/ticker/24hr、/fapi/v3/openInterest
//   · websocket 合并流 wss://fstream.asterdex.com/stream：<sym>@depth20@500ms（每次推前 20 档整张快照，不用自己合并增量）、
//     <sym>@aggTrade（逐笔）、<sym>@markPrice@1s（标记价 / 指数价 / 资金费率 / 下次结算时间）、<sym>@ticker（24h 统计）
// 2026-09-29 实测：REST 都回 Access-Control-Allow-Origin: *，四个推送流都有数据。持仓量没有推送，页面每 15 秒拉一次。
import { HOST, symbolOf } from './aster'

export const STREAM_HOST = 'wss://fstream.asterdex.com'

export interface BookLevel { px: number; sz: number }
export interface OrderBook { bids: BookLevel[]; asks: BookLevel[]; at: number }
export interface TapeTrade { id: number; px: number; sz: number; /** 主动买（吃掉卖单）为 true */ isBuy: boolean; time: number }
/** 合约头部数据：每项拿不到就是 undefined，页面显示 --，不补假数 */
export interface PerpStats {
  last?: number; mark?: number; index?: number; funding?: number; nextFunding?: number
  open24h?: number; high24h?: number; low24h?: number; quoteVolume24h?: number; openInterest?: number
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : undefined }
const pos = (v: unknown) => { const n = num(v); return n !== undefined && n > 0 ? n : undefined }

function levels(rows: unknown): BookLevel[] {
  if (!Array.isArray(rows)) return []
  const out: BookLevel[] = []
  for (const r of rows) {
    if (!Array.isArray(r)) continue
    const px = pos(r[0]), sz = pos(r[1])
    if (px !== undefined && sz !== undefined) out.push({ px, sz })
  }
  return out
}

/** REST 快照（bids / asks）和推送（b / a）是同一种二维数组：买盘从高到低、卖盘从低到高 */
export function parseBook(d: { bids?: unknown; asks?: unknown; b?: unknown; a?: unknown; E?: unknown; T?: unknown }): OrderBook {
  return {
    bids: levels(d.bids ?? d.b).sort((x, y) => y.px - x.px),
    asks: levels(d.asks ?? d.a).sort((x, y) => x.px - y.px),
    at: num(d.T) ?? num(d.E) ?? Date.now(),
  }
}

/** 逐笔：m = true 表示买方是挂单方，也就是这笔是主动卖 */
export function parseAggTrade(x: { a?: unknown; p?: unknown; q?: unknown; T?: unknown; m?: unknown }): TapeTrade | null {
  const id = num(x.a), px = pos(x.p), sz = pos(x.q), time = num(x.T)
  if (id === undefined || px === undefined || sz === undefined || time === undefined) return null
  return { id, px, sz, time, isBuy: x.m === false }
}

/** 推送消息 → 盘口 / 一笔成交 / 头部数据的一部分；认不出的返回 null */
export function parseStream(raw: string): { book?: OrderBook; trade?: TapeTrade; stats?: PerpStats } | null {
  let m: { data?: Record<string, unknown> }
  try { m = JSON.parse(raw) } catch { return null }
  const d = m?.data
  if (!d || typeof d !== 'object') return null
  switch (d.e) {
    case 'depthUpdate': return { book: parseBook(d) }
    case 'aggTrade': { const trade = parseAggTrade(d); return trade ? { trade } : null }
    case 'markPriceUpdate': return { stats: { mark: pos(d.p), index: pos(d.i), funding: num(d.r), nextFunding: pos(d.T) } }
    case '24hrTicker': return { stats: { last: pos(d.c), open24h: pos(d.o), high24h: pos(d.h), low24h: pos(d.l), quoteVolume24h: num(d.q) } }
    default: return null
  }
}

async function getJson(path: string): Promise<unknown> {
  const r = await fetch(`${HOST}${path}`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function loadBook(coin: string, limit = 20): Promise<OrderBook> {
  return parseBook(await getJson(`/fapi/v3/depth?symbol=${symbolOf(coin)}&limit=${limit}`) as Record<string, unknown>)
}

/** 最近逐笔，新的在前 */
export async function loadTape(coin: string, limit = 50): Promise<TapeTrade[]> {
  const rows = await getJson(`/fapi/v3/aggTrades?symbol=${symbolOf(coin)}&limit=${limit}`)
  if (!Array.isArray(rows)) return []
  return rows.map((x) => parseAggTrade(x as Record<string, unknown>)).filter((x): x is TapeTrade => !!x).sort((a, b) => b.time - a.time || b.id - a.id)
}

/** 头部数据快照：标记价 / 资金费、24h 统计、持仓量（张数 × 标记价 = 美元）。哪一项失败就缺哪一项 */
export async function loadPerpStats(coin: string): Promise<PerpStats> {
  const sym = symbolOf(coin)
  const [pi, tk, oi] = await Promise.allSettled([
    getJson(`/fapi/v3/premiumIndex?symbol=${sym}`), getJson(`/fapi/v3/ticker/24hr?symbol=${sym}`), getJson(`/fapi/v3/openInterest?symbol=${sym}`),
  ])
  const p = pi.status === 'fulfilled' ? pi.value as Record<string, unknown> : {}
  const k = tk.status === 'fulfilled' ? tk.value as Record<string, unknown> : {}
  const o = oi.status === 'fulfilled' ? oi.value as Record<string, unknown> : {}
  const mark = pos(p.markPrice), oiCoins = pos(o.openInterest)
  if (pi.status === 'rejected' && tk.status === 'rejected') throw pi.reason
  return {
    mark, index: pos(p.indexPrice), funding: num(p.lastFundingRate), nextFunding: pos(p.nextFundingTime),
    last: pos(k.lastPrice), open24h: pos(k.openPrice), high24h: pos(k.highPrice), low24h: pos(k.lowPrice), quoteVolume24h: num(k.quoteVolume),
    openInterest: oiCoins !== undefined && mark !== undefined ? oiCoins * mark : undefined,
  }
}

/** 持仓量单独拉（没有推送）：美元 */
export async function loadOpenInterestUsd(coin: string, mark: number): Promise<number | undefined> {
  const o = await getJson(`/fapi/v3/openInterest?symbol=${symbolOf(coin)}`) as Record<string, unknown>
  const n = pos(o.openInterest)
  return n !== undefined && mark > 0 ? n * mark : undefined
}

export const streamUrl = (coin: string) => {
  const s = symbolOf(coin).toLowerCase()
  return `${STREAM_HOST}/stream?streams=${s}@depth20@500ms/${s}@aggTrade/${s}@markPrice@1s/${s}@ticker`
}

/** 逐笔合并进已有列表：按 id 去重，新的在前，最多留 max 笔 */
export function mergeTape(cur: TapeTrade[], add: TapeTrade[], max = 60): TapeTrade[] {
  if (!add.length) return cur
  const seen = new Map<number, TapeTrade>()
  for (const x of [...add, ...cur]) if (!seen.has(x.id)) seen.set(x.id, x)
  return [...seen.values()].sort((a, b) => b.time - a.time || b.id - a.id).slice(0, max)
}
