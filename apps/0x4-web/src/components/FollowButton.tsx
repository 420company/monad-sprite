// 关注 / 已关注
import { useEffect, useState } from 'react'
import { api } from '@/lib/social'
import { toast } from './Toast'
import { useSocial } from '@/store/social'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'
import { needAccount } from '@/desktop/walletGate'
import { WEB_SURFACE } from '@/lib/surface'

export default function FollowButton({ address, size = 'sm', initial, onChange, label }: { address: string; size?: 'xs' | 'sm' | 'lg'; initial?: boolean; onChange?: (following: boolean, followers: number) => void; label?: string }) {
  const { me, status } = useSocial()
  const [following, setFollowing] = useState<boolean | null>(initial ?? null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (initial !== undefined || status !== 'ready') return
    api<{ isFollowing: boolean }>(`/api/users/${address}/social`).then((r) => setFollowing(r.isFollowing)).catch(() => setFollowing(false))
  }, [address, initial, status])

  // 网页版访客：照样显示「关注」，点了先连钱包（2026-10-04 走查：以前访客看不到关注按钮）
  const cls = size === 'xs' ? 'px-3 py-1 text-xs' : size === 'lg' ? 'px-5 py-2.5 text-sm w-full' : 'px-4 py-1.5 text-sm'
  if (!me && WEB_SURFACE) return <button type="button" onClick={() => { needAccount() }} className={`rounded-xl font-semibold ${cls} bg-social text-white`}>{label || t('关注')}</button>
  if (!me || me.address === address) return null
  const toggle = async () => {
    setBusy(true)
    try {
      const r = await api<{ isFollowing: boolean; followers: number }>(`/api/users/${address}/${following ? 'unfollow' : 'follow'}`, { method: 'POST' })
      setFollowing(r.isFollowing); onChange?.(r.isFollowing, r.followers)
    } catch (e) { toast.error(errorText(e, t('操作失败'))) } finally { setBusy(false) }
  }
  return (
    <button onClick={toggle} disabled={busy || following === null} className={`rounded-xl font-semibold ${cls} ${following ? 'bg-card2 text-muted' : 'bg-social text-white'}`}>
      {following ? t('已关注') : label || t('关注')}
    </button>
  )
}
