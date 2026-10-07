// 比特币链上数据：全部经过我们后端的 /api/btc/* 只读代理（server/src/btc.ts），
// 上游是 mempool.space（备用 blockstream.info），手机不直连第三方，不暴露用户 IP。
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
  /** 已确认（sat） */
  confirmed: number
  /** 未确认的净变化（sat，可能为负：正在转出） */
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

/** 一条比特币收发记录（从本地址的角度） */
export interface BtcActivity {
  txid: string
  /** 净变化（sat）：正数收入、负数转出（已含手续费） */
  delta: number
  fee: number
  confirmed: boolean
  blockHeight?: number
  blockTime?: number
  /** 对方地址（转出时是第一个非找零输出，收入时是第一个输入） */
  counterparty?: string
  /** 带 OP_RETURN 备注 */
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

/** 最近的交易（Esplora 一次最多给 50 条未确认 + 25 条已确认） */
export async function getBtcActivity(address: string): Promise<BtcActivity[]> {
  const txs = await fetchJson<EsploraTx[]>(`${BASE}/address/${address}/txs`)
  return txs.map((tx) => toActivity(tx, address))
}

export interface FeeRates {
  /** 约 10 分钟（下一个区块） */
  fast: number
  /** 约 1 小时 */
  normal: number
  /** 约 1 天 */
  slow: number
}

/** 手续费三档（sat/vB）。保留一位小数向上取，最低 1；保证 省 ≤ 标准 ≤ 快 */
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

/** 确认数：未确认 0，已确认 = 最新高度 − 所在高度 + 1 */
export function confirmations(status: { confirmed: boolean; block_height?: number }, tip: number): number {
  if (!status.confirmed || !status.block_height) return 0
  return Math.max(1, tip - status.block_height + 1)
}

/** 广播已签名交易，返回 txid。节点拒绝时把原因翻成人话 */
export async function broadcastBtc(hex: string): Promise<string> {
  const res = await fetch(`${BASE}/tx`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: hex })
  const text = await res.text()
  if (res.ok) return text.trim()
  let reason = text
  try { reason = (JSON.parse(text) as { error?: string }).error || text } catch { /* 纯文本 */ }
  if (/min relay fee|insufficient fee|mempool min fee/i.test(reason)) throw new Error(t('手续费太低，网络没有接收，请选高一档再试'))
  if (/missing|spent|conflict|bad-txns-inputs/i.test(reason)) throw new Error(t('有币已经被花掉了，刷新余额后再试'))
  throw new Error(t('广播失败：{reason}', { reason: reason.slice(0, 160) }))
}
