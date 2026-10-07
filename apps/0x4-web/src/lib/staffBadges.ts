// Whether someone is staff (feeds the avatar's outer glow border and the "official" / "support" badge next to names on profiles).
//
// The border is anti-impersonation: regular users can't get it even with the same avatar and nickname — so only the server's /api/users/staff-badges result counts,
// the frontend never looks at nicknames or users.evm_address (self-reported by the client).
// Fetching mirrors XBadge: addresses within a short window batch into one request (max 200 per request, more split into batches),
// results cached in memory — regular users cached as null too, so someone appearing ten times in a list is only asked once.
// The server caches for 60 s; the frontend re-asks after 5 min, so a deactivated support agent's border disappears without an app restart.
import { create } from 'zustand'
import { api } from '@/lib/social'

export type StaffBadge = 'admin' | 'support'
const BATCH_MAX = 200
const TTL_MS = 5 * 60_000

interface StaffBadgeState {
  /** Address → role; null = regular user (already asked) */
  roles: Record<string, StaffBadge | null>
  /** Address → when it was asked; re-ask when stale */
  at: Record<string, number>
  ensure: (address: string) => void
}

let queue = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null

export const useStaffBadges = create<StaffBadgeState>()((set, get) => ({
  roles: {},
  at: {},
  ensure: (address) => {
    if (!address || queue.has(address)) return
    const t0 = get().at[address]
    if (t0 !== undefined && Date.now() - t0 < TTL_MS) return
    queue.add(address)
    if (timer !== null) return
    timer = setTimeout(() => {
      const all = [...queue]
      queue = new Set()
      timer = null
      for (let i = 0; i < all.length; i += BATCH_MAX) {
        const batch = all.slice(i, i + BATCH_MAX)
        api<Record<string, StaffBadge>>(`/api/users/staff-badges?addresses=${batch.map(encodeURIComponent).join(',')}`)
          .then((r) => {
            const now = Date.now()
            const roles: Record<string, StaffBadge | null> = {}
            const at: Record<string, number> = {}
            for (const a of batch) { roles[a] = r[a] === 'admin' || r[a] === 'support' ? r[a] : null; at[a] = now }
            set({ roles: { ...get().roles, ...roles }, at: { ...get().at, ...at } })
          })
          .catch(() => { /* Nothing fetched → write no cache, ask again on next render; the border would rather not show than guess */ })
      }
    }, 80)
  },
}))

/** For tests: clear the cache and the queue */
export function resetStaffBadges() {
  if (timer !== null) clearTimeout(timer)
  timer = null
  queue = new Set()
  useStaffBadges.setState({ roles: {}, at: {} })
}
