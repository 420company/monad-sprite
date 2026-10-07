// 统一消息列表：群、私信、代币社区，按最后消息排序，带未读数与筛选。
// 有全员公告时最上面固定一个「0x4 官方」会话（store/announcements），无论别的会话多新都置顶（lib/chatOrder）。
// 会话数据本来就在本地 store 里（未读数、实时消息都靠它），这里只做分批渲染：先画 30 个，滚到底再画下一批，
// 几百个会话也不会一次铺满几百行 DOM
import { useMemo } from 'react'
import { NavLink } from 'react-router-dom'
import { Lock, MessageCircle, RefreshCw, Video, WifiOff } from 'lucide-react'
import Avatar from './Avatar'
import OfficialBadge from './OfficialBadge'
import { timeAgo, shortId } from '@/lib/format'
import { useSocial } from '@/store/social'
import { parseDmMedia, mediaLabel } from '@/lib/dmMedia'
import { t } from '@/lib/i18n'
import { oneOf, usePageState } from '@/lib/pageState'
import { renderSysMessage } from '@/lib/sysText'
import { EmptyState, Pager, usePager } from './ListState'
import UserName from './UserName'
import { useAnnouncements } from '@/store/announcements'
import { officialPreview, orderChats } from '@/lib/chatOrder'

const CHAT_PAGE = 30

type Filter = 'all' | 'group' | 'dm'

export default function ChatList({ loading = false, failed = false, onRetry }: { loading?: boolean; failed?: boolean; onRetry?: () => void }) {
  const { status, myGroups, lastMsg, unreadGroup, dms, unreadDm, dmPeers, details } = useSocial()
  const announcements = useAnnouncements((s) => s.list)
  const announceUnread = useAnnouncements((s) => s.unread)
  // 筛选和已显示条数记在会话里：点进群 / 私信再返回还是原样（lib/pageState）
  const [filter, setFilter] = usePageState<Filter>('chats.filter', 'all', oneOf('all', 'group', 'dm'))

  const items = useMemo(() => {
    const rows: { key: string; to: string; title: string; sub: string; ts: number; unread: number; avatarAddr: string; avatar?: string | null; kind: 'group' | 'dm' | 'token' | 'announce'; gated?: boolean; official?: boolean; pinned?: boolean; meeting?: boolean }[] = []
    for (const g of myGroups) {
      const m = lastMsg[g.id]
      const name = m ? (details[g.id]?.members.find((x) => x.address === m.from)?.nickname || (m.from === 'system' ? '' : shortId(m.from))) : ''
      rows.push({ key: 'g' + g.id, to: `/g/${g.id}`, title: g.name, sub: m ? `${name ? name + '：' : ''}${Array.isArray(m.meta?.images) && (m.meta.images as unknown[]).length > 1 ? t('[图片] ×{n}', { n: (m.meta.images as unknown[]).length }) : m.kind === 'image' ? t('[图片]') : m.kind === 'video' ? t('[视频]') : m.kind === 'voice' ? t('[语音]') : m.kind === 'system' ? renderSysMessage(m) : m.text}` : g.description || t('还没有消息'), ts: m?.ts || g.createdAt, unread: unreadGroup[g.id] || 0, avatarAddr: g.id, avatar: g.avatar, kind: g.token ? 'token' : 'group', gated: !!g.gate, official: g.official === true, meeting: !!g.meeting })
    }
    for (const [peer, list] of Object.entries(dms)) {
      const last = list[list.length - 1]
      if (!last) continue
      const lm = parseDmMedia(last.text)
      // 会话对方的资料来自服务器会话列表；没有时用地址缩写（EVM 优先）
      const p = dmPeers[peer]
      const sub = last.locked ? t('解锁后查看') : last.undecryptable ? t('无法解密') : last.legacy ? t('这条消息在旧版本发送') : lm ? mediaLabel(lm) : last.text
      rows.push({ key: 'd' + peer, to: `/dm/${peer}`, title: p?.nickname || shortId(p?.evmAddress || peer), sub, ts: last.ts, unread: unreadDm[peer] || 0, avatarAddr: peer, avatar: p?.avatar, kind: 'dm' })
    }
    const shown = rows.filter((r) => filter === 'all' || (filter === 'group' ? r.kind !== 'dm' : r.kind === filter))
    // 「0x4 官方」：只读的公告会话，算在私信一类（「群聊」筛选里不出现）
    const off = officialPreview(announcements)
    if (off && filter !== 'group') shown.push({ key: 'official', to: '/official', title: t('0x4 官方'), sub: off.sub, ts: off.ts, unread: announceUnread, avatarAddr: 'official', kind: 'announce', official: true, pinned: true })
    return orderChats(shown)
  }, [myGroups, lastMsg, unreadGroup, dms, unreadDm, dmPeers, details, filter, announcements, announceUnread])

  // 每页最多 30 条，切筛选回到第 1 页
  const pager = usePager(items, { reset: filter, size: CHAT_PAGE })
  return (
    <section aria-label={t('会话列表')}>
      <div ref={pager.anchor} className="scroll-mt-20" />
      <div className="page-gutter grid grid-cols-4 gap-1 pt-3" role="group" aria-label={t('会话类型')}>
        {([['all', '全部'], ['group', '群聊'], ['dm', '私信']] as const).map(([k, l]) => <button key={k} onClick={() => { setFilter(k) }} aria-pressed={filter === k} className={`min-h-11 rounded-lg px-1 text-sm ${filter === k ? 'bg-card2 font-semibold text-fg' : 'text-muted'}`}>{t(l)}</button>)}
      </div>
      {failed && <div className="page-gutter status-notice" role="status"><WifiOff size={16} className="shrink-0" /><span className="flex-1">{items.length ? t('消息列表暂时无法更新，显示的是已有记录') : t('暂时无法加载会话')}</span><button onClick={onRetry} className="icon-button" aria-label={t('重新加载')} data-tooltip={t('重试')}><RefreshCw size={18} /></button></div>}
      <div className="page-gutter mt-2 divide-y divide-line/60">
        {pager.pageItems.map((r) => (
          // NavLink：当前打开的会话自动带 aria-current="page"（网页版电脑端左栏据此高亮；手机列表页不会命中）
          <NavLink key={r.key} to={r.to} className="flex min-h-22 items-center gap-3 py-4 active:bg-card">
            {r.kind === 'announce' ? <OfficialAvatar size={44} /> : <Avatar address={r.avatarAddr} src={r.avatar} name={r.title} size={44} />}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">{r.kind === 'dm' ? <UserName address={r.avatarAddr} name={r.title} className="truncate text-[15px] font-semibold" /> : r.kind === 'announce' ? <span className="staff-name truncate text-[15px] font-semibold" data-staff-name="admin" data-official-chat="">{r.title}</span> : <span className="truncate text-[15px] font-semibold">{r.title}</span>}{r.official && <OfficialBadge size={16} className="-ml-0.5" label={r.kind === 'announce' ? t('0x4 官方认证') : undefined} />}{(r.gated || r.kind === 'dm') && <Lock size={12} className="shrink-0 text-muted" aria-label={r.kind === 'dm' ? t('加密私信') : t('入群门槛')} />}{r.meeting && <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-up/15 px-1.5 py-px text-[10px] font-semibold text-up"><Video size={10} aria-hidden="true" />{t('会议中')}</span>}<span className="ml-auto shrink-0 text-xs text-muted">{timeAgo(r.ts)}</span></div>
              <div className="mt-1 flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-[13px] text-muted">{r.sub}</span>{r.unread > 0 && <span aria-label={t('{n} 条未读', { n: r.unread })} className="number flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-bg">{r.unread > 99 ? '99+' : r.unread}</span>}</div>
            </div>
          </NavLink>
        ))}
        {loading && !items.length && <div className="space-y-3 py-4" role="status" aria-label={t('正在加载会话')}><div className="skeleton h-16" /><div className="skeleton h-16" /></div>}
        {!items.length && !loading && !failed && status === 'ready' && <EmptyState icon={MessageCircle} title={t({ all: '还没有会话', group: '还没有群聊', token: '还没有加入代币群', dm: '还没有私信' }[filter])} />}
      </div>
      <Pager p={pager} className="page-gutter" />
    </section>
  )
}

/** 「0x4 官方」的头像：品牌猫头 logo（public/icons/cat.svg），公告页标题栏也用它 */
export function OfficialAvatar({ size }: { size: number }) {
  return <span className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-card2" style={{ width: size, height: size }}><img src={`${import.meta.env.BASE_URL}icons/cat.svg`} alt="" width={size * 0.72} height={size * 0.72} draggable={false} /></span>
}
