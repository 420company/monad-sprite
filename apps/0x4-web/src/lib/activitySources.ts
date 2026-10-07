// The activity page's four data sources (merge logic in activityTimeline.ts):
//   evm     server /api/me/activity/evm (BSC via NodeReal, other EVM chains via Alchemy, see server/src/evmActivity.ts)
//   sol     Solana nodes: getSignaturesForAddress pagination + getParsedTransactions batch-parsing send/receive amounts in one go
//   btc     Bitcoin: /api/btc proxy (Esplora); first page includes unconfirmed, then paginate from the last confirmed txid
//   bridge  in-app initiated swaps / bridges (saved locally); finished ones merge into the timeline, in-progress ones pin to the page top
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

/** Empty chainId = all EVM chains */
export function evmSource(chainId: number | null): TimelineSource {
  return {
    id: 'evm',
    fetch: async (cursor) => {
      const qs = new URLSearchParams({ limit: String(EVM_PAGE) })
      if (chainId) qs.set('chainId', String(chainId))
      if (cursor) qs.set('cursor', cursor)
      const r = await api<{ items: EvmItem[]; next: string | null; failed?: number[]; unavailable?: number[] }>(`/api/me/activity/evm?${qs}`)
      // The server still serves the page when one chain fails (with the other chains'); treat that as "this source partially failed": throwing would drop the whole page, so throw only when nothing came back
      if (!r.items.length && r.failed?.length && !cursor) throw new Error('evm failed')
      return { items: r.items.map((x): TimelineEntry => ({ ...x, source: 'evm' })), next: r.next, unavailable: r.unavailable }
    },
  }
}

/** Solana token symbols: common coins recognized directly, the rest batch-queried from the market API; unresolvable ones show the mint's first chars */
const KNOWN_SOL = new Map(CHAINS.find((c) => c.id === SOLANA_CHAIN_ID)!.tokens.map((tk) => [tk.address, tk.symbol]))
const solSymbols = new Map<string, string>()
async function resolveSymbols(mints: string[]) {
  const unknown = [...new Set(mints)].filter((m) => !KNOWN_SOL.has(m) && !solSymbols.has(m))
  if (!unknown.length) return
  try { for (const tk of await useMarket.getState().loadTokens(unknown)) if (tk.symbol) solSymbols.set(tk.address, tk.symbol) } catch { /* Show the abbreviation when unresolvable */ }
}
const solSymbolOf = (mint: string) => KNOWN_SOL.get(mint) || solSymbols.get(mint) || `${mint.slice(0, 4)}…`

export function solSource(rpcUrl: string, owner: string): TimelineSource {
  return {
    id: 'sol',
    fetch: async (cursor) => {
      const conn = getConnection(rpcUrl)
      const sigs = await conn.getSignaturesForAddress(new PublicKey(owner), { limit: SOL_PAGE, ...(cursor ? { before: cursor } : {}) })
      const next = sigs.length >= SOL_PAGE ? sigs[sigs.length - 1].signature : null
      // Batch-parse the whole page at once; when the node lacks batch support or it fails, fall back to plain "Solana transaction" rows instead of failing the source
      let parsed: (SolParsedTx | null)[] = []
      try { parsed = (await conn.getParsedTransactions(sigs.map((s) => s.signature), { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })) as unknown as (SolParsedTx | null)[] } catch { parsed = [] }
      const mints: string[] = []
      for (const tx of parsed) for (const b of tx?.meta?.postTokenBalances || []) if (b.owner === owner) mints.push(b.mint)
      await resolveSymbols(mints)
      const items = sigs.flatMap((s, i) => {
        const tx = parsed[i] ?? null
        // For entries batch-parsing missed: the signature list's err is still reliable
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
      // Esplora returns max 25 confirmed per page; fewer means we've reached the end
      const confirmed = txs.filter((tx) => tx.status?.confirmed)
      return { items, next: confirmed.length >= 25 ? confirmed[confirmed.length - 1].txid : null }
    },
  }
}

/** Swaps / bridges: local records, delivered in one go */
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
