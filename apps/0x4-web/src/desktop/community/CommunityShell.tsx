// 网页版「社区」外框（2026-10-01 goat 社区合并，设计稿桌面「社区合并预览-美化版」）：
// 原来顶栏的「流媒体」「排行」并进社区。左边固定一列菜单：动态 · 流媒体（正在直播的房间数）· 排行 —— 消息（未读数）· 群组，
// （2026-10-03 goat：直播和会议合成一个入口「流媒体」，页里切换直播 / 会议，见 StreamHead.tsx）
// 下面「发动态」（弹窗发，任何一页都能发），最底下是我（昵称、关注、粉丝）。右边换内容。
// 每一项是自己的地址（/community、/live、/meetings、/rank、/messages、/groups），以前分享出去的 /live、/rank 照样能打开。
import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ListTree, MessageCircle, Radio, SquarePen, Trophy, UserRound, Users } from 'lucide-react'
import Avatar from '@/components/Avatar'
import Sheet from '@/components/Sheet'
import { PostComposer } from '@/components/Posts'
import { toast } from '@/components/Toast'
import { api } from '@/lib/social'
import { t } from '@/lib/i18n'
import { useSocial, displayName } from '@/store/social'
import { useCommunityUnread } from '@/store/announcements'
import { needWallet } from '../walletGate'
import { useLiveRooms, useLiveRoomsPoll } from '../liveRooms'
import './community.css'

/** 发动态成功后通知动态页刷新（动态页订阅这个计数） */
const postedListeners = new Set<() => void>()
export function onPosted(fn: () => void) { postedListeners.add(fn); return () => { postedListeners.delete(fn) } }

export default function CommunityShell({ children }: { children: ReactNode }) {
  useLiveRoomsPoll()
  const nav = useNavigate()
  const liveCount = useLiveRooms((s) => s.rooms?.length ?? 0)
  const unread = useCommunityUnread()
  const [composing, setComposing] = useState(false)
  // 「流媒体」在直播页和会议页都算选中
  const { pathname } = useLocation()
  const streamOn = pathname === '/live' || pathname === '/meetings'
  const item = (to: string, icon: ReactNode, label: string, badge?: ReactNode, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => `cm-mi${isActive ? ' on' : ''}`}>
      {icon}<span>{label}</span>{badge}
    </NavLink>
  )
  return (
    <div className="cm-page">
      <aside className="cm-side" aria-label={t('社区')}>
        <h1 className="cm-side-t">{t('社区')}</h1>
        <nav className="cm-menu" aria-label={t('社区菜单')}>
          {item('/community', <ListTree size={19} aria-hidden="true" />, t('动态'), null, true)}
          <NavLink to="/live" className={() => `cm-mi${streamOn ? ' on' : ''}`} aria-current={streamOn ? 'page' : undefined}>
            <Radio size={19} aria-hidden="true" /><span>{t('流媒体')}</span>{liveCount > 0 ? <b className="cm-n is-live" aria-label={t('{n} 个房间正在直播', { n: liveCount })}>{liveCount}</b> : null}
          </NavLink>
          {item('/rank', <Trophy size={19} aria-hidden="true" />, t('排行'))}
          <span className="cm-sep" aria-hidden="true" />
          {item('/messages', <MessageCircle size={19} aria-hidden="true" />, t('消息'), unread > 0 ? <b className="cm-n is-msg" aria-label={t('{n} 条未读', { n: unread })}>{unread > 99 ? '99+' : unread}</b> : null)}
          {item('/groups', <Users size={19} aria-hidden="true" />, t('群组'))}
          {item('/friends', <UserRound size={19} aria-hidden="true" />, t('好友'))}
        </nav>
        <button type="button" className="cm-post" onClick={() => { if (!needWallet()) setComposing(true) }}><SquarePen size={17} aria-hidden="true" />{t('发动态')}</button>
        <MeCard />
      </aside>
      <div className="cm-main">{children}</div>
      <Sheet open={composing} center onClose={() => setComposing(false)} title={t('发动态')}>
        <PostComposer onPosted={() => { setComposing(false); toast.success(t('已发布')); for (const fn of postedListeners) fn(); nav('/community') }} />
      </Sheet>
    </div>
  )
}

/** 左下角的我：头像、昵称、关注 / 粉丝（/api/users/:address/social）；没登录不显示 */
function MeCard() {
  const me = useSocial((s) => s.me)
  const ready = useSocial((s) => s.status === 'ready')
  const [stats, setStats] = useState<{ followers: number; following: number } | null>(null)
  useEffect(() => {
    if (!me || !ready) { setStats(null); return }
    let alive = true
    api<{ followers: number; following: number }>(`/api/users/${me.address}/social`).then((s) => { if (alive) setStats({ followers: s.followers ?? 0, following: s.following ?? 0 }) }).catch(() => { /* 只是少显示两个数字 */ })
    return () => { alive = false }
  }, [me, ready])
  if (!me || !ready) return null
  return (
    <NavLink to={`/u/${me.address}`} className="cm-me">
      <Avatar address={me.address} src={me.avatar} name={me.nickname} size={40} />
      <span className="cm-me-t">
        <b>{displayName(me)}</b>
        <small>{stats ? t('{a} 关注 · {b} 粉丝', { a: stats.following, b: stats.followers }) : ' '}</small>
      </span>
    </NavLink>
  )
}

/** 小标题行：左边标题 + 副标题，右边按钮（直播 / 会议 / 排行三页的页头） */
export function CmHead({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <header className="cm-head">
      <div><h2 className="cm-title">{title}</h2>{sub && <p className="cm-sub">{sub}</p>}</div>
      {right && <div className="cm-head-r">{right}</div>}
    </header>
  )
}

