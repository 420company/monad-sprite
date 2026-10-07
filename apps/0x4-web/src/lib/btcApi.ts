// Bitcoin on-chain data: all goes through our backend's /api/btc/* read-only proxy (server/src/btc.ts),
// Upstream is mempool.space (fallback blockstream.info); phones never talk to third parties directly, so user IPs aren't exposed.
import { API_BASE } from './env'
import { fetchJson } from './http'
import type { Utxo } from './btc'
import { t } from '@/lib/i18n'

const BASE = `${API_BASE}/api/btc`

interface EsploraStats { funded_txo_sum: number; spent_txo_sum: number; tx_count: number }
interface EsploraAddress { chain_stats: EsploraStats; mempool_stats: EsploraStats }
interface EsploraStatus { confirmed: boolean; block_height?: number; block_time?: number }
interface EsploraUtxo { txid: string; vout: number; value: number; status: EsploraStatus }
interface EsploraTx {
  txid: string
  fee: number
  status: EsploraStatus
  vin: { prevout: { scriptpubkey_address?: string; value: number } | null }[]
  vout: { scriptpubkey_address?: string; scriptpubkey_type: string; value: number }[]
}

export interface BtcBalance {
  /** Confirmed (sat) */
  confirmed: number
  /** Unconfirmed net change (sat; may be negative: sending in progress) */
  pending: number
}

export async function getBtcBalance(address: string): Promise<BtcBalance> {
  const a = await fetchJson<EsploraAddress>(`${BASE}/address/${address}`)
  return {
    confirmed: a.chain_stats.funded_txo_sum - a.chain_stats.spent_txo_sum,
    pending: a.mempool_stats.funded_txo_sum - a.mempool_stats.spent_txo_sum,
  }
}

export async function getBtcUtxos(address: string): Promise<Utxo[]> {
  const list = await fetchJson<EsploraUtxo[]>(`${BASE}/address/${address}/utxo`)
  return list.map((u) => ({ txid: u.txid, vout: u.vout, value: u.value, confirmed: !!u.status?.confirmed }))
}

/** One Bitcoin send/receive record (from this address's perspective) */
export interface BtcActivity {
  txid: string
  /** Net change (sat): positive = received, negative = sent (fees included) */
  delta: number
  fee: number
  confirmed: boolean
  blockHeight?: number
  blockTime?: number
  /** Counterparty address (first non-change output when sending, first input when receiving) */
  counterparty?: string
  /** With an OP_RETURN memo */
  hasMemo: boolean
}

export function toActivity(tx: EsploraTx, address: string): BtcActivity {
  const received = tx.vout.filter((o) => o.scriptpubkey_address === address).reduce((s, o) => s + o.value, 0)
  const spent = tx.vin.filter((i) => i.prevout?.scriptpubkey_address === address).reduce((s, i) => s + (i.prevout?.value || 0), 0)
  const delta = received - spent
  const counterparty = delta < 0
    ? tx.vout.find((o) => o.scriptpubkey_address && o.scriptpubkey_address !== address)?.scriptpubkey_address
    : tx.vin.find((i) => i.prevout?.scriptpubkey_address && i.prevout.scriptpubkey_address !== address)?.prevout?.scriptpubkey_address
  return {
    txid: tx.txid, delta, fee: tx.fee, confirmed: !!tx.status?.confirmed,
    blockHeight: tx.status?.block_height, blockTime: tx.status?.block_time, counterparty,
    hasMemo: tx.vout.some((o) => o.scriptpubkey_type === 'op_return'),
  }
}

/** Recent transactions (Esplora returns at most 50 unconfirmed + 25 confirmed per call) */
export async function getBtcActivity(address: string): Promise<BtcActivity[]> {
  const txs = await fetchJson<EsploraTx[]>(`${BASE}/address/${address}/txs`)
  return txs.map((tx) => toActivity(tx, address))
}

export interface FeeRates {
  /** ~10 minutes (the next block) */
  fast: number
  /** ~1 hour */
  normal: number
  /** ~1 day */
  slow: number
}

/** Three fee tiers (sat/vB). Round up to one decimal, minimum 1; guarantee economy ≤ standard ≤ fast */
export function pickFeeRates(est: Record<string, number>): FeeRates {
  const at = (...targets: string[]) => {
    for (const k of targets) if (Number(est[k]) > 0) return Number(est[k])
    return 1
  }
  const norm = (v: number) => Math.max(1, Math.ceil(v * 10) / 10)
  const fast = norm(at('1', '2', '3'))
  const normal = Math.min(fast, norm(at('6', '5', '4', '3')))
  const slow = Math.min(normal, norm(at('144', '100', '72', '48', '25')))
  return { fast, normal, slow }
}

export async function getFeeRates(): Promise<FeeRates> {
  return pickFeeRates(await fetchJson<Record<string, number>>(`${BASE}/fee-estimates`))
}

export async function getTipHeight(): Promise<number> {
  const res = await fetch(`${BASE}/blocks/tip/height`)
  if (!res.ok) throw new Error(t('区块高度获取失败'))
  return Number(await res.text())
}

export async function getTxStatus(txid: string): Promise<EsploraStatus> {
  return fetchJson<EsploraStatus>(`${BASE}/tx/${txid}/status`)
}

/** Confirmations: 0 when unconfirmed; confirmed = latest height − its height + 1 */
export function confirmations(status: { confirmed: boolean; block_height?: number }, tip: number): number {
  if (!status.confirmed || !status.block_height) return 0
  return Math.max(1, tip - status.block_height + 1)
}

/** Broadcast a signed transaction, returning the txid. When the node rejects, translate the reason into human words */
export async function broadcastBtc(hex: string): Promise<string> {
  const res = await fetch(`${BASE}/tx`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: hex })
  const text = await res.text()
  if (res.ok) return text.trim()
  let reason = text
  try { reason = (JSON.parse(text) as { error?: string }).error || text } catch { /* Plain text */ }
  if (/min relay fee|insufficient fee|mempool min fee/i.test(reason)) throw new Error(t('手续费太低，网络没有接收，请选高一档再试'))
  if (/missing|spent|conflict|bad-txns-inputs/i.test(reason)) throw new Error(t('有币已经被花掉了，刷新余额后再试'))
  throw new Error(t('广播失败：{reason}', { reason: reason.slice(0, 160) }))
}
