// Small tag next to the name on profiles: admins show "Official", support shows "Support". Regular users show nothing.
// Not placed in lists — the avatar's glow border is the marker there; the extra word on profiles helps users confirm who they're talking to.
// Identity shares the same source as the avatar border (lib/staffBadges → server) — never nicknames or self-claimed addresses.
import { useEffect } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useStaffBadges } from '@/lib/staffBadges'
import { t } from '@/lib/i18n'

export default function StaffTag({ address }: { address?: string | null }) {
  const role = useStaffBadges((s) => (address ? s.roles[address] ?? null : null))
  const ensure = useStaffBadges((s) => s.ensure)
  useEffect(() => { if (address) ensure(address) }, [address, ensure])
  if (!role) return null
  const label = role === 'admin' ? t('官方') : t('客服')
  return (
    <span
      data-staff-tag={role}
      title={role === 'admin' ? t('0x4 官方工作人员') : t('0x4 官方客服')}
      className="staff-tag inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold"
    ><ShieldCheck size={13} strokeWidth={2.2} aria-hidden="true" />{label}</span>
  )
}
