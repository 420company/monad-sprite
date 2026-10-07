// 消息记录模式（「我」→ 消息记录）的前端部分：选项、本机记录、零点计算。服务端见 server/src/chatPrefs.ts。
//   cloud  加密云端保存（默认）
//   device 只存在这台手机：私信送到本机、加密存好后通知服务器删掉我那份
//   daily  每天 00:00 自动清空：服务器按设备时区零点清，App 打开时过了零点也清一次本机
export type ChatMode = 'cloud' | 'device' | 'daily'

export const CHAT_MODE_OPTIONS: { value: ChatMode; label: string; note: string }[] = [
  { value: 'cloud', label: '加密云端保存', note: '私信只存密文，换手机导入同一钱包可恢复。' },
  { value: 'device', label: '只存在这台手机', note: '消息送达后从云端删除，记录加密保存在本机。换手机或删除 App 后无法恢复。' },
  { value: 'daily', label: '每天 00:00 自动清空', note: '每天当地时间 00:00，清空你在云端和本机的消息记录。' },
]

export const isChatMode = (v: unknown): v is ChatMode => v === 'cloud' || v === 'device' || v === 'daily'

/** 设备时区：IANA 名 + UTC 偏移分钟（东八区 480），服务器按它算零点 */
export function deviceTz(): { tz: string | null; tzOffset: number } {
  let tz: string | null = null
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null } catch { /* 老环境 */ }
  return { tz, tzOffset: -new Date().getTimezoneOffset() }
}

/** now 所在这一天的本地 00:00（毫秒） */
export function lastLocalMidnight(now = Date.now()): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
/** 下一个本地 00:00 */
export function nextLocalMidnight(now = Date.now()): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}

/** 本机记下的模式、上次清理时间、清到了哪个零点，按钱包地址分开 */
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
  try { localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* 存不上下次按服务器的 */ }
  return next
}

/**
 * 每天清空模式：上次清理之后是不是又过了一个本地零点。返回该清到的零点（这个时间及以前的都清），不用清返回 0。
 * lastClear 为 0（刚切到这个模式、还没清过）时以切换时间为准，切换那一刻不清。
 */
export function dailyClearDue(mode: ChatMode, lastClear: number, now = Date.now()): number {
  if (mode !== 'daily' || !lastClear) return 0
  const m = lastLocalMidnight(now)
  return m > lastClear ? m : 0
}
