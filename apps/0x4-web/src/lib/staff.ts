// App 里的工作人员身份（客服 / 管理员 / 超级管理员）。只用来决定显不显示「删除」等管理入口，
// 真正的权限每个接口在服务端都会再校验。普通用户拿到的永远是 null。
import { useEffect } from 'react'
import { create } from 'zustand'
import { api, proveEvmLink } from '@/lib/social'
import { useWallet } from '@/store/wallet'
import { useSocial } from '@/store/social'

export type StaffRole = 'super' | 'admin' | 'support'
interface StaffInfo { role: StaffRole | null; proofNeeded: boolean; banned: { reason: string | null; at: number } | null }

const useStaffStore = create<{ address: string | null; info: StaffInfo | null; loading: boolean }>(() => ({ address: null, info: null, loading: false }))

export async function loadStaff(force = false): Promise<StaffInfo | null> {
  const me = useSocial.getState().me
  if (!me || useSocial.getState().status !== 'ready') return null
  const cur = useStaffStore.getState()
  if (!force && cur.address === me.address && cur.info) return cur.info
  useStaffStore.setState({ loading: true })
  try {
    const info = await api<StaffInfo>('/api/me/staff')
    useStaffStore.setState({ address: me.address, info, loading: false })
    return info
  } catch { useStaffStore.setState({ loading: false }); return null }
}

/** 当前账号的工作人员身份；第一次用时自动拉一次 */
export function useStaffRole(): StaffRole | null {
  const me = useSocial((s) => s.me)
  const status = useSocial((s) => s.status)
  const { address, info } = useStaffStore()
  useEffect(() => {
    if (status === 'ready' && me && useStaffStore.getState().address !== me.address && !useStaffStore.getState().loading) void loadStaff()
  }, [status, me])
  return me && address === me.address ? info?.role ?? null : null
}

/** 能不能删别人的广场帖子 / 评论（客服及以上） */
export const canModerate = (role: StaffRole | null) => role === 'support' || role === 'admin' || role === 'super'

/**
 * 绑定的 EVM 地址还没签名证明、但证明后是工作人员：用钱包的 EVM 私钥签一次（不花 gas，不上链）。
 * 只在扫码登录管理后台时调用（用户主动操作，弹解锁是预期内的）。普通用户永远不会走到这里。
 * 2026-09-26 起新版在登录 / 解锁时已经自动证明过，这里多半直接返回；签名走和登录同一套关联消息（lib/evmLink）。
 * 以前服务器不认新格式时退回老的登录消息格式；2026-09-29 安全审查后服务器删了老格式（能被钓鱼冒领 EVM 地址），这里也不再退回。
 */
export async function ensureStaffProof(): Promise<StaffRole | null> {
  const info = await loadStaff(true)
  if (!info?.proofNeeded) return info?.role ?? null
  const account = useWallet.getState().evmAccount
  const me = useSocial.getState().me
  if (!account?.signMessage || !me) return info.role
  const r = await proveEvmLink(me.address, account)
  const role = r.role as StaffRole | null
  useStaffStore.setState({ info: { ...info, role, proofNeeded: false } })
  const cur = useSocial.getState().me
  if (cur) useSocial.setState({ me: { ...cur, evmVerified: true } })
  return role
}
