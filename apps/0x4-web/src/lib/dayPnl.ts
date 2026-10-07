// Today's PnL ledger (2026-09-29 goat: "total assets looks too empty here — can we do a Binance-style thing showing today's PnL on the total balance"
// "money deposited in shouldn't count as profit or loss in total PnL — design this carefully").
//
// Only price moves count. Method: each time home refreshes balances, compare "this read" with "last read":
//   - qty held in both reads × price change = PnL (min(lastQty, thisQty) × (thisPrice − lastPrice));
//   - qty up = inflow (deposit, transfers in, airdrops, tips, swap/bridge in), booked as "inflow" at this read's price — only later moves count;
//   - qty down = outflow (withdrawal, transfers out, swap/bridge out, gas), booked as "outflow" at this read's price — moves before the outflow already counted;
// So fund flows and asset-shape changes never become PnL; swap fees and slippage (value out − value in) also land in inflow/outflow, not as losses.
// The app can't see every on-chain record, so it ignores tx history and judges purely by qty changes; buy-then-sell of the same coin between two refreshes doesn't count the middle move.
//
// Midnight baseline: qty from the last read of the previous day; prices from the server's midnight snapshot (same source as home).
//   Coins with no server midnight price, or this device's first open (no prior-day qty): counted from today's first read, noted in the panel.
// Stablecoins priced at 1, so cent-level quote jitter doesn't show as PnL.
// Percent denominator = midnight assets + same-day net inflows (valued at inflow time; net outflows don't reduce it); no percent shown when the denominator is under $1.

const DAY_MS = 86400_000
const TZ = 8 * 3600_000
/** Start of today in Beijing time (ms) */
export const startOfDayCst = (now: number) => Math.floor((now + TZ) / DAY_MS) * DAY_MS - TZ
/** Below this denominator (USD), hide the percent — keeps penny accounts from showing +5000% */
export const MIN_BASE = 1

/** One asset from this read. key = chainId:tokenAddress (EVM lowercased); p ≤ 0 means no price this read */
export interface Obs { key: string; q: number; p: number; stable?: boolean }
export interface Entry { q: number; p: number; s?: 1 }
export interface Ledger {
  v: 1
  day: number
  /** Today's price-move PnL (USD) */
  pnl: number
  /** Midnight assets (USD); coins counted from today's first read use their first-read value */
  base: number
  /** Today's inflow / outflow value (priced at the refresh when it happened) */
  inflow: number
  outflow: number
  /** Coins counted from today's first read */
  partial: string[]
  /** Coins held at midnight whose baseline price is still unknown (waiting for the first priced read) */
  pending: Record<string, number>
  last: Record<string, Entry>
  t: number
}

export interface ObserveInput {
  now: number
  assets: Obs[]
  /** Whether this coin's chain read succeeded this time: success but absent from the list = qty 0; failed read = skip it this round */
  fresh: (key: string) => boolean
  /** Server's midnight price (used at day rollover) */
  open?: Record<string, number> | null
}

/** Day rollover: previous day's last-read qty becomes the midnight qty; use the midnight price when available, otherwise wait for the first priced read */
function startDay(prev: Ledger | null, day: number, now: number, open?: Record<string, number> | null): Ledger {
  const L: Ledger = { v: 1, day, pnl: 0, base: 0, inflow: 0, outflow: 0, partial: [], pending: {}, last: {}, t: now }
  if (!prev) return L
  for (const [k, e] of Object.entries(prev.last)) {
    if (!(e.q > 0)) continue
    const p0 = e.s ? 1 : open?.[k]
    if (p0 && p0 > 0) { L.base += e.q * p0; L.last[k] = { q: e.q, p: p0, ...(e.s ? { s: 1 as const } : {}) } }
    else L.pending[k] = e.q
  }
  // Coins still awaiting a price from the previous day carry over anyway
  for (const [k, q] of Object.entries(prev.pending)) if (!(k in L.last) && q > 0) {
    const p0 = open?.[k]
    if (p0 && p0 > 0) { L.base += q * p0; L.last[k] = { q, p: p0 } } else L.pending[k] = q
  }
  return L
}

/** Record one read; returns a new ledger (the old one untouched) */
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
    if (a && !(a.p > 0)) continue // No price this read: skip, wait for the next
    if (!a && !inp.fresh(key)) continue // This chain unread this round: skip
    const q = a ? Math.max(0, a.q) : 0
    const p = a ? (a.stable ? 1 : a.p) : 0
    const s = a?.stable ? { s: 1 as const } : {}
    // This device's first open: treat current holdings as held since midnight, count from now
    if (first) { if (q > 0) { L.base += q * p; L.last[key] = { q, p, ...s }; L.partial.push(key) } continue }
    // Held at midnight but unpriced then: backfill into midnight assets at the first priced read, count from there
    if (key in L.pending) {
      const q0 = L.pending[key]
      delete L.pending[key]
      if (!a) continue // Moved out before any price arrived: can't value it, skip
      L.base += q0 * p
      L.partial.push(key)
      L.last[key] = { q: q0, p, ...s }
    }
    const e = L.last[key]
    if (!e || !(e.q > 0)) {
      // Coins newly appearing today: the whole lot counts as inflow; only later moves are PnL
      if (q > 0) { L.inflow += q * p; L.last[key] = { q, p, ...s } }
      continue
    }
    if (!a) {
      // Fully moved out / sold: book the outflow at the last price (it's absent from this read, so no fresh price)
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

/** Perp portion from the server (null when unreadable) */
export interface PerpPart { pnl: number; base: number; netIn: number; equity: number; since: number }
export interface DaySummary {
  pnl: number
  /** null = hide the percent */
  pct: number | null
  spot: { pnl: number; partial: number } | null
  perp: (PerpPart & { late: boolean }) | null
}

/** When the perp baseline lags midnight by this long or more, the panel notes "perps counted from today's first read" */
const LATE_MS = 15 * 60_000

/** Combined: spot + perp amounts, percent, and breakdown */
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

/** Positive / negative / zero (under half a cent counts as zero, shown in neutral color) */
export const pnlSign = (v: number): 1 | -1 | 0 => (v >= 0.005 ? 1 : v <= -0.005 ? -1 : 0)
