// 网页版「通知」（/notifications，顶栏铃铛下拉里点「查看全部」进来。2026-09-29 goat：「通知也是（手机页面）」）。
// 版式：中间一栏 720 宽列表（docs/WEB_DESIGN.md），页签 全部 / 互动 / 系统，右上「全部已读」和「通知设置」。
// 数据还是社交层 store 里那一份（和手机通知页、铃铛下拉一样），点一条按 ref 跳到对应页面。
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Bell, CheckCheck, Settings as SettingsIcon } from 'lucide-react'
import { useSocial } from '@/store/social'
import { t } from '@/lib/i18n'
import { oneOf, usePageState } from '@/lib/pageState'
import { Empty } from '../ui'
import { NOTIF_TABS, NotifOffline, NotifRow, filterNotifs, notifGroup, useOpenNotif, type NotifTab } from '../notifs'

export default function NotificationsDesk() {
  const { status, notifications, unreadNotifs, loadNotifications, markNotifsRead } = useSocial()
  const ready = status === 'ready'
  const [tab, setTab] = usePageState<NotifTab>('desk.notif.tab', 'all', oneOf('all', 'social', 'system'))
  useEffect(() => { if (ready) void loadNotifications() }, [ready, loadNotifications])
  const open = useOpenNotif()
  const list = filterNotifs(notifications, tab)
  const unreadOf = (k: NotifTab) => notifications.filter((n) => !n.read && (k === 'all' || notifGroup(n.type) === k)).length
  return (
    <div className="wc-page">
      <div className="wc-col720">
        <header className="wc-head">
          <div>
            <h1 className="wc-title">{t('通知')}</h1>
            <p className="wc-sub">{ready && unreadNotifs > 0 ? t('{n} 条未读', { n: unreadNotifs }) : t('关注、评论、@ 和系统消息都在这里。')}</p>
          </div>
          <div className="wc-head-act">
            {ready && unreadNotifs > 0 && <button type="button" className="wc-btn is-sm" onClick={() => void markNotifsRead()}><CheckCheck size={14} />{t('全部已读')}</button>}
            <Link to="/settings?tab=notify" className="wc-btn is-sm"><SettingsIcon size={14} />{t('通知设置')}</Link>
          </div>
        </header>
        <section className="wc-panel is-clip">
          <div className="wc-tabs" role="tablist" aria-label={t('通知分类')}>
            {NOTIF_TABS.map(([k, label]) => {
              const n = ready ? unreadOf(k) : 0
              return <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label()}{n > 0 && <span className="wc-badge">{n > 99 ? '99+' : n}</span>}</button>
            })}
          </div>
          {!ready ? <NotifOffline />
            : !list.length ? <Empty tall icon={Bell} text={tab === 'system' ? t('还没有系统通知') : tab === 'social' ? t('还没有互动') : t('还没有通知')} />
              : <div>{list.map((n) => <NotifRow key={n.id} n={n} onOpen={open} />)}</div>}
        </section>
      </div>
    </div>
  )
}
