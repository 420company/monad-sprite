// 主界面外壳：内容区 + 底部 Tab 栏
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Compass, Wallet, MessageCircle, User, Radio, WifiOff } from 'lucide-react'
import { useMarket } from '@/store/market'
import ProposalSheet from './ProposalSheet'
import ScrollRestorer from './ScrollRestorer'
import { t } from '@/lib/i18n'
import { useCommunityUnread } from '@/store/announcements'

const tabs = [
  { to: '/', label: '资产', icon: Wallet },
  { to: '/discover', label: '发现', icon: Compass },
  { to: '/community', label: '社区', icon: MessageCircle },
  { to: '/live', label: '直播', icon: Radio },
  { to: '/settings', label: '我', icon: User },
]

export default function Layout() {
  const offline = useMarket((s) => s.offline)
  // 「社区」上的红点：群 + 私信 + 「0x4 官方」公告有未读
  const communityUnread = useCommunityUnread()
  const { pathname } = useLocation()
  // 群聊 / 私信页 / 动态对话页（底部固定评论输入框）：隐藏 Tab 栏，内容区固定为剩余高度，由页面内部滚动
  const chatMode = pathname.startsWith('/g/') || pathname.startsWith('/dm/') || pathname.startsWith('/room/') || pathname.startsWith('/post/')
  // 整屏页面减掉 --kb-h（键盘仍压住的高度），输入栏贴在键盘上方；App 里 WebView 已随键盘变矮时它是 0
  return (
    <div data-fullscreen-layout={chatMode || undefined} className={`flex flex-col ${chatMode ? 'h-[calc(100dvh-var(--kb-h,0px))] overflow-hidden' : 'min-h-full'}`}>
      {offline && (
        <div className="safe-top border-b border-line bg-card" role="status">
          <div className="page-gutter flex items-center gap-2 py-2 text-[13px] text-warning"><WifiOff size={15} className="shrink-0" />{t('行情连接中断，价格可能已过期')}</div>
        </div>
      )}
      {/* 后退回到页面时恢复离开时的滚动位置，新进入的页面从顶部开始 */}
      <ScrollRestorer />
      <main id="main-content" className={chatMode ? 'min-h-0 flex-1' : 'min-w-0 flex-1 pb-[calc(6rem+env(safe-area-inset-bottom))]'}>
        <Outlet />
        <ProposalSheet />
      </main>
      {/* 底部导航：胶囊形状（2026-09-25 goat：保持胶囊，只是要贴近底部、下面不能露出内容）。
          2026-09-29 goat 真机又反馈「没在最底部、底部露出别的页面」：胶囊再往下挪 12px（离 Home 指示条约 14px），
          胶囊后面的「地板」改成页面底色、胶囊上沿往下完全不透明（见 index.css .nav-floor） */}
      {!chatMode && <div className="nav-floor pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pt-6 pb-[max(8px,calc(env(safe-area-inset-bottom)-12px))]">
        <nav aria-label={t('主导航')} className="app-nav glass pointer-events-auto mx-auto max-w-[456px] px-1">
          <div className="grid grid-cols-5">
            {tabs.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className="nav-tab"
              >
                <span className="relative inline-flex">
                  <Icon size={21} strokeWidth={1.8} aria-hidden="true" />
                  {to === '/community' && communityUnread > 0 && <span data-nav-unread="" aria-label={t('{n} 条未读', { n: communityUnread })} className="absolute -top-0.5 -right-1 h-2 w-2 rounded-full bg-accent ring-2 ring-bg" />}
                </span>
                {t(label)}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>}
    </div>
  )
}
