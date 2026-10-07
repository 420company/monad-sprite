// Group profile-card badges (2026-09-25 goat): only two roles wear them — Owner (group owner; goat found the original Chinese label too low-brow) and MOD (group admin). Regular members show nothing.
// Owner: gold gradient + crown; MOD: blue-violet gradient + shield. Separate from staff's avatar glow borders — no conflict.
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
