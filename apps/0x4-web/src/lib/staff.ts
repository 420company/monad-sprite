// Staff identity in the app (support / admin / super-admin). Only decides whether management entries like "delete" are shown;
// real permissions are re-verified per API on the server. Regular users always get null.
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

/** The current account's staff identity; auto-pulled once on first use */
export function useStaffRole(): StaffRole | null {
  const me = useSocial((s) => s.me)
  const status = useSocial((s) => s.status)
  const { address, info } = useStaffStore()
  useEffect(() => {
    if (status === 'ready' && me && useStaffStore.getState().address !== me.address && !useStaffStore.getState().loading) void loadStaff()
  }, [status, me])
  return me && address === me.address ? info?.role ?? null : null
}

/** Whether they can delete others' square posts / comments (support and above) */
export const canModerate = (role: StaffRole | null) => role === 'support' || role === 'admin' || role === 'super'

/**
 * The bound EVM address hasn't been signature-proved yet, but would be staff after proving: sign once with the wallet's EVM private key (no gas, not on-chain).
 * Only called when scan-logging into the admin backend (user-initiated, so a pop-up unlock is expected). Regular users never reach here.
 * Since 2026-09-26 new versions already prove automatically at login / unlock, this mostly returns directly; signing uses the same linked message as login (lib/evmLink).
 * When the server didn't recognize the new format it used to fall back to the old login-message format; after the 2026-09-29 security review the server removed the old format (it could be phished to claim EVM addresses), and this no longer falls back.
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
