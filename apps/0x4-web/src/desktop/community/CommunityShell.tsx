// Web "Community" shell (2026-10-01 goat community merge; desktop mock "community merge preview - beautified"):
// The top bar's old "Streams" and "Rankings" merged into Community. A fixed left menu: Feed · Streams (live room count) · Rankings — Messages (unread count) · Groups,
// (2026-10-03 goat: livestreams and meetings merged into one "Streams" entry, switching live / meetings inside the page — see StreamHead.tsx)
// Below: "Post" (pops a composer, postable from any page); at the very bottom, me (nickname, following, followers). The right side swaps content.
// Each item has its own address (/community, /live, /meetings, /rank, /messages, /groups) — previously shared /live and /rank links still open.
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

/** Notify the feed page to refresh after a successful post (the feed page subscribes to this counter) */
const postedListeners = new Set<() => void>()
export function onPosted(fn: () => void) { postedListeners.add(fn); return () => { postedListeners.delete(fn) } }

export default function CommunityShell({ children }: { children: ReactNode }) {
  useLiveRoomsPoll()
  const nav = useNavigate()
  const liveCount = useLiveRooms((s) => s.rooms?.length ?? 0)
  const unread = useCommunityUnread()
  const [composing, setComposing] = useState(false)
  // "Streams" counts as selected on both the livestream and meeting pages
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

/** Bottom-left me: avatar, nickname, following / followers (/api/users/:address/social); hidden when not logged in */
function MeCard() {
  const me = useSocial((s) => s.me)
  const ready = useSocial((s) => s.status === 'ready')
  const [stats, setStats] = useState<{ followers: number; following: number } | null>(null)
  useEffect(() => {
    if (!me || !ready) { setStats(null); return }
    let alive = true
    api<{ followers: number; following: number }>(`/api/users/${me.address}/social`).then((s) => { if (alive) setStats({ followers: s.followers ?? 0, following: s.following ?? 0 }) }).catch(() => { /* Just hides two numbers */ })
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

/** Subtitle row: title + subtitle on the left, buttons on the right (the header of the live / meeting / ranking pages) */
export function CmHead({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <header className="cm-head">
      <div><h2 className="cm-title">{title}</h2>{sub && <p className="cm-sub">{sub}</p>}</div>
      {right && <div className="cm-head-r">{right}</div>}
    </header>
  )
}

