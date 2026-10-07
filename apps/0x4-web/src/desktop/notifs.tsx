// Web notifications (2026-09-29 goat: desktop notification taps still opened phone pages): one shared row + category set for the top-bar bell dropdown and the /notifications desktop page.
// Data still comes from the social store (loadNotifications / markNotifsRead); tapping one jumps by ref to the matching page, same as phone (lib/notifRef).
import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AtSign, Ban, Bell, CheckCheck, CircleCheck, Gift, Lock, Mail, Megaphone, MessageSquare, UserPlus, Users, type LucideIcon } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { renderServerText } from '@/lib/sysText'
import { pathForNotif } from '@/lib/notifRef'
import type { Notification } from '@/lib/social'
import { timeAgo } from '@/lib/format'
import { useSocial } from '@/store/social'
import { t } from '@/lib/i18n'
import { Empty, SocialLogin } from './ui'

/** Notification-type icons: same line-icon set as the phone notifications page */
const ICON: Record<string, LucideIcon> = { friend: Users, follow: UserPlus, comment: MessageSquare, join_request: Mail, join_approved: CircleCheck, join_rejected: Ban, gift: Gift, mention: AtSign, dm: Lock, packet: Gift, system: Megaphone }

export type NotifTab = 'all' | 'social' | 'system'
/** Categories: system = platform announcements, review results; everything else (follows, comments, @, DMs, gifts, group join requests…) counts as interaction */
const SYSTEM = new Set(['system', 'join_approved', 'join_rejected'])
export const notifGroup = (type: string): Exclude<NotifTab, 'all'> => (SYSTEM.has(type) ? 'system' : 'social')
export const filterNotifs = (list: Notification[], tab: NotifTab) => tab === 'all' ? list : list.filter((n) => notifGroup(n.type) === tab)
/** Tabs: label is a function, translated at render time (follows language switches) */
export const NOTIF_TABS: [NotifTab, () => string][] = [['all', () => t('全部')], ['social', () => t('互动')], ['system', () => t('系统')]]

/** One notification: user-triggered ones show the peer avatar + type badge; system ones show the type icon; unread gets tint + dot */
export function NotifRow({ n, onOpen }: { n: Notification; onOpen: (n: Notification) => void }) {
  const Icon = ICON[n.type] || Bell
  return (
    <button type="button" className={`wc-notif ${n.read ? '' : 'is-unread'}`} onClick={() => onOpen(n)}>
      <span className="wc-notif-ic">
        {n.actor
          ? <><Avatar address={n.actor} src={n.actorAvatar} name={n.actorNickname} size={36} /><span className="wc-notif-kind" aria-hidden="true"><Icon size={11} /></span></>
          : <span className="wc-notif-glyph" aria-hidden="true"><Icon size={16} /></span>}
      </span>
      <span className="wc-notif-body">
        {renderServerText(n.text, n.key, n.params)}
        <time dateTime={new Date(n.createdAt).toISOString()}>{timeAgo(n.createdAt)}</time>
      </span>
      {!n.read && <span className="wc-notif-dot" aria-label={t('未读')} />}
    </button>
  )
}

/** Tap one: mark read, jump with the same rules as system push */
export function useOpenNotif(after?: () => void) {
  const nav = useNavigate()
  const markNotifsRead = useSocial((s) => s.markNotifsRead)
  return (n: Notification) => {
    void markNotifsRead(n.id)
    const path = pathForNotif(n)
    after?.()
    if (path !== '/notifications') nav(path)
  }
}

/** When community isn't logged in (notifications come from the community service): spinner while logging in, reason + "sign in again" on failure */
export function NotifOffline() {
  return <SocialLogin row={false} tall />
}

/** Top-bar bell dropdown (380px): all / interactions / system, 20 max initially, bottom "view all" opens the desktop notifications page */
export function NotifPanel({ tab, setTab, onClose }: { tab: NotifTab; setTab: (t: NotifTab) => void; onClose: () => void }) {
  const { status, notifications, unreadNotifs, loadNotifications, markNotifsRead } = useSocial()
  const ready = status === 'ready'
  useEffect(() => { if (ready) void loadNotifications() }, [ready, loadNotifications])
  const open = useOpenNotif(onClose)
  const list = filterNotifs(notifications, tab)
  return (
    <div className="desk-pop desk-notif" role="dialog" aria-label={t('通知')}>
      <div className="desk-notif-head">
        <b>{t('通知')}</b>
        {ready && unreadNotifs > 0 && <button type="button" className="wc-btn is-ghost is-sm" onClick={() => void markNotifsRead()}><CheckCheck size={14} />{t('全部已读')}</button>}
      </div>
      <div className="wc-tabs" role="tablist" aria-label={t('通知分类')}>
        {NOTIF_TABS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label()}</button>)}
      </div>
      <div className="desk-notif-list">
        {!ready ? <NotifOffline />
          : !list.length ? <Empty icon={Bell} text={tab === 'system' ? t('还没有系统通知') : tab === 'social' ? t('还没有互动') : t('还没有通知')} tall />
            : list.slice(0, 20).map((n) => <NotifRow key={n.id} n={n} onOpen={open} />)}
      </div>
      <Link to="/notifications" className="desk-notif-foot" onClick={onClose}>{t('查看全部')}</Link>
    </div>
  )
}
