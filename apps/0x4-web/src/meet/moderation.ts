// 会议管理的前端状态（2026-09-30 goat：全员禁言、临时管理员、踢人、举手申请上台）。
// 状态以服务器为准（server/src/meetAuth.ts）：进会、心跳、每个管理接口都返回一份；服务器也把它写进 LiveKit 房间元数据，
// 会议里所有人实时收到。这里只负责解析和判断「界面该怎么显示」，权限本身由服务器和 LiveKit 强制，前端藏按钮不算数。

export type MeetRole = 'host' | 'admin' | 'member'
export interface HandReq { address: string; name: string; at: number }
export interface ModState { host: string; admins: string[]; muteAll: boolean; stage: string[]; hands: HandReq[] }

const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 80

/** 解析服务器给的状态（房间元数据是字符串，接口返回是对象）；格式不对返回 null */
export function parseModState(raw: unknown): ModState | null {
  let o: unknown = raw
  if (typeof raw === 'string') { try { o = JSON.parse(raw) } catch { return null } }
  if (!o || typeof o !== 'object') return null
  const x = o as Record<string, unknown>
  if (!isStr(x.host)) return null
  const list = (v: unknown) => (Array.isArray(v) ? v.filter(isStr).slice(0, 200) : [])
  const hands = Array.isArray(x.hands) ? x.hands.filter((h): h is HandReq => !!h && isStr((h as HandReq).address)).slice(0, 200)
    .map((h) => ({ address: h.address, name: typeof h.name === 'string' ? h.name.slice(0, 60) : h.address, at: Number(h.at) || 0 })) : []
  return { host: x.host, admins: list(x.admins), muteAll: x.muteAll === true, stage: list(x.stage), hands }
}

export function roleIn(s: ModState | null, address: string): MeetRole {
  if (!s) return 'member'
  return s.host === address ? 'host' : s.admins.includes(address) ? 'admin' : 'member'
}
/** 能不能说话（和服务器同一规则）：主持人、管理员、没开全员禁言、或者已被批准上台 */
export function speakOk(s: ModState | null, address: string): boolean {
  if (!s) return true
  return roleIn(s, address) !== 'member' || !s.muteAll || s.stage.includes(address)
}
/** 我能不能对某人做管理操作：主持人管所有人；管理员只能管普通成员；谁都不能管自己和主持人 */
export function canManage(s: ModState | null, me: string, target: string): boolean {
  if (!s || me === target || target === s.host) return false
  const r = roleIn(s, me)
  return r === 'host' || (r === 'admin' && roleIn(s, target) === 'member')
}
