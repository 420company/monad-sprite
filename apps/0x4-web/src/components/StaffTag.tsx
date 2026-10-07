// 个人主页名字旁的小标签：管理员显示「官方」，客服显示「客服」。普通用户什么都不显示。
// 列表里不放这个标签，头像的发光边框就是标识；主页上多一个字，方便用户确认对方身份。
// 身份和头像边框同一个来源（lib/staffBadges → 服务端），不看昵称、不看自报的地址。
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
