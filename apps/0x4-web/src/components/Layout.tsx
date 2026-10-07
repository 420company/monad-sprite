// Main UI shell: content area + bottom tab bar
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
  // The red dot on "community": unread in groups + DMs + "0x4 official" announcements
  const communityUnread = useCommunityUnread()
  const { pathname } = useLocation()
  // Group / DM / post-thread pages (fixed comment input at bottom): hide the tab bar, pin the content area to remaining height, scroll inside the page
  const chatMode = pathname.startsWith('/g/') || pathname.startsWith('/dm/') || pathname.startsWith('/room/') || pathname.startsWith('/post/')
  // Full-screen pages subtract --kb-h (the height still covered by the keyboard); the input bar hugs the keyboard top. 0 when the app's WebView already shrank with the keyboard
  return (
    <div data-fullscreen-layout={chatMode || undefined} className={`flex flex-col ${chatMode ? 'h-[calc(100dvh-var(--kb-h,0px))] overflow-hidden' : 'min-h-full'}`}>
      {offline && (
        <div className="safe-top border-b border-line bg-card" role="status">
          <div className="page-gutter flex items-center gap-2 py-2 text-[13px] text-warning"><WifiOff size={15} className="shrink-0" />{t('行情连接中断，价格可能已过期')}</div>
        </div>
      )}
      {/* Back-navigation restores the scroll position from when you left; newly entered pages start at top */}
      <ScrollRestorer />
      <main id="main-content" className={chatMode ? 'min-h-0 flex-1' : 'min-w-0 flex-1 pb-[calc(6rem+env(safe-area-inset-bottom))]'}>
        <Outlet />
        <ProposalSheet />
      </main>
      {/* Bottom nav: capsule shape (2026-09-25 goat: keep the capsule, hug the bottom, no content peeking below).
   2026-09-29 goat reported on a real device "not at the very bottom, other pages peek out below": capsule
   moved down 12px (~14px from the Home indicator), the "floor" behind it became the page background color,
   and the capsule's top edge went fully opaque (see index.css .nav-floor) */}
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
