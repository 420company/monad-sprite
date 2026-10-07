// 别人是不是工作人员（头像外圈的发光边框、个人主页名字旁的「官方」/「客服」标签用）。
//
// 边框是防冒充的：普通用户换成同样的头像和昵称也拿不到，所以只认服务端 /api/users/staff-badges 的结果，
// 前端不看昵称、不看 users.evm_address（那是客户端自报的）。
// 取数照搬 XBadge：同一小段时间里的地址攒成一批问一次（一次最多 200 个，多了分几批），
// 结果缓存在内存里，普通用户也缓存成 null，同一个人在列表里出现十次只问一次。
// 服务端有 60 秒缓存；前端缓存 5 分钟后重问，客服被停用后不用重启 App 边框也会消失。
import { create } from 'zustand'
import { api } from '@/lib/social'

export type StaffBadge = 'admin' | 'support'
const BATCH_MAX = 200
const TTL_MS = 5 * 60_000

interface StaffBadgeState {
  /** 地址 → 角色；null = 普通用户（已问过） */
  roles: Record<string, StaffBadge | null>
  /** 地址 → 问到的时间，过期重问 */
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
          .catch(() => { /* 没问到就不写缓存，下次渲染再问；边框宁可不显示也不猜 */ })
      }
    }, 80)
  },
}))

/** 测试用：清空缓存和排队 */
export function resetStaffBadges() {
  if (timer !== null) clearTimeout(timer)
  timer = null
  queue = new Set()
  useStaffBadges.setState({ roles: {}, at: {} })
}
