// 铃铛：未读通知数
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { useSocial } from '@/store/social'
import { t } from '@/lib/i18n'

export default function BellButton() {
  const nav = useNavigate()
  const { unreadNotifs, pendingRequests, status } = useSocial()
  if (status !== 'ready') return null
  // 入群申请本身也会生成一条通知，取两者较大值避免重复计数
  const n = Math.max(unreadNotifs, pendingRequests)
  return (
    <button onClick={() => nav('/notifications')} className="relative rounded-full p-2 text-muted" aria-label={t('通知')}>
      <Bell size={20} />
      {n > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-down px-1 text-center text-[10px] font-bold text-white">{n > 99 ? '99+' : n}</span>}
    </button>
  )
}
