// The row of community tabs on narrow screens (web opened in a phone browser) (2026-10-03 goat: "why is there no streaming on phones").
// The mobile app has a dedicated "Live" tab at the bottom; the web bottom bar is markets / spot / perps / community / sprite, and wide screens put streaming in the community's left menu,
// while narrow screens use the mobile community page, which only had feed / messages / friends / rankings — streaming and groups were unreachable. Narrow web places this row atop both the community page and the streaming page (/live) to switch between them.
// Web-only; the mobile app keeps its four tabs + the bottom "Live".
import { useNavigate } from 'react-router-dom'
import { t } from '@/lib/i18n'
import { pageStore } from '@/lib/pageState'

/** clubs = groups (my groups / discover / create, 10/03 goat: "groups still invisible on phones"; the mobile app's groups live under "messages", web gives them their own tab matching the wide-screen left menu) */
export type CommunityTab = 'feed' | 'groups' | 'clubs' | 'friends' | 'rank'
const ITEMS: { k: CommunityTab | 'live'; label: () => string }[] = [
  { k: 'feed', label: () => t('动态') },
  { k: 'live', label: () => t('流媒体') },
  { k: 'groups', label: () => t('消息') },
  { k: 'clubs', label: () => t('群组') },
  { k: 'friends', label: () => t('好友') },
  { k: 'rank', label: () => t('排行') },
]

/** active: the current tab; onTab: switch within the community page (absent = on the streaming page, tapping returns to the community page's tab); unread: the red dot on messages */
export default function CommunityTabs({ active, onTab, unread = 0 }: { active: CommunityTab | 'live'; onTab?: (k: CommunityTab) => void; unread?: number }) {
  const nav = useNavigate()
  const go = (k: CommunityTab | 'live') => {
    if (k === active) return
    if (k === 'live') { nav('/live'); return }
    if (onTab) { onTab(k); return }
    pageStore.set('community.tab', k)   // The community page opens on this remembered tab (same key as Community.tsx's usePageState)
    nav('/community')
  }
  return (
    <div className="page-gutter grid grid-cols-6 gap-0.5 border-b border-line" role="group" aria-label={t('社区视图')}>
      {ITEMS.map(({ k, label }) => <button key={k} type="button" onClick={() => go(k)} aria-pressed={active === k} className="view-tab relative">
        {label()}
        {k === 'groups' && unread > 0 && <span aria-label={t('{n} 条未读', { n: unread })} className="absolute top-1 right-0 h-1.5 w-1.5 rounded-full bg-accent" />}
      </button>)}
    </div>
  )
}
