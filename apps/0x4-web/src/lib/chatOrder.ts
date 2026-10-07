// Message-list ordering: pinned conversations (currently only "0x4 official") always on top, the rest by last-message time descending.
// Extracted as a pure function for unit tests (used by components/ChatList).

export interface OrderedChat { key: string; ts: number; pinned?: boolean }

/** Pinned first (pinned ones also by time), the rest newest-first; ties broken by key for a stable order — the list never jumps around */
export function orderChats<T extends OrderedChat>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.ts - a.ts || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/** The "0x4 official" conversation's summary: the latest announcement (newest first). null when there are none — then it doesn't appear in the list */
export function officialPreview(list: readonly { title: string | null; body: string; createdAt: number }[]): { sub: string; ts: number } | null {
  const a = list[0]
  if (!a) return null
  return { sub: a.title || a.body.replace(/\s+/g, ' ').trim(), ts: a.createdAt }
}
