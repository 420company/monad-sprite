// 活动页时间线（2026-09-26）：EVM（服务端 /api/me/activity/evm）、Solana、比特币、闪兑 / 跨链记录合成一条按时间倒序的列表。
// 这个文件只放纯逻辑（归并、分组、Solana 交易解析），不碰网络和 store，方便单测；数据源在 activitySources.ts。
//
// · 每个数据源各自分页、各自按时间倒序。合并用 k 路归并：只有每个还没读完的源都有缓冲时，最前面那条才一定是全局最新，
//   哪个源的缓冲空了就再拉它一页。这样「加载更多」时老的比特币记录不会插到还没拉到的新 EVM 记录前面。
// · 某个源失败不拖垮整个列表：先显示其它源的，记下失败的源，页面上给「部分记录读取失败，点击重试」。
// · 一笔交易可能有好几条（兑换 = 一出一进），列表显示时按「链 + 哈希」合成一行（groupTimeline）。
import { BTC_CHAIN_ID, SOLANA_CHAIN_ID, chainById, sameAddr } from './chains'

export type Direction = 'in' | 'out' | 'self'
/** 一条收发（一笔交易里的一条腿） */
export interface TimelineEntry {
  id: string
  chainId: number
  hash: string
  /** 毫秒；比特币未确认的记成拉取时刻，排在最前 */
  time: number
  direction: Direction
  asset: { symbol: string; address: string; decimals: number; logo?: string }
  /** 十进制字符串；认不出金额的（没解析的 Solana 交易）是空串 */
  amount: string
  counterparty?: string
  status: 'success' | 'failed' | 'pending'
  source: 'evm' | 'sol' | 'btc' | 'bridge'
  /** 闪兑 / 跨链记录（App 里自己发起的，本机保存） */
  bridge?: BridgeLike
}

/** store/bridge 的 Transfer 里用得到的字段（不直接引 store，保持这里是纯逻辑） */
export interface BridgeLike {
  txHash: string; fromChain: number; toChain: number; fromSymbol: string; toSymbol: string; fromAmount: number; toAmount: number
  status: 'PENDING' | 'DONE' | 'FAILED'; createdAt: number; explorerLink?: string; receivingTxLink?: string
}

/** 同一时刻多条记录的先后：BSC 最前（用户的钱主要在 BSC），然后其它 EVM、Solana、比特币 */
const CHAIN_RANK = [56, 1, 8453, 42161, 137, 10]
export function chainRank(chainId: number): number {
  const i = CHAIN_RANK.indexOf(chainId)
  if (i >= 0) return i
  return chainId === SOLANA_CHAIN_ID ? 20 : chainId === BTC_CHAIN_ID ? 21 : 10
}

/** a 排在 b 前面返回负数：时间新的在前 → 链排序 → 哈希 → id（同一笔交易的几条挨在一起） */
export function compareEntries(a: TimelineEntry, b: TimelineEntry): number {
  if (a.time !== b.time) return b.time - a.time
  const r = chainRank(a.chainId) - chainRank(b.chainId)
  if (r) return r
  if (a.hash !== b.hash) return a.hash < b.hash ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// ── 归并 ──
export interface SourcePage { items: TimelineEntry[]; next: string | null; unavailable?: number[] }
export interface TimelineSource { id: string; fetch: (cursor: string | null, signal: AbortSignal) => Promise<SourcePage> }
export interface MergedPage { items: TimelineEntry[]; done: boolean; failed: string[]; unavailable: number[] }

/** 单个源连着拿到空页（全被过滤掉了）最多再追几页，免得死循环 */
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

  /** 下一页。所有源都失败（而且一条都没拿到过）时抛错，交给页面显示「读取失败」 */
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

// ── 分组成一行 ──
export type RowKind = 'receive' | 'send' | 'self' | 'swap' | 'bridge' | 'other'
export interface Leg { symbol: string; amount: string; address: string; chainId: number }
export interface TimelineRow {
  key: string
  chainId: number
  hash: string
  time: number
  kind: RowKind
  status: 'success' | 'failed' | 'pending'
  /** 转出 / 兑换付出的那条 */
  out?: Leg
  /** 收到 / 兑换得到的那条 */
  in?: Leg
  counterparty?: string
  /** 同一笔里另外还有几条（空投一次收好几个币之类） */
  more: number
  bridge?: BridgeLike
}

/**
 * 假币：符号冒充本链原生币或常用币（USDT / USDC…）但合约地址不对。BSC / Polygon 上「地址投毒」天天有人发这种币，
 * 列表里显示「收到 1000 USDT」会误导人，直接不显示。只看收款方向（自己转出的不可能是被人塞的）。
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

/** 按「链 + 哈希」把几条腿合成一行，保持时间倒序 */
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
    // 兑换：同一笔里付出一种、得到另一种
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

// ── Solana 交易解析 ──
/** getParsedTransaction 结果里用得到的部分（结构兼容 @solana/web3.js 的 ParsedTransactionWithMeta） */
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
/** 不到这么多 lamports 的 SOL 变动算零头（账户租金、优先费之类） */
const SOL_DUST = 10_000n
/** 有代币变动时，SOL 变动小于这个（0.003 SOL）当成开代币账户的租金，不单独列 */
const RENT_LIKE = 3_000_000n

function units(raw: bigint, decimals: number): string {
  const neg = raw < 0n, abs = neg ? -raw : raw
  const s = abs.toString().padStart(decimals + 1, '0')
  const int = s.slice(0, s.length - decimals) || '0'
  const frac = decimals ? s.slice(s.length - decimals).replace(/0+$/, '') : ''
  return `${int}${frac ? `.${frac}` : ''}`
}

/**
 * 从 owner 的角度看一笔 Solana 交易：SOL 与各代币的净变化 → 收 / 发的腿。认不出（没有余额变化、交易失败）返回一条空金额的「Solana 交易」。
 * owner 付的手续费不算进「发送」金额里。
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
  // 代币：同一个 mint 可能有好几个账户，按 mint 汇总
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
    if (idx === 0) d += BigInt(tx.meta.fee || 0) // 手续费不算「发送」
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

/** 对方地址：系统转账 / 代币转账指令里，和 owner 相对的那一方（代币账户换成它的主人）；找不到返回 undefined */
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
