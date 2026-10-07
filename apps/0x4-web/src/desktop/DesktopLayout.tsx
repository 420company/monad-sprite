// Web main shell (VITE_SURFACE=web). Design spec docs/WEB_DESIGN.md (rebuilt after goat's 2026-09-29 third-round feedback):
// · Top bar spans full width: brand on the left (same cat head + pixel type as the website; clicking returns to "markets"), seven tabs centered, CHN / ENG, notifications, my wallet, settings on the right.
// · Content area: trading terminals (spot, token detail, perps) fill one screen without scrolling; other pages max 1440 wide.
// · Bottom status bar: real connection status of the market feed, community service, and wallet.
// · Narrow screens (web opened in a phone browser): the top bar keeps only the brand and language; tabs move to the bottom capsule bar, as easy to tap as the mobile app.
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { BarChart3, CandlestickChart, Cat, MessageCircle, Moon, Mountain, Repeat, Sun, UserRound, Wallet, WifiOff } from 'lucide-react'
import { connectWallet, useWalletGate } from './walletGate'
import { useMarket } from '@/store/market'
import { isWalletConnected, useWallet } from '@/store/wallet'
import { useSocial } from '@/store/social'
import { useCommunityUnread } from '@/store/announcements'
import { useLang } from '@/lib/i18n'
import { useTheme, type ThemeSetting } from '@/lib/theme'
import { legalUrl } from '@/lib/legal'
import { t } from '@/lib/i18n'
import { shortId } from '@/lib/format'
import ProposalSheet from '@/components/ProposalSheet'
import ScrollRestorer from '@/components/ScrollRestorer'
import Brand from './Brand'
import { AppLoginMenu, BellMenu, WalletMenu } from './TopMenus'
import DeskNotices from './DeskNotices'
import QrIdleGuard from './QrIdleGuard'
import { useLiveRooms, useLiveRoomsPoll } from './liveRooms'
// Styles for content pages (streaming / sprite / community / rankings / my assets / notifications / settings), top-bar dropdowns and desktop modals
import './desk-content.css'

/** Five tabs (since 2026-10-01: markets, spot, perps, community, sprite). label is a function: translated at render time so it follows language switches. match: pages under these path prefixes also count as this tab (for top-bar highlighting) */
const NAV = [
  { to: '/discover', label: () => t('行情||web-nav'), icon: BarChart3, match: ['/discover'] },
  { to: '/spot', label: () => t('现货||web-nav'), icon: Repeat, match: ['/spot', '/token', '/swap'] },
  { to: '/perp', label: () => t('合约||web-nav'), icon: CandlestickChart, match: ['/perp'] },
  // 2026-10-01 goat community merge: "streaming" and "rankings" folded into community (community's left menu: feed / live / meetings / rankings / messages / groups)
  { to: '/community', label: () => t('社区||web-nav'), icon: MessageCircle, match: ['/community', '/live', '/room', '/meet', '/meetings', '/rank', '/messages', '/groups', '/friends', '/g/', '/dm/', '/u/', '/post/', '/official'] },
  { to: '/flies', label: () => t('小精灵||web-nav'), icon: Cat, match: ['/flies', '/fly'] },
]
/**
 * Narrow screens (phone browsers) get an extra "Me" in the bottom capsule bar (2026-10-07 goat: the profile center is invisible on phones, its entry buried in the top-right avatar menu):
 * it goes to /settings (on narrow screens that's the mobile "Me" page: profile, assets, security, trading, social, settings). Wide-screen top bars don't add it — the top-right wallet menu is the profile center there
 */
const PHONE_NAV = [...NAV, { to: '/settings', label: () => t('我||web-nav'), icon: UserRound, match: ['/settings', '/portfolio', '/energy', '/earnings', '/approvals'] }]
/** Top-bar appearance button: midnight black → taro white → space → midnight black ("space" added 2026-10-03). The button shows the one it will switch to */
const NEXT_LOOK: Record<'dark' | 'light' | 'space', { to: 'dark' | 'light' | 'space'; icon: typeof Sun; label: () => string }> = {
  dark: { to: 'light', icon: Sun, label: () => t('切换到香芋白') },
  light: { to: 'space', icon: Mountain, label: () => t('切换到空间') },
  space: { to: 'dark', icon: Moon, label: () => t('切换到午夜黑') },
}
const lookOf = (setting: ThemeSetting, theme: 'dark' | 'light') => (setting === 'space' ? 'space' : theme)

/** Wide pages: max 1440 wide */
const WIDE = ['/discover', '/live', '/meet', '/meetings', '/messages', '/groups', '/friends', '/flies', '/community', '/rank', '/portfolio', '/notifications', '/settings']
/** Trading terminals: fill one screen, the whole page doesn't scroll. /swap excluded (2026-10-05: standalone swap is a centered card, see pages/Swap.tsx's deskCard) */
const TERM = ['/spot', '/token', '/perp']

export default function DesktopLayout() {
  const offline = useMarket((s) => s.offline)
  const communityUnread = useCommunityUnread()
  // Live room count (community red dot): public endpoint, polled every 10s (desktop/liveRooms.ts, same as the community page)
  useLiveRoomsPoll()
  const liveCount = useLiveRooms((s) => s.rooms?.length ?? 0)
  const { unreadNotifs, pendingRequests } = useSocial()
  const notifyUnread = Math.max(unreadNotifs, pendingRequests)
  const { pathname } = useLocation()
  const { evmAddress, address } = useWallet()
  // The 0x4 extension or external wallets (MetaMask etc. are EVM-only) all count as connected (2026-09-30)
  const connected = useWallet(isWalletConnected)
  const connecting = useWalletGate((s) => s.connecting)
  // Phone app logged in via QR scan (no wallet connected, 2026-10-01): the top bar still shows notifications and the account menu
  const appLogin = useSocial((s) => s.qrMode && s.status === 'ready')
  const { lang, setLang } = useLang()
  const theme = useTheme((s) => s.theme)
  const setting = useTheme((s) => s.setting)
  const setTheme = useTheme((s) => s.setTheme)
  const next = NEXT_LOOK[lookOf(setting, theme)]
  const NextIcon = next.icon
  const zh = lang !== 'en'
  const active = (m: string[]) => m.some((p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`) || pathname.startsWith(p) && p.endsWith('/'))
  // Group chat / DMs / live rooms / meetings / feed threads: full-screen pages with fixed-height content areas; each page scrolls itself
  const chatMode = pathname.startsWith('/g/') || pathname.startsWith('/dm/') || pathname.startsWith('/room/') || pathname.startsWith('/post/') || pathname.startsWith('/meet/')
  const under = (list: string[]) => list.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  const term = under(TERM)
  const wide = term || under(WIDE)
  const myAddr = evmAddress || address || ''
  const socialStatus = useSocial((s) => s.status)
  const needTerms = useSocial((s) => s.needTerms)

  return (
    <div className={`desk ${chatMode ? 'desk-chat' : ''} ${term ? 'desk-term' : ''}`}>
      {/* QR-logged-in computers: auto-logout when idle (no activity for 30 minutes; asks "still there?" shortly before) */}
      <QrIdleGuard />
      {/* Scroll edge (taro white / space): content blurs and fades as it rolls under the top bar. ★ Must be its own layer: when painted on the sticky top bar's pseudo-element the browser can't reach the content behind — it only darkens, never blurs (measured 2026-10-03) */}
      <div className="desk-edge" aria-hidden="true" />
      <header className="desk-bar">
        <div className="desk-bar-in">
          <NavLink to="/discover" className="desk-brand-link" aria-label={t('行情||web-nav')}><Brand /></NavLink>
          <nav className="desk-nav" aria-label={t('主导航')}>
            {NAV.map(({ to, label, icon: Icon, match }) => (
              <NavLink key={to} to={to} className={() => `desk-nav-item ${active(match) ? 'on' : ''}`} aria-current={active(match) ? 'page' : undefined}>
                {/* Icons only show in the "space" appearance (nav becomes a vertical icon rail on the left, space.css) */}
                <Icon className="desk-nav-ic" size={20} strokeWidth={1.8} aria-hidden="true" />
                <span className="desk-nav-t">{label()}</span>
                {/* Community: someone live = red dot (the design's LIVE dot); nobody live but unread messages = lavender dot */}
                {to === '/community' && (liveCount > 0
                  ? <span className="desk-dot is-live" aria-label={t('{n} 个房间正在直播', { n: liveCount })} />
                  : communityUnread > 0 && <span className="desk-dot" aria-label={t('{n} 条未读', { n: communityUnread })} />)}
              </NavLink>
            ))}
          </nav>
          <div className="desk-tools">
            <div className="desk-lang" role="group" aria-label={t('切换语言')}>
              <button type="button" aria-pressed={zh} onClick={() => setLang('zh-Hans')}>CHN</button>
              <span aria-hidden="true">/</span>
              <button type="button" aria-pressed={!zh} onClick={() => setLang('en')}>ENG</button>
            </div>
            {/* Midnight black / taro white / space (two from goat on 2026-10-02, space added 10-03): each tap switches to the next; also directly selectable in settings → appearance */}
            <button type="button" className="desk-theme" onClick={() => setTheme(next.to)} aria-label={next.label()} title={next.label()}>
              <NextIcon size={15} />
            </button>
            {connected ? <>
              {/* Notifications: dropdown panel (no jumping to the mobile page); wallet capsule: menu (my assets / my profile / settings / disconnect), see TopMenus.tsx */}
              <BellMenu unread={notifyUnread} />
              <WalletMenu />
            </> : appLogin ? <>
              <BellMenu unread={notifyUnread} />
              <AppLoginMenu />
            </> : (
              // No wallet connected: a "Connect wallet" button opens the connect panel (0x4 Wallet recommended first, other wallets selectable; no creating / importing on web)
              <button type="button" className="desk-connect" onClick={connectWallet} disabled={connecting} aria-busy={connecting}>
                <Wallet size={16} strokeWidth={2} aria-hidden="true" /><span>{connecting ? t('正在连接') : t('连接钱包')}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Official notice bar: announcements active in the admin's "home notices" (DeskNotices.tsx); absent when there are none */}
      <DeskNotices />
      {offline && <div className="desk-offline" role="status"><WifiOff size={15} className="shrink-0" />{t('行情连接中断，价格可能已过期')}</div>}
      <ScrollRestorer />
      <main id="main-content" className={`desk-main ${wide ? 'desk-wide' : 'desk-narrow'}`}>
        <Outlet />
        <ProposalSheet />
      </main>

      {/* Bottom status bar: real connection status. Without a wallet the community is read-only on public content — not counted as a fault */}
      {!chatMode && <footer className="desk-status" aria-label={t('连接状态')}>
        <span className={`desk-status-item ${offline ? 'bad' : 'ok'}`}><i aria-hidden="true" />{offline ? t('行情中断') : t('行情已连接')}</span>
        {connected && <span className={`desk-status-item ${socialStatus === 'ready' ? 'ok' : socialStatus === 'error' ? 'bad' : 'wait'}`}><i aria-hidden="true" />{socialStatus === 'ready' ? t('社区已连接') : socialStatus === 'error' ? t('社区未连接') : needTerms ? t('社区未启用') : t('社区连接中')}</span>}
        {connected
          ? <span className="desk-status-item ok"><i aria-hidden="true" />{t('钱包 {a}', { a: shortId(myAddr) })}</span>
          : <button type="button" className="desk-status-item" onClick={connectWallet}><i aria-hidden="true" />{t('未连接钱包')}</button>}
        {/* Legal docs + download center (2026-10-01 goat: under every page; 10-02: whole row centered, drop "0x4 Web", rename "Download" to "Download Center"): pages on 420.meme, opened in a new tab */}
        <nav className="desk-status-legal" aria-label={t('法律与下载')}>
          {/* With ?theme=: static pages follow the midnight black / taro white picked here (2026-10-03 goat) */}
          <a className="desk-status-link" href={legalUrl('https://420.meme/terms/')} target="_blank" rel="noreferrer">{t('服务条款')}</a>
          <a className="desk-status-link" href={legalUrl('https://420.meme/privacy/')} target="_blank" rel="noreferrer">{t('隐私政策')}</a>
          <a className="desk-status-link" href={legalUrl('https://420.meme/risk/')} target="_blank" rel="noreferrer">{t('风险披露')}</a>
          <a className="desk-status-link" href={legalUrl('https://420.meme/download/')} target="_blank" rel="noreferrer">{t('下载中心')}</a>
        </nav>
      </footer>}

      {/* Narrow screens: tabs move to the bottom capsule bar */}
      {!chatMode && <div className="desk-tabbar-floor">
        {/* Column count follows the number of tabs (2026-10-04 walkthrough: it used to be hardcoded to 7 columns, squeezing 5 buttons to the left) */}
        <nav aria-label={t('主导航')} className="app-nav glass desk-tabbar" style={{ gridTemplateColumns: `repeat(${PHONE_NAV.length}, minmax(0, 1fr))` }}>
          {/* Use Link, not NavLink: NavLink only sets aria-current when the address equals to, so pages under match (/live under community, /portfolio under me) wouldn't highlight */}
          {PHONE_NAV.map(({ to, label, icon: Icon, match }) => (
            <Link key={to} to={to} className="nav-tab" aria-current={active(match) ? 'page' : undefined}>
              <Icon size={19} strokeWidth={1.8} aria-hidden="true" />{label()}
            </Link>
          ))}
        </nav>
      </div>}
    </div>
  )
}
