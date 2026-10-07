// 聊天记录的纯函数：合并去重、分页游标、删除、私信密文解码。store 和测试共用，不碰网络。
import type { DmMessage } from './social'

type Msg = { id: string; ts: number }

/** 排序与服务端分页一致：先按时间，同一毫秒按 id（服务端 id 按发送顺序递增） */
export const byTsId = (a: Msg, b: Msg) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * 合并两批消息：按 id 去重（后来的覆盖先到的，服务器的数据为准），按时间排好。
 * 超过 cap 条时丢最旧的（丢掉的往上翻还能再拉回来）。
 */
export function mergeMessages<T extends Msg>(existing: T[], incoming: T[], cap = 3000): T[] {
  if (!incoming.length) return existing
  const map = new Map<string, T>()
  for (const m of existing) map.set(m.id, m)
  for (const m of incoming) map.set(m.id, m)
  const out = [...map.values()].sort(byTsId)
  return out.length > cap ? out.slice(-cap) : out
}

/** 往上翻页的游标：当前最早一条的 (ts, id)；本地还没回执的消息不算 */
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

/** 本地先显示的私信收到服务器回执后换成正式 id 和时间；找不到本地那条返回 null */
export function confirmLocal<T extends Msg>(list: T[] | undefined, localId: string, id: string, ts: number): T[] | null {
  if (!list || !list.some((m) => m.id === localId)) return null
  return list.filter((m) => m.id !== id).map((m) => (m.id === localId ? { ...m, id, ts } : m)).sort(byTsId)
}

/** 服务端返回的私信：给我的那份密文。旧版客户端发出的没有「自己那份」→ legacy */
export interface DmWire { id: string; from: string; to: string; ts: number; ciphertext?: string; nonce?: string; epk?: string; legacy?: boolean }
type Decrypt = (p: { ciphertext: string; nonce: string; epk: string }) => Promise<string>

/**
 * 网页版 0x4 插件锁着时解密私信抛这个（2026-10-06：插件锁了网页不再登出）。不去请插件解密：插件锁着会弹解锁窗口，
 * 后台收到一条私信就弹一个窗口不行。这样的消息标 locked，界面写「解锁后查看」，插件解锁后重新拉一次（store/social.ts）
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
