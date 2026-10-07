// Pure functions for chat history: merge/dedupe, paging cursor, deletion, DM ciphertext decoding. Shared by the store and tests; no network.
import type { DmMessage } from './social'

type Msg = { id: string; ts: number }

/** Sorts consistently with server paging: by time first, then by id within the same millisecond (server ids increase in send order) */
export const byTsId = (a: Msg, b: Msg) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Merge two message batches: dedupe by id (later overwrites earlier, server data wins), sorted by time.
 * Beyond cap entries, drop the oldest (dropped ones can be re-pulled by scrolling up).
 */
export function mergeMessages<T extends Msg>(existing: T[], incoming: T[], cap = 3000): T[] {
  if (!incoming.length) return existing
  const map = new Map<string, T>()
  for (const m of existing) map.set(m.id, m)
  for (const m of incoming) map.set(m.id, m)
  const out = [...map.values()].sort(byTsId)
  return out.length > cap ? out.slice(-cap) : out
}

/** Scroll-up paging cursor: the (ts, id) of the current earliest message; local messages without a receipt yet don't count */
export function olderCursor(list: Msg[]): string {
  const first = list.find((m) => !isLocalId(m.id))
  return first ? `before=${first.ts}&beforeId=${encodeURIComponent(first.id)}` : ''
}

export const isLocalId = (id: string) => id.startsWith('l')

export function removeIds<T extends { id: string }>(list: T[] | undefined, ids: string[]): T[] {
  if (!list) return []
  const drop = new Set(ids)
  return list.filter((m) => !drop.has(m.id))
}

/** A locally pre-shown DM swaps to the official id and time once the server receipt arrives; null when the local one can't be found */
export function confirmLocal<T extends Msg>(list: T[] | undefined, localId: string, id: string, ts: number): T[] | null {
  if (!list || !list.some((m) => m.id === localId)) return null
  return list.filter((m) => m.id !== id).map((m) => (m.id === localId ? { ...m, id, ts } : m)).sort(byTsId)
}

/** A DM returned by the server: my copy of the ciphertext. Messages sent by old clients lack the "own copy" → legacy */
export interface DmWire { id: string; from: string; to: string; ts: number; ciphertext?: string; nonce?: string; epk?: string; legacy?: boolean }
type Decrypt = (p: { ciphertext: string; nonce: string; epk: string }) => Promise<string>

/**
 * Thrown when decrypting DMs while the web 0x4 extension is locked (2026-10-06: a locked extension no longer logs web out). Don't ask the extension to decrypt: a locked extension pops the unlock window,
 * and one window per background DM won't do. Such messages are marked locked, the UI says "unlock to view", and they're re-pulled after the extension unlocks (store/social.ts)
 */
export class DmLocked extends Error {
  constructor() { super('DmLocked'); this.name = 'DmLocked' }
}

export async function decodeDm(row: DmWire, decrypt: Decrypt | null): Promise<DmMessage> {
  const base = { id: row.id, from: row.from, to: row.to, ts: row.ts }
  if (row.legacy || !row.ciphertext || !row.nonce || !row.epk) return { ...base, text: '', legacy: true }
  if (!decrypt) return { ...base, text: '', undecryptable: true }
  try { return { ...base, text: await decrypt({ ciphertext: row.ciphertext, nonce: row.nonce, epk: row.epk }) } }
  catch (e) { return (e as Error | null)?.name === 'DmLocked' ? { ...base, text: '', undecryptable: true, locked: true } : { ...base, text: '', undecryptable: true } }
}
