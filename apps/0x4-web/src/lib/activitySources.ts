// 活动页的四个数据源（归并逻辑在 activityTimeline.ts）：
//   evm     服务端 /api/me/activity/evm（BSC 走 NodeReal，其余 EVM 链走 Alchemy，见 server/src/evmActivity.ts）
//   sol     Solana 节点：getSignaturesForAddress 翻页 + getParsedTransactions 一次批量解析出收发金额
//   btc     比特币：/api/btc 代理（Esplora），第一页含未确认，之后按最后一笔已确认的 txid 往下翻
//   bridge  App 里自己发起的闪兑 / 跨链（本机保存），已结束的并进时间线，进行中的在页面顶部单独置顶
import { PublicKey } from '@solana/web3.js'
import { api } from './social'
import { API_BASE } from './env'
import { fetchJson } from './http'
import { getConnection } from './rpc'
import { toActivity } from './btcApi'
import { formatBtc } from './btc'
import { BTC_CHAIN_ID, CHAINS, SOLANA_CHAIN_ID } from './chains'
import { parseSolanaTx, type BridgeLike, type SolParsedTx, type SourcePage, type TimelineEntry, type TimelineSource } from './activityTimeline'
import { useMarket } from '@/store/market'

const EVM_PAGE = 25
const SOL_PAGE = 20

interface EvmItem { id: string; chainId: number; hash: string; time: number; direction: 'in' | 'out' | 'self'; asset: { symbol: string; address: string; decimals: number; logo?: string }; amount: string; counterparty: string; status: 'success' | 'failed' }

/** chainId 为空 = 全部 EVM 链 */
export function evmSource(chainId: number | null): TimelineSource {
  return {
    id: 'evm',
    fetch: async (cursor) => {
      const qs = new URLSearchParams({ limit: String(EVM_PAGE) })
      if (chainId) qs.set('chainId', String(chainId))
      if (cursor) qs.set('cursor', cursor)
      const r = await api<{ items: EvmItem[]; next: string | null; failed?: number[]; unavailable?: number[] }>(`/api/me/activity/evm?${qs}`)
      // 服务端有链读失败时整页照给（其它链的），这里当成「这个源部分失败」：抛错会丢掉整页，所以只在一条都没有时才抛
      if (!r.items.length && r.failed?.length && !cursor) throw new Error('evm failed')
      return { items: r.items.map((x): TimelineEntry => ({ ...x, source: 'evm' })), next: r.next, unavailable: r.unavailable }
    },
  }
}

/** Solana 代币符号：常用币直接认，其余批量问行情接口，问不到显示 mint 前几位 */
const KNOWN_SOL = new Map(CHAINS.find((c) => c.id === SOLANA_CHAIN_ID)!.tokens.map((tk) => [tk.address, tk.symbol]))
const solSymbols = new Map<string, string>()
async function resolveSymbols(mints: string[]) {
  const unknown = [...new Set(mints)].filter((m) => !KNOWN_SOL.has(m) && !solSymbols.has(m))
  if (!unknown.length) return
  try { for (const tk of await useMarket.getState().loadTokens(unknown)) if (tk.symbol) solSymbols.set(tk.address, tk.symbol) } catch { /* 查不到就显示缩写 */ }
}
const solSymbolOf = (mint: string) => KNOWN_SOL.get(mint) || solSymbols.get(mint) || `${mint.slice(0, 4)}…`

export function solSource(rpcUrl: string, owner: string): TimelineSource {
  return {
    id: 'sol',
    fetch: async (cursor) => {
      const conn = getConnection(rpcUrl)
      const sigs = await conn.getSignaturesForAddress(new PublicKey(owner), { limit: SOL_PAGE, ...(cursor ? { before: cursor } : {}) })
      const next = sigs.length >= SOL_PAGE ? sigs[sigs.length - 1].signature : null
      // 一次批量解析整页；节点不支持批量或失败时退回只显示「Solana 交易」，不让整个源失败
      let parsed: (SolParsedTx | null)[] = []
      try { parsed = (await conn.getParsedTransactions(sigs.map((s) => s.signature), { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })) as unknown as (SolParsedTx | null)[] } catch { parsed = [] }
      const mints: string[] = []
      for (const tx of parsed) for (const b of tx?.meta?.postTokenBalances || []) if (b.owner === owner) mints.push(b.mint)
      await resolveSymbols(mints)
      const items = sigs.flatMap((s, i) => {
        const tx = parsed[i] ?? null
        // 批量解析没拿到的：签名列表里的 err 还是准的
        const list = parseSolanaTx(s.signature, s.blockTime, tx, owner, solSymbolOf)
        return tx ? list : list.map((e) => ({ ...e, status: s.err ? 'failed' as const : 'success' as const }))
      })
      return { items, next }
    },
  }
}

interface EsploraTxLite { txid: string; fee: number; status: { confirmed: boolean; block_height?: number; block_time?: number }; vin: { prevout: { scriptpubkey_address?: string; value: number } | null }[]; vout: { scriptpubkey_address?: string; scriptpubkey_type: string; value: number }[] }

export function btcSource(address: string): TimelineSource {
  const BASE = `${API_BASE}/api/btc`
  return {
    id: 'btc',
    fetch: async (cursor) => {
      const txs = await fetchJson<EsploraTxLite[]>(cursor ? `${BASE}/address/${address}/txs/chain/${cursor}` : `${BASE}/address/${address}/txs`)
      const now = Date.now()
      const items = txs.map((tx): TimelineEntry => {
        const a = toActivity(tx, address)
        return {
          id: `btc:${a.txid}`, chainId: BTC_CHAIN_ID, hash: a.txid, time: a.blockTime ? a.blockTime * 1000 : now,
          direction: a.delta >= 0 ? 'in' : 'out', asset: { symbol: 'BTC', address: 'bitcoin', decimals: 8 },
          amount: formatBtc(Math.abs(a.delta)), counterparty: a.counterparty, status: a.confirmed ? 'success' : 'pending', source: 'btc',
        }
      })
      // Esplora 每页最多 25 条已确认；不满 25 条说明到头了
      const confirmed = txs.filter((tx) => tx.status?.confirmed)
      return { items, next: confirmed.length >= 25 ? confirmed[confirmed.length - 1].txid : null }
    },
  }
}

/** 闪兑 / 跨链：本机记录，一次给完 */
export function bridgeSource(list: BridgeLike[]): TimelineSource {
  return {
    id: 'bridge',
    fetch: async (): Promise<SourcePage> => ({
      next: null,
      items: list.map((b) => ({
        id: `bridge:${b.txHash}`, chainId: b.fromChain, hash: b.txHash, time: b.createdAt, direction: 'out' as const,
        asset: { symbol: b.fromSymbol, address: '', decimals: 0 }, amount: String(b.fromAmount), status: b.status === 'FAILED' ? 'failed' as const : b.status === 'PENDING' ? 'pending' as const : 'success' as const,
        source: 'bridge' as const, bridge: b,
      })),
    }),
  }
}
