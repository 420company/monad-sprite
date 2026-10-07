// Perp order book, recent trades, and live header data (2026-09-29 web perp terminal; goat: book + recent trades must use the exchange's real data).
// All from the exchange's public market endpoints — no signing, no account access:
//   · REST snapshots: /fapi/v3/depth (top 20 levels), /fapi/v3/aggTrades (recent trades), /fapi/v3/premiumIndex, /fapi/v3/ticker/24hr, /fapi/v3/openInterest
//   · websocket combined stream wss://fstream.asterdex.com/stream: <sym>@depth20@500ms (pushes the full top-20 snapshot each time — no manual delta merging),
//     <sym>@aggTrade (trades), <sym>@markPrice@1s (mark / index price, funding rate, next funding time), <sym>@ticker (24h stats)
// Tested 2026-09-29: all REST endpoints return Access-Control-Allow-Origin: *, all four streams have data. Open interest has no stream — the page pulls it every 15s.
import { HOST, symbolOf } from './aster'

export const STREAM_HOST = 'wss://fstream.asterdex.com'

export interface BookLevel { px: number; sz: number }
export interface OrderBook { bids: BookLevel[]; asks: BookLevel[]; at: number }
export interface TapeTrade { id: number; px: number; sz: number; /** true for active buys (taking ask orders) */ isBuy: boolean; time: number }
/** Perp header data: anything unavailable stays undefined, the page shows -- — never backfill fake numbers */
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

/** REST snapshots (bids / asks) and stream pushes (b / a) share the same 2D array shape: bids high-to-low, asks low-to-high */
export function parseBook(d: { bids?: unknown; asks?: unknown; b?: unknown; a?: unknown; E?: unknown; T?: unknown }): OrderBook {
  return {
    bids: levels(d.bids ?? d.b).sort((x, y) => y.px - x.px),
    asks: levels(d.asks ?? d.a).sort((x, y) => x.px - y.px),
    at: num(d.T) ?? num(d.E) ?? Date.now(),
  }
}

/** Trades: m = true means the buyer was the maker, i.e. this trade was an active sell */
export function parseAggTrade(x: { a?: unknown; p?: unknown; q?: unknown; T?: unknown; m?: unknown }): TapeTrade | null {
  const id = num(x.a), px = pos(x.p), sz = pos(x.q), time = num(x.T)
  if (id === undefined || px === undefined || sz === undefined || time === undefined) return null
  return { id, px, sz, time, isBuy: x.m === false }
}

/** Stream message → book / one trade / part of the header data; null for unrecognized */
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

/** Recent trades, newest first */
export async function loadTape(coin: string, limit = 50): Promise<TapeTrade[]> {
  const rows = await getJson(`/fapi/v3/aggTrades?symbol=${symbolOf(coin)}&limit=${limit}`)
  if (!Array.isArray(rows)) return []
  return rows.map((x) => parseAggTrade(x as Record<string, unknown>)).filter((x): x is TapeTrade => !!x).sort((a, b) => b.time - a.time || b.id - a.id)
}

/** Header data snapshot: mark price / funding, 24h stats, open interest (contracts × mark price = USD). Failed items are simply missing */
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

/** Open interest pulled separately (no stream): USD */
export async function loadOpenInterestUsd(coin: string, mark: number): Promise<number | undefined> {
  const o = await getJson(`/fapi/v3/openInterest?symbol=${symbolOf(coin)}`) as Record<string, unknown>
  const n = pos(o.openInterest)
  return n !== undefined && mark > 0 ? n * mark : undefined
}

export const streamUrl = (coin: string) => {
  const s = symbolOf(coin).toLowerCase()
  return `${STREAM_HOST}/stream?streams=${s}@depth20@500ms/${s}@aggTrade/${s}@markPrice@1s/${s}@ticker`
}

/** Merge trades into the existing list: dedupe by id, newest first, keep at most max */
export function mergeTape(cur: TapeTrade[], add: TapeTrade[], max = 60): TapeTrade[] {
  if (!add.length) return cur
  const seen = new Map<number, TapeTrade>()
  for (const x of [...add, ...cur]) if (!seen.has(x.id)) seen.set(x.id, x)
  return [...seen.values()].sort((a, b) => b.time - a.time || b.id - a.id).slice(0, max)
}
