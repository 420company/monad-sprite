// Notification ref (5th arg of server-side notify) → in-app route. Shared by the notification center and system pushes
import { PERP_ENABLED } from './features'
/** ref carried in a notification → in-app path. Unrecognized ones all go to the notification center */
export function pathForRef(ref: string | null | undefined): string {
  if (!ref) return '/notifications'
  // Broadcast announcements: official or announcement:<announcement id> — all go to the "0x4 Official" announcement page
  if (ref === 'official') return '/official'
  const [kind, id] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)]
  if (!id || ref.indexOf(':') < 0) return '/notifications'
  if (kind === 'dm') return `/dm/${encodeURIComponent(id)}`
  if (kind === 'group') return `/g/${encodeURIComponent(id)}`
  if (kind === 'user') return `/u/${encodeURIComponent(id)}`
  // Comments, likes, posts from followed people: post:<post id> (post pushes used to be user:<author>; old pushes still go to the profile)
  if (kind === 'post') return `/post/${encodeURIComponent(id)}`
  // Someone followed buys a coin: token:<chain>:<contract>; opens a position: perp:<coin>
  if (kind === 'token') {
    const i = id.indexOf(':')
    if (i > 0 && i < id.length - 1) return `/token/${encodeURIComponent(id.slice(0, i))}/${encodeURIComponent(id.slice(i + 1))}`
    return '/notifications'
  }
  if (kind === 'perp') return PERP_ENABLED ? `/perp?coin=${encodeURIComponent(id)}` : '/notifications'
  // Support reply / ticket status change: ticket:<ticket id>
  if (kind === 'ticket') return `/support/${encodeURIComponent(id)}`
  if (kind === 'announcement') return '/official'
  // Someone you follow went live: live:<room id> (2026-09-30); the platform closed your meeting: meet:<meeting code> goes to the meeting page (ended meetings show as ended)
  if (kind === 'live') return `/room/${encodeURIComponent(id)}`
  if (kind === 'meet') return `/meet/${encodeURIComponent(id)}`
  // Sprite notifications (order-approval requests, stop-trading, expiry…): fly:<sprite id>, some with a :daystop-style suffix — only take the first segment (2026-10-04 walkthrough: taps used to go nowhere, and approval confirmations timed out)
  if (kind === 'fly') { const fid = id.split(':')[0]; return fid ? `/fly/${encodeURIComponent(fid)}` : '/notifications' }
  // A new computer logged into web via QR (2026-10-01): pc:sessions, opens "Logged-in computers"
  if (kind === 'pc') return '/settings?open=pc'
  return '/notifications'
}

/** Where a notification tap goes: usually by ref; "apply to join" notifications (ref is group:<group id>) open that group's join-request list directly (2026-10-03 goat: admins couldn't find where to approve) */
export function pathForNotif(n: { ref?: string | null; type?: string }): string {
  const path = pathForRef(n.ref)
  return n.type === 'join_request' && path.startsWith('/g/') ? `${path}?requests=1` : path
}
