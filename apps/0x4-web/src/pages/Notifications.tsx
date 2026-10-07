// 通知中心：新粉丝、入群申请、申请结果、礼物、@ 提及、私信
import { useEffect } from 'react'
import { pathForNotif } from '@/lib/notifRef'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, AtSign, Ban, Bell, CheckCheck, CircleCheck, Gift, Lock, Mail, Megaphone, Radio, UserPlus, Users, type LucideIcon } from 'lucide-react'
import { renderServerText } from '@/lib/sysText'
import Avatar from '@/components/Avatar'
import { timeAgo } from '@/lib/format'
import { useSocial } from '@/store/social'
import type { Notification } from '@/lib/social'
import { t } from '@/lib/i18n'
import { useBack } from '@/lib/useBack'

// 通知类型图标：线条图标，和 App 其它地方一致（2026-09-25 从 emoji 换过来）
const ICON: Record<string, LucideIcon> = { friend: Users, follow: UserPlus, join_request: Mail, join_approved: CircleCheck, join_rejected: Ban, gift: Gift, mention: AtSign, dm: Lock, packet: Gift, system: Megaphone, live: Radio }

export default function Notifications() {
  const nav = useNavigate()
  // 返回：有上一页退回上一页（上一页的状态 / 滚动都会还原），推送 / 深链直接打开的去 /
  const back = useBack('/')
  const { notifications, unreadNotifs, loadNotifications, markNotifsRead } = useSocial()
  useEffect(() => { loadNotifications() }, [loadNotifications])

  const open = (n: Notification) => {
    markNotifsRead(n.id)
    // 与点系统推送走同一套规则
    const path = pathForNotif(n)
    if (path !== '/notifications') nav(path)
  }

  return (
    <div className="safe-top px-4 pt-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><button onClick={back} className="-ml-2 rounded-full p-2 text-muted"><ArrowLeft size={22} /></button><h1 className="text-2xl font-bold">{t('通知')}</h1></div>
        {unreadNotifs > 0 && <button onClick={() => markNotifsRead()} className="flex items-center gap-1 text-xs text-accent"><CheckCheck size={14} /> {t('全部已读')}</button>}
      </div>
      <div className="mt-3 divide-y divide-line">
        {notifications.map((n) => { const Icon = ICON[n.type] || Bell; return (
          <button key={n.id} onClick={() => open(n)} className={`flex w-full items-start gap-3 py-3 text-left ${n.read ? '' : 'bg-accent/5'}`}>
            {n.actor ? <Avatar address={n.actor} src={n.actorAvatar} name={n.actorNickname} size={40} /> : <span className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-muted"><Icon size={18} /></span>}
            <div className="min-w-0 flex-1">
              <div className="text-sm">{n.actor && <Icon size={14} className="mr-1 inline-block align-[-2px] text-muted" aria-hidden="true" />}{renderServerText(n.text, n.key, n.params)}</div>
              <div className="mt-0.5 text-[11px] text-muted">{timeAgo(n.createdAt)}</div>
            </div>
            {!n.read && <span className="mt-2 h-2 w-2 rounded-full bg-accent" />}
          </button>
        ) })}
        {!notifications.length && <div className="py-16 text-center text-sm text-muted"><Bell className="mx-auto mb-2" size={28} />{t('还没有通知')}</div>}
      </div>
    </div>
  )
}
