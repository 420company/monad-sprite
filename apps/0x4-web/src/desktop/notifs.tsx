// 网页版通知（2026-09-29 goat：电脑端点通知还是手机页面）：顶栏铃铛的下拉面板 + /notifications 电脑页共用的一行和分类。
// 数据还是社交层 store 里那一份（loadNotifications / markNotifsRead），点一条和手机一样按 ref 跳到对应页面（lib/notifRef）。
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

/** 通知类型图标：和手机通知页同一套线条图标 */
const ICON: Record<string, LucideIcon> = { friend: Users, follow: UserPlus, comment: MessageSquare, join_request: Mail, join_approved: CircleCheck, join_rejected: Ban, gift: Gift, mention: AtSign, dm: Lock, packet: Gift, system: Megaphone }

export type NotifTab = 'all' | 'social' | 'system'
/** 分类：系统 = 平台公告、审核结果；其余（关注、评论、@、私信、礼物、入群申请……）算互动 */
const SYSTEM = new Set(['system', 'join_approved', 'join_rejected'])
export const notifGroup = (type: string): Exclude<NotifTab, 'all'> => (SYSTEM.has(type) ? 'system' : 'social')
export const filterNotifs = (list: Notification[], tab: NotifTab) => tab === 'all' ? list : list.filter((n) => notifGroup(n.type) === tab)
/** 页签：label 是函数，渲染时才翻译（切换语言后跟着变） */
export const NOTIF_TABS: [NotifTab, () => string][] = [['all', () => t('全部')], ['social', () => t('互动')], ['system', () => t('系统')]]

/** 一条通知：有人触发的显示对方头像 + 类型角标，系统通知显示类型图标；未读带底色和小圆点 */
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

/** 点一条：标已读，和系统推送同一套规则跳过去 */
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

/** 社区没登录上时（通知来自社区服务）：登录中转圈，失败说原因 +「重新登录」 */
export function NotifOffline() {
  return <SocialLogin row={false} tall />
}

/** 顶栏铃铛的下拉面板（380 宽）：全部 / 互动 / 系统，最多先列 20 条，底部「查看全部」进电脑端通知页 */
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
