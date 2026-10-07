// 手机浏览器打开网页版（窄屏）时社区的一排标签（2026-10-03 goat：「为什么手机看没有流媒体」）。
// 手机 App 的直播在底部单独一个「直播」标签；网页版底部是 行情 / 现货 / 合约 / 社区 / 小精灵，宽屏把流媒体放在社区左侧菜单里，
// 窄屏用的是手机版社区页，原来只有 动态 / 消息 / 好友 / 排行，就找不到流媒体和群组。网页版窄屏在社区页和流媒体页（/live）顶上都放这一排，互相切换。
// 只在网页版用；手机 App 照旧四个标签 + 底部「直播」。
import { useNavigate } from 'react-router-dom'
import { t } from '@/lib/i18n'
import { pageStore } from '@/lib/pageState'

/** clubs = 群组（我的群 / 发现群 / 建群，10/03 goat「手机里还看不到群组」；手机 App 的群组在「消息」里，网页版单独一个标签，和宽屏左边菜单对应） */
export type CommunityTab = 'feed' | 'groups' | 'clubs' | 'friends' | 'rank'
const ITEMS: { k: CommunityTab | 'live'; label: () => string }[] = [
  { k: 'feed', label: () => t('动态') },
  { k: 'live', label: () => t('流媒体') },
  { k: 'groups', label: () => t('消息') },
  { k: 'clubs', label: () => t('群组') },
  { k: 'friends', label: () => t('好友') },
  { k: 'rank', label: () => t('排行') },
]

/** active：当前在哪个；onTab：在社区页里切换（不传 = 在流媒体页，点了回社区页对应标签）；unread：消息上的红点 */
export default function CommunityTabs({ active, onTab, unread = 0 }: { active: CommunityTab | 'live'; onTab?: (k: CommunityTab) => void; unread?: number }) {
  const nav = useNavigate()
  const go = (k: CommunityTab | 'live') => {
    if (k === active) return
    if (k === 'live') { nav('/live'); return }
    if (onTab) { onTab(k); return }
    pageStore.set('community.tab', k)   // 社区页按这个记住的标签打开（Community.tsx 的 usePageState 同一个键）
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
