// The frontend half of message-history mode ("Me" → message history): options, local records, midnight computation. Server side in server/src/chatPrefs.ts.
//   cloud  encrypted cloud storage (default)
//   device stored on this phone only: DMs are delivered to the device, encrypted and stored, then the server is told to delete my copy
//   daily  auto-cleared daily at 00:00: the server clears at the device-timezone midnight; the app also clears locally once when opened past midnight
export type ChatMode = 'cloud' | 'device' | 'daily'

export const CHAT_MODE_OPTIONS: { value: ChatMode; label: string; note: string }[] = [
  { value: 'cloud', label: '加密云端保存', note: '私信只存密文，换手机导入同一钱包可恢复。' },
  { value: 'device', label: '只存在这台手机', note: '消息送达后从云端删除，记录加密保存在本机。换手机或删除 App 后无法恢复。' },
  { value: 'daily', label: '每天 00:00 自动清空', note: '每天当地时间 00:00，清空你在云端和本机的消息记录。' },
]

export const isChatMode = (v: unknown): v is ChatMode => v === 'cloud' || v === 'device' || v === 'daily'

/** Device timezone: IANA name + UTC offset minutes (UTC+8 is 480); the server computes midnight from it */
export function deviceTz(): { tz: string | null; tzOffset: number } {
  let tz: string | null = null
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null } catch { /* Legacy environments */ }
  return { tz, tzOffset: -new Date().getTimezoneOffset() }
}

/** Local 00:00 (ms) of now's day */
export function lastLocalMidnight(now = Date.now()): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
/** The next local 00:00 */
export function nextLocalMidnight(now = Date.now()): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}

/** Locally recorded mode, last clear time and which midnight was cleared up to — separated per wallet address */
export interface LocalChatPrefs { mode: ChatMode; lastClear: number; clearedBefore: number }
const KEY = '0x4.chat-prefs'

function readAll(): Record<string, LocalChatPrefs> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, LocalChatPrefs> } catch { return {} }
}
export function loadLocalPrefs(owner: string): LocalChatPrefs {
  const p = readAll()[owner]
  return { mode: isChatMode(p?.mode) ? p.mode : 'cloud', lastClear: Number(p?.lastClear) || 0, clearedBefore: Number(p?.clearedBefore) || 0 }
}
export function saveLocalPrefs(owner: string, patch: Partial<LocalChatPrefs>): LocalChatPrefs {
  const all = readAll()
  const next = { ...loadLocalPrefs(owner), ...patch }
  all[owner] = next
  try { localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* If it can't be stored, follow the server's next time */ }
  return next
}

/**
 * Daily-clear mode: whether another local midnight has passed since the last clear. Returns the midnight to clear up to (everything at or before it is cleared); returns 0 when nothing needs clearing.
 * When lastClear is 0 (just switched to this mode, never cleared), use the switch time as the reference — nothing is cleared at the switch moment.
 */
export function dailyClearDue(mode: ChatMode, lastClear: number, now = Date.now()): number {
  if (mode !== 'daily' || !lastClear) return 0
  const m = lastLocalMidnight(now)
  return m > lastClear ? m : 0
}
