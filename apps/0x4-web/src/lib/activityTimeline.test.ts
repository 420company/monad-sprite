import { describe, expect, it } from 'vitest'
import { BTC_CHAIN_ID, SOLANA_CHAIN_ID } from './chains'
import { createMerger, groupTimeline, isSpoofToken, parseSolanaTx, SOL_NATIVE, type SolParsedTx, type TimelineEntry, type TimelineSource } from './activityTimeline'

const T0 = 1_790_000_000_000
const USDT_BSC = '0x55d398326f99059ff775485246999027b3197955'
let n = 0
function entry(p: Partial<TimelineEntry> & { chainId: number; time: number }): TimelineEntry {
  n++
  return {
    id: `e${n}`, hash: `0x${n.toString(16).padStart(4, '0')}`, direction: 'in', amount: '1', status: 'success', source: 'evm',
    asset: { symbol: 'BNB', address: '0x0000000000000000000000000000000000000000', decimals: 18 }, ...p,
  }
}
/** 假数据源：按时间倒序，每页 size 条，cursor 是偏移量 */
function source(id: string, items: TimelineEntry[], size: number, opts: { fail?: 'first' | 'second' } = {}): TimelineSource & { calls: number } {
  const sorted = [...items].sort((a, b) => b.time - a.time)
  const s = {
    id, calls: 0,
    fetch: async (cursor: string | null) => {
      s.calls++
      if (opts.fail === 'first' || (opts.fail === 'second' && cursor)) throw new Error('boom')
      const off = cursor ? Number(cursor) : 0
      return { items: sorted.slice(off, off + size), next: off + size < sorted.length ? String(off + size) : null }
    },
  }
  return s
}
const sig = () => new AbortController().signal
async function drain(m: ReturnType<typeof createMerger>) {
  const all: TimelineEntry[] = []
  for (let i = 0; i < 50; i++) { const p = await m.page(sig()); all.push(...p.items); if (p.done) break }
  return all
}

describe('活动时间线归并', () => {
  it('多个源按时间倒序合成一条，翻页不重不漏；同一时刻 BSC 在 Solana、比特币前面', async () => {
    const evm = Array.from({ length: 23 }, (_, i) => entry({ chainId: i % 2 ? 1 : 56, time: T0 - i * 7_000 }))
    const sol = Array.from({ length: 17 }, (_, i) => entry({ chainId: SOLANA_CHAIN_ID, time: T0 - i * 11_000, source: 'sol' }))
    const btc = Array.from({ length: 5 }, (_, i) => entry({ chainId: BTC_CHAIN_ID, time: T0 - i * 50_000, source: 'btc' }))
    const m = createMerger([source('sol', sol, 4), source('btc', btc, 2), source('evm', evm, 6)], { pageSize: 8 })
    const first = await m.page(sig())
    expect(first.items).toHaveLength(8)
    // T0 三个源都有一条：BSC → Solana → 比特币
    expect(first.items.slice(0, 3).map((e) => e.chainId)).toEqual([56, SOLANA_CHAIN_ID, BTC_CHAIN_ID])
    const rest = await drain(m)
    const all = [...first.items, ...rest]
    expect(all).toHaveLength(evm.length + sol.length + btc.length)
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length)
    for (let i = 1; i < all.length; i++) expect(all[i - 1].time).toBeGreaterThanOrEqual(all[i].time)
  })

  it('老记录不会插到还没拉到的新记录前面（每个源都有缓冲才出）', async () => {
    // evm 每页 1 条，btc 一页全给：第一页不能直接把 btc 的全部倒出来
    const evm = [entry({ chainId: 56, time: T0 }), entry({ chainId: 56, time: T0 - 1000 }), entry({ chainId: 56, time: T0 - 2000 })]
    const btc = [entry({ chainId: BTC_CHAIN_ID, time: T0 - 1500 }), entry({ chainId: BTC_CHAIN_ID, time: T0 - 5000 })]
    const m = createMerger([source('evm', evm, 1), source('btc', btc, 10)], { pageSize: 3 })
    const p = await m.page(sig())
    expect(p.items.map((e) => e.time)).toEqual([T0, T0 - 1000, T0 - 1500])
    const q = await m.page(sig())
    expect(q.items.map((e) => e.time)).toEqual([T0 - 2000, T0 - 5000])
    expect(q.done).toBe(true)
  })

  it('一个源失败：其它照常出，记下失败的源；全部失败才抛错', async () => {
    const ok = [entry({ chainId: 56, time: T0 }), entry({ chainId: 56, time: T0 - 1 })]
    const m = createMerger([source('evm', ok, 5), source('sol', [], 5, { fail: 'first' })], { pageSize: 10 })
    const p = await m.page(sig())
    expect(p.items).toHaveLength(2)
    expect(p.failed).toEqual(['sol'])
    const dead = createMerger([source('a', ok, 5, { fail: 'first' }), source('b', ok, 5, { fail: 'first' })], { pageSize: 10 })
    await expect(dead.page(sig())).rejects.toThrow()
    // 翻页时才失败：已拿到的留着，剩下的源继续
    const later = createMerger([source('evm', Array.from({ length: 6 }, (_, i) => entry({ chainId: 56, time: T0 - i })), 2, { fail: 'second' }), source('sol', [entry({ chainId: SOLANA_CHAIN_ID, time: T0 - 100 })], 5)], { pageSize: 2 })
    const a = await later.page(sig())
    expect(a.items).toHaveLength(2)
    const b = await later.page(sig())
    expect(b.failed).toEqual(['evm'])
    expect(b.items.map((e) => e.chainId)).toEqual([SOLANA_CHAIN_ID])
  })

  it('skip：App 里发起的闪兑已单独显示，链上同哈希的记录跳过', async () => {
    const dup = entry({ chainId: 56, time: T0, hash: '0xAbC' })
    const m = createMerger([source('evm', [dup, entry({ chainId: 56, time: T0 - 1 })], 5)], { pageSize: 10, skip: (e) => e.hash.toLowerCase() === '0xabc' })
    expect((await m.page(sig())).items.map((e) => e.hash)).not.toContain('0xAbC')
  })
})

describe('按交易合成一行', () => {
  it('同一哈希一出一进 = 兑换；只进 = 收到；只出 = 发送；时间倒序', () => {
    const rows = groupTimeline([
      entry({ chainId: 56, time: T0 - 10, hash: '0xswap', direction: 'out', amount: '0.01' }),
      entry({ chainId: 56, time: T0 - 10, hash: '0xswap', direction: 'in', amount: '6', asset: { symbol: 'USDT', address: USDT_BSC, decimals: 18 } }),
      entry({ chainId: 56, time: T0, hash: '0xrecv', direction: 'in', amount: '12', asset: { symbol: 'USDT', address: USDT_BSC, decimals: 18 }, counterparty: '0xabc' }),
      entry({ chainId: 1, time: T0 - 20, hash: '0xsend', direction: 'out', amount: '0.5', asset: { symbol: 'ETH', address: '0x0000000000000000000000000000000000000000', decimals: 18 } }),
    ])
    expect(rows.map((r) => r.kind)).toEqual(['receive', 'swap', 'send'])
    expect(rows[0].in).toMatchObject({ symbol: 'USDT', amount: '12' })
    expect(rows[0].counterparty).toBe('0xabc')
    expect(rows[1].out?.symbol).toBe('BNB')
    expect(rows[1].in?.symbol).toBe('USDT')
    expect(rows[2].out).toMatchObject({ symbol: 'ETH', amount: '0.5' })
  })

  it('冒充 USDT / BNB 的假币不显示；真 USDT 照常', () => {
    const fake = entry({ chainId: 56, time: T0, asset: { symbol: 'USDT', address: '0x1234567890123456789012345678901234567890', decimals: 18 } })
    const fakeNative = entry({ chainId: 56, time: T0, asset: { symbol: 'BNB', address: '0x1234567890123456789012345678901234567890', decimals: 18 } })
    const real = entry({ chainId: 56, time: T0 - 1, asset: { symbol: 'USDT', address: USDT_BSC, decimals: 18 } })
    expect(isSpoofToken(fake)).toBe(true)
    expect(isSpoofToken(fakeNative)).toBe(true)
    expect(isSpoofToken(real)).toBe(false)
    expect(isSpoofToken({ ...fake, direction: 'out' })).toBe(false)
    expect(groupTimeline([fake, fakeNative, real]).map((r) => r.hash)).toEqual([real.hash])
  })

  it('闪兑 / 跨链记录：同链是兑换，不同链是跨链，状态跟着订单走', () => {
    const b = { txHash: '0xb', fromChain: 56, toChain: 8453, fromSymbol: 'BNB', toSymbol: 'USDC', fromAmount: 1, toAmount: 600, status: 'FAILED' as const, createdAt: T0 }
    const rows = groupTimeline([entry({ chainId: 56, time: T0, hash: '0xb', source: 'bridge', bridge: b }), entry({ chainId: 56, time: T0 - 5, hash: '0xc', source: 'bridge', bridge: { ...b, txHash: '0xc', toChain: 56, status: 'DONE' } })])
    expect(rows.map((r) => [r.kind, r.status])).toEqual([['bridge', 'failed'], ['swap', 'success']])
  })
})

describe('Solana 交易解析', () => {
  const OWNER = 'Own1111111111111111111111111111111111111111'
  const PEER = 'Peer111111111111111111111111111111111111111'
  const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  const sym = (m: string) => (m === MINT ? 'USDC' : '?')
  const keys = (...k: string[]) => k.map((pubkey) => ({ pubkey }))

  it('转出 SOL：手续费不算进金额，对方地址来自系统转账指令', () => {
    const tx: SolParsedTx = {
      meta: { err: null, fee: 5000, preBalances: [2_000_000_000, 0], postBalances: [1_499_995_000, 500_000_000] },
      transaction: { message: { accountKeys: keys(OWNER, PEER), instructions: [{ program: 'system', parsed: { type: 'transfer', info: { source: OWNER, destination: PEER, lamports: 500_000_000 } } }] } },
    }
    const [e] = parseSolanaTx('sig1', 1_790_000_000, tx, OWNER, sym)
    expect(e).toMatchObject({ direction: 'out', amount: '0.5', counterparty: PEER, time: 1_790_000_000_000, status: 'success' })
    expect(e.asset.symbol).toBe('SOL')
  })

  it('收到 USDC：开代币账户的租金不单独列；对方是代币账户的主人', () => {
    const tx: SolParsedTx = {
      meta: {
        err: null, fee: 5000, preBalances: [1_000_000_000, 10, 0, 0], postBalances: [1_000_000_000, 10, 2_039_280, 0],
        preTokenBalances: [{ accountIndex: 1, mint: MINT, owner: PEER, uiTokenAmount: { amount: '50000000', decimals: 6 } }],
        postTokenBalances: [{ accountIndex: 1, mint: MINT, owner: PEER, uiTokenAmount: { amount: '37500000', decimals: 6 } }, { accountIndex: 2, mint: MINT, owner: OWNER, uiTokenAmount: { amount: '12500000', decimals: 6 } }],
      },
      transaction: { message: { accountKeys: keys(PEER, 'SrcAcct1111111111111111111111111111111111111', 'DstAcct1111111111111111111111111111111111111', OWNER), instructions: [{ program: 'spl-token', parsed: { type: 'transferChecked', info: { source: 'SrcAcct1111111111111111111111111111111111111', destination: 'DstAcct1111111111111111111111111111111111111', authority: PEER } } }] } },
    }
    const list = parseSolanaTx('sig2', 1_790_000_100, tx, OWNER, sym)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ direction: 'in', amount: '12.5', counterparty: PEER })
    expect(list[0].asset).toMatchObject({ symbol: 'USDC', address: MINT, decimals: 6 })
  })

  it('兑换：SOL 出、代币进，合成一行「兑换 SOL → USDC」', () => {
    const tx: SolParsedTx = {
      meta: {
        err: null, fee: 5000, preBalances: [3_000_000_000], postBalances: [1_999_995_000],
        preTokenBalances: [], postTokenBalances: [{ accountIndex: 1, mint: MINT, owner: OWNER, uiTokenAmount: { amount: '150000000', decimals: 6 } }],
      },
      transaction: { message: { accountKeys: keys(OWNER, 'Acct111111111111111111111111111111111111111'), instructions: [] } },
    }
    const legs = parseSolanaTx('sig3', 1_790_000_200, tx, OWNER, sym)
    const [row] = groupTimeline(legs)
    expect(row.kind).toBe('swap')
    expect(row.out).toMatchObject({ symbol: 'SOL', amount: '1', address: SOL_NATIVE })
    expect(row.in).toMatchObject({ symbol: 'USDC', amount: '150' })
  })

  it('失败的交易 / 没有余额变化 / 拿不到详情：显示成一条「Solana 交易」', () => {
    const failed: SolParsedTx = { meta: { err: { InstructionError: [0, 'x'] }, fee: 5000, preBalances: [1], postBalances: [1] }, transaction: { message: { accountKeys: keys(OWNER), instructions: [] } } }
    expect(parseSolanaTx('s', 1, failed, OWNER, sym)).toMatchObject([{ status: 'failed', amount: '' }])
    const nothing: SolParsedTx = { meta: { err: null, fee: 5000, preBalances: [1_000_000], postBalances: [995_000] }, transaction: { message: { accountKeys: keys(OWNER), instructions: [] } } }
    expect(parseSolanaTx('s', 1, nothing, OWNER, sym)).toMatchObject([{ status: 'success', amount: '' }])
    expect(parseSolanaTx('s', 1, null, OWNER, sym)).toMatchObject([{ amount: '' }])
    expect(groupTimeline(parseSolanaTx('s', 1, null, OWNER, sym))[0].kind).toBe('other')
  })
})
