// 消息列表排序：置顶的会话（目前只有「0x4 官方」）永远在最上面，其余按最后一条消息时间倒序。
// 抽成纯函数方便单测（components/ChatList 用）。

export interface OrderedChat { key: string; ts: number; pinned?: boolean }

/** 置顶的在前（置顶之间也按时间），其余按时间倒序；时间相同按 key 固定顺序，列表不会来回跳 */
export function orderChats<T extends OrderedChat>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.ts - a.ts || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/** 「0x4 官方」会话的摘要：最新一条公告（新的在前）。没有公告返回 null，会话列表里就不出现 */
export function officialPreview(list: readonly { title: string | null; body: string; createdAt: number }[]): { sub: string; ts: number } | null {
  const a = list[0]
  if (!a) return null
  return { sub: a.title || a.body.replace(/\s+/g, ' ').trim(), ts: a.createdAt }
}
