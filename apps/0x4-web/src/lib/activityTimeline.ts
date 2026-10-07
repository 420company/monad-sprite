// Activity-page timeline (2026-09-26): EVM (server /api/me/activity/evm), Solana, Bitcoin, and swap/bridge records merged into one reverse-chronological list.
// Pure logic only here (merging, grouping, Solana tx parsing) — no network, no store — for easy unit tests; data sources live in activitySources.ts.
//
// - Each source paginates independently, each in reverse-chronological order. Merging is k-way: only when every unfinished source has a buffered item is the front item guaranteed globally newest;
//   whichever source's buffer runs dry gets another page fetched. So "load more" never inserts old Bitcoin records ahead of not-yet-fetched new EVM ones.
// - One failing source doesn't sink the whole list: show the others, remember the failed source, and offer "some records failed to load, tap to retry" on the page.
// - One transaction may yield several entries (a swap = one out + one in); the list merges them into one row by "chain + hash" (groupTimeline).
import { BTC_CHAIN_ID, SOLANA_CHAIN_ID, chainById, sameAddr } from './chains'

export type Direction = 'in' | 'out' | 'self'
/** One leg of a transaction (a single send/receive entry) */
export interface TimelineEntry {
  id: string
  chainId: number
  hash: string
  /** Milliseconds; unconfirmed Bitcoin entries use the fetch time and sort first */
  time: number
  direction: Direction
  asset: { symbol: string; address: string; decimals: number; logo?: string }
  /** Decimal string; empty when the amount is unrecognized (unparsed Solana tx) */
  amount: string
  counterparty?: string
  status: 'success' | 'failed' | 'pending'
  source: 'evm' | 'sol' | 'btc' | 'bridge'
  /** Swap / bridge records (initiated in-app, saved locally) */
  bridge?: BridgeLike
}

/** Fields used by store/bridge's Transfer (store not imported directly — keeps this file pure logic) */
export interface BridgeLike {
  txHash: string; fromChain: number; toChain: number; fromSymbol: string; toSymbol: string; fromAmount: number; toAmount: number
  status: 'PENDING' | 'DONE' | 'FAILED'; createdAt: number; explorerLink?: string; receivingTxLink?: string
}

/** Tie-break for same-timestamp entries: BSC first (users' money is mostly on BSC), then other EVMs, Solana, Bitcoin */
const CHAIN_RANK = [56, 1, 8453, 42161, 137, 10]
export function chainRank(chainId: number): number {
  const i = CHAIN_RANK.indexOf(chainId)
  if (i >= 0) return i
  return chainId === SOLANA_CHAIN_ID ? 20 : chainId === BTC_CHAIN_ID ? 21 : 10
}

/** Negative when a sorts before b: newer first → chain order → hash → id (legs of one tx stay adjacent) */
export function compareEntries(a: TimelineEntry, b: TimelineEntry): number {
  if (a.time !== b.time) return b.time - a.time
  const r = chainRank(a.chainId) - chainRank(b.chainId)
  if (r) return r
  if (a.hash !== b.hash) return a.hash < b.hash ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// ── Merging ──
export interface SourcePage { items: TimelineEntry[]; next: string | null; unavailable?: number[] }
export interface TimelineSource { id: string; fetch: (cursor: string | null, signal: AbortSignal) => Promise<SourcePage> }
export interface MergedPage { items: TimelineEntry[]; done: boolean; failed: string[]; unavailable: number[] }

/** How many extra pages to chase when one source keeps returning empty (all filtered out) — guards against infinite loops */
const MAX_ROUNDS = 6

export function createMerger(sources: TimelineSource[], opts: { pageSize: number; skip?: (e: TimelineEntry) => boolean }) {
  interface S { src: TimelineSource; buf: TimelineEntry[]; next: string | null; started: boolean; done: boolean; failed: boolean }
  const st: S[] = sources.map((src) => ({ src, buf: [], next: null, started: false, done: false, failed: false }))
  const seen = new Set<string>()
  const unavailable = new Set<number>()
  const active = () => st.filter((s) => !s.failed)

  async function load(s: S, signal: AbortSignal) {
    try {
      const p = await s.src.fetch(s.started ? s.next : null, signal)
      s.started = true
      for (const u of p.unavailable || []) unavailable.add(u)
      const fresh = p.items.filter((e) => !opts.skip?.(e))
      s.buf.push(...fresh)
      s.buf.sort(compareEntries)
      s.next = p.next
      if (!p.next) s.done = true
    } catch (e) {
      if (signal.aborted) throw e
      s.failed = true
    }
  }

  /** Next page. Throws when all sources failed (and nothing was ever fetched), so the page can show "failed to load" */
  async function page(signal: AbortSignal): Promise<MergedPage> {
    const out: TimelineEntry[] = []
    for (let round = 0; round < MAX_ROUNDS && out.length < opts.pageSize; round++) {
      const need = active().filter((s) => !s.buf.length && !s.done)
      if (need.length) await Promise.all(need.map((s) => load(s, signal)))
      if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      while (out.length < opts.pageSize) {
        const live = active()
        if (live.some((s) => !s.buf.length && !s.done)) break
        let best: S | null = null
        for (const s of live) if (s.buf.length && (!best || compareEntries(s.buf[0], best.buf[0]) < 0)) best = s
        if (!best) break
        const e = best.buf.shift()!
        if (seen.has(e.id)) continue
        seen.add(e.id); out.push(e)
      }
      if (active().every((s) => s.done && !s.buf.length)) break
    }
    const failed = st.filter((s) => s.failed).map((s) => s.src.id)
    if (st.length && failed.length === st.length && !seen.size) throw new Error('all sources failed')
    const done = active().every((s) => s.done && !s.buf.length)
    return { items: out, done, failed, unavailable: [...unavailable] }
  }
  return { page }
}

// ── Grouping into one row ──
export type RowKind = 'receive' | 'send' | 'self' | 'swap' | 'bridge' | 'other'
export interface Leg { symbol: string; amount: string; address: string; chainId: number }
export interface TimelineRow {
  key: string
  chainId: number
  hash: string
  time: number
  kind: RowKind
  status: 'success' | 'failed' | 'pending'
  /** The leg paid out (send / swap out) */
  out?: Leg
  /** The leg received (receive / swap in) */
  in?: Leg
  counterparty?: string
  /** Other legs in the same tx (e.g. an airdrop paying several coins at once) */
  more: number
  bridge?: BridgeLike
}

/**
 * Scam tokens: symbols impersonating the chain's native coin or common coins (USDT / USDC…) with the wrong
 * contract address. BSC / Polygon get "address poisoning" drops of these daily; showing "received 1000 USDT"
 * in the list would mislead, so they're hidden outright. Only the receive direction is checked (my own
 * sends can't be planted on me).
 */
export function isSpoofToken(e: TimelineEntry): boolean {
  if (e.direction !== 'in' || e.source !== 'evm') return false
  const c = chainById(e.chainId)
  if (!c) return false
  const sym = e.asset.symbol.trim().toUpperCase()
  const addr = e.asset.address
  if (sym === c.native.symbol.toUpperCase()) return !sameAddr(addr, c.native.address)
  const known = c.tokens.filter((tk) => tk.symbol.toUpperCase() === sym)
  return known.length > 0 && !known.some((tk) => sameAddr(tk.address, addr))
}

const legOf = (e: TimelineEntry): Leg => ({ symbol: e.asset.symbol, amount: e.amount, address: e.asset.address, chainId: e.chainId })
const big = (e: TimelineEntry) => Number(e.amount) || 0

/** Merge legs into one row by "chain + hash", keeping reverse-chronological order */
export function groupTimeline(entries: TimelineEntry[]): TimelineRow[] {
  const sorted = entries.filter((e) => !isSpoofToken(e)).sort(compareEntries)
  const groups = new Map<string, TimelineEntry[]>()
  for (const e of sorted) {
    const k = `${e.chainId}:${e.hash.toLowerCase()}`
    const g = groups.get(k)
    if (g) g.push(e); else groups.set(k, [e])
  }
  const rows: TimelineRow[] = []
  for (const [key, g] of groups) {
    const head = g[0]
    const status = g.some((e) => e.status === 'pending') ? 'pending' : g.some((e) => e.status === 'failed') ? 'failed' : 'success'
    const base = { key, chainId: head.chainId, hash: head.hash, time: Math.max(...g.map((e) => e.time)), status } as const
    if (head.bridge) {
      rows.push({ ...base, kind: head.bridge.fromChain === head.bridge.toChain ? 'swap' : 'bridge', more: 0, bridge: head.bridge,
        status: head.bridge.status === 'PENDING' ? 'pending' : head.bridge.status === 'FAILED' ? 'failed' : 'success' })
      continue
    }
    const legs = g.filter((e) => e.amount)
    if (!legs.length) { rows.push({ ...base, kind: 'other', more: 0 }); continue }
    const outs = legs.filter((e) => e.direction === 'out').sort((a, b) => big(b) - big(a))
    const ins = legs.filter((e) => e.direction === 'in').sort((a, b) => big(b) - big(a))
    const selfs = legs.filter((e) => e.direction === 'self')
    // Swap: paid one kind, got another, in the same tx
    const swapOut = outs[0], swapIn = ins.find((e) => !swapOut || e.asset.symbol !== swapOut.asset.symbol || !sameAddr(e.asset.address, swapOut.asset.address))
    if (swapOut && swapIn) {
      rows.push({ ...base, kind: 'swap', out: legOf(swapOut), in: legOf(swapIn), more: legs.length - 2 })
    } else if (ins.length && !outs.length) {
      rows.push({ ...base, kind: 'receive', in: legOf(ins[0]), counterparty: ins[0].counterparty, more: ins.length - 1 })
    } else if (outs.length) {
      rows.push({ ...base, kind: 'send', out: legOf(outs[0]), counterparty: outs[0].counterparty, more: outs.length - 1 })
    } else {
      rows.push({ ...base, kind: 'self', out: legOf(selfs[0]), counterparty: selfs[0].counterparty, more: selfs.length - 1 })
    }
  }
  return rows.sort((a, b) => b.time - a.time || chainRank(a.chainId) - chainRank(b.chainId))
}

// ── Solana tx parsing ──
/** The used subset of getParsedTransaction results (structurally compatible with @solana/web3.js's ParsedTransactionWithMeta) */
export interface SolParsedTx {
  meta: {
    err: unknown; fee: number; preBalances: number[]; postBalances: number[]
    preTokenBalances?: SolTokenBalance[] | null; postTokenBalances?: SolTokenBalance[] | null
    innerInstructions?: { instructions: SolIx[] }[] | null
  } | null
  transaction: { message: { accountKeys: { pubkey: { toString(): string } | string }[]; instructions: SolIx[] } }
}
interface SolTokenBalance { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number } }
interface SolIx { program?: string; parsed?: { type?: string; info?: Record<string, unknown> } | string }

export const SOL_NATIVE = '11111111111111111111111111111111'
/** SOL moves below this many lamports count as dust (account rent, priority fees, etc.) */
const SOL_DUST = 10_000n
/** When tokens moved too, a SOL move under this (0.003 SOL) is treated as token-account rent, not listed separately */
const RENT_LIKE = 3_000_000n

function units(raw: bigint, decimals: number): string {
  const neg = raw < 0n, abs = neg ? -raw : raw
  const s = abs.toString().padStart(decimals + 1, '0')
  const int = s.slice(0, s.length - decimals) || '0'
  const frac = decimals ? s.slice(s.length - decimals).replace(/0+$/, '') : ''
  return `${int}${frac ? `.${frac}` : ''}`
}

/**
 * One Solana transaction from the owner's perspective: net SOL and token changes → send/receive legs.
 * Unrecognized (no balance change, failed tx) returns an empty-amount "Solana transaction".
 * Fees paid by the owner aren't counted in the "sent" amount.
 */
export function parseSolanaTx(sig: string, blockTime: number | null | undefined, tx: SolParsedTx | null, owner: string, symbolOf: (mint: string) => string): TimelineEntry[] {
  const time = (blockTime || 0) * 1000
  const base = { chainId: SOLANA_CHAIN_ID, hash: sig, time, source: 'sol' as const }
  const other: TimelineEntry = { ...base, id: `sol:${sig}`, direction: 'self', asset: { symbol: 'SOL', address: SOL_NATIVE, decimals: 9 }, amount: '', status: tx?.meta?.err ? 'failed' : 'success' }
  if (!tx?.meta) return [{ ...other, status: 'success' }]
  if (tx.meta.err) return [{ ...other, status: 'failed' }]
  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k.pubkey === 'string' ? k.pubkey : k.pubkey.toString()))
  const idx = keys.indexOf(owner)
  const legs: { mint: string; decimals: number; delta: bigint }[] = []
  // Tokens: one mint may own several accounts; aggregate by mint
  const tok = new Map<string, { decimals: number; delta: bigint }>()
  for (const [list, sign] of [[tx.meta.preTokenBalances, -1n], [tx.meta.postTokenBalances, 1n]] as const) {
    for (const b of list || []) {
      if (b.owner !== owner) continue
      const cur = tok.get(b.mint) || { decimals: b.uiTokenAmount.decimals, delta: 0n }
      cur.delta += sign * BigInt(b.uiTokenAmount.amount || '0')
      tok.set(b.mint, cur)
    }
  }
  for (const [mint, v] of tok) if (v.delta !== 0n) legs.push({ mint, ...v })
  if (idx >= 0) {
    let d = BigInt(tx.meta.postBalances[idx] ?? 0) - BigInt(tx.meta.preBalances[idx] ?? 0)
    if (idx === 0) d += BigInt(tx.meta.fee || 0) // Fees don't count as "sent"
    const abs = d < 0n ? -d : d
    if (abs > SOL_DUST && !(legs.length && abs < RENT_LIKE)) legs.push({ mint: SOL_NATIVE, decimals: 9, delta: d })
  }
  if (!legs.length) return [other]
  const cp = counterpartyOf(tx, owner)
  return legs.map((l) => ({
    ...base, id: `sol:${sig}:${l.mint}`, direction: l.delta > 0n ? 'in' as const : 'out' as const,
    asset: { symbol: l.mint === SOL_NATIVE ? 'SOL' : symbolOf(l.mint), address: l.mint, decimals: l.decimals },
    amount: units(l.delta < 0n ? -l.delta : l.delta, l.decimals), counterparty: cp, status: 'success' as const,
  }))
}

/** Counterparty address: in system/token transfer instructions, the side opposite the owner (token accounts resolved to their owners); undefined when not found */
function counterpartyOf(tx: SolParsedTx, owner: string): string | undefined {
  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k.pubkey === 'string' ? k.pubkey : k.pubkey.toString()))
  const ownerOfAcct = new Map<string, string>()
  for (const b of [...(tx.meta?.preTokenBalances || []), ...(tx.meta?.postTokenBalances || [])]) if (b.owner && keys[b.accountIndex]) ownerOfAcct.set(keys[b.accountIndex], b.owner)
  const ixs = [...tx.transaction.message.instructions, ...(tx.meta?.innerInstructions || []).flatMap((i) => i.instructions)]
  for (const ix of ixs) {
    if (typeof ix.parsed !== 'object' || !ix.parsed) continue
    const type = ix.parsed.type, info = ix.parsed.info || {}
    if (ix.program === 'system' && type === 'transfer') {
      if (info.source === owner && typeof info.destination === 'string') return info.destination
      if (info.destination === owner && typeof info.source === 'string') return info.source
    }
    if ((ix.program === 'spl-token' || ix.program === 'spl-token-2022') && (type === 'transfer' || type === 'transferChecked')) {
      const src = String(info.source || ''), dst = String(info.destination || ''), auth = String(info.authority || info.multisigAuthority || '')
      if (auth === owner || ownerOfAcct.get(src) === owner) { const o = ownerOfAcct.get(dst); if (o && o !== owner) return o }
      if (ownerOfAcct.get(dst) === owner) { const o = ownerOfAcct.get(src) || auth; if (o && o !== owner) return o }
    }
  }
  return undefined
}
