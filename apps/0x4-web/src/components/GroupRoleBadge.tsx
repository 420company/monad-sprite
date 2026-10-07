// 群里的名片勋章（2026-09-25 goat）：只有两种人带，Owner（群主，goat 嫌「群主」两个字 low）和 MOD（群管理员）。普通成员什么都不显示。
// 群主：金色渐变 + 皇冠；MOD：蓝紫渐变 + 盾牌。和官方人员的头像发光边框是两套东西，互不冲突。
import { Crown, Shield } from 'lucide-react'

export default function GroupRoleBadge({ role, size = 'sm' }: { role?: string | null; size?: 'sm' | 'md' }) {
  if (role !== 'owner' && role !== 'admin') return null
  const owner = role === 'owner'
  const cls = size === 'md' ? 'gap-1 px-2 py-0.5 text-[11px]' : 'gap-0.5 px-1.5 py-px text-[10px]'
  const icon = size === 'md' ? 12 : 10
  return (
    <span data-group-role={role} className={`inline-flex shrink-0 items-center rounded-full font-bold leading-4 ${cls} ${owner ? 'group-badge-owner' : 'group-badge-mod'}`}>
      {owner ? <Crown size={icon} strokeWidth={2.4} aria-hidden="true" /> : <Shield size={icon} strokeWidth={2.4} aria-hidden="true" />}
      {owner ? 'Owner' : 'MOD'}
    </span>
  )
}
