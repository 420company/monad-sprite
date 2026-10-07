// Meeting moderation frontend state (2026-09-30 goat: mute-all, temp admins, kick, hand-raise requests).
// The server is the source of truth for state (server/src/meetAuth.ts): joining, heartbeats, and every admin endpoint return a copy; the server also writes it into the LiveKit room metadata,
// Everyone in the meeting receives it in real time. This only parses and decides "how the UI should display it" — permissions are enforced by the server and LiveKit; hiding buttons on the client doesn't count.

export type MeetRole = 'host' | 'admin' | 'member'
export interface HandReq { address: string; name: string; at: number }
export interface ModState { host: string; admins: string[]; muteAll: boolean; stage: string[]; hands: HandReq[] }

const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 80

/** Parse the server-provided state (room metadata is a string, the API returns an object); return null on bad format */
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
/** Whether one may speak (same rules as the server): host, admin, no all-mute in effect, or already approved to go on stage */
export function speakOk(s: ModState | null, address: string): boolean {
  if (!s) return true
  return roleIn(s, address) !== 'member' || !s.muteAll || s.stage.includes(address)
}
/** Whether I can moderate someone: hosts moderate everyone; admins only regular members; nobody can moderate themselves or the host */
export function canManage(s: ModState | null, me: string, target: string): boolean {
  if (!s || me === target || target === s.host) return false
  const r = roleIn(s, me)
  return r === 'host' || (r === 'admin' && roleIn(s, target) === 'member')
}
