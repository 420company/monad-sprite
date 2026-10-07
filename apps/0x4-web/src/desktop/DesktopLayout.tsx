// 网页版主框架（VITE_SURFACE=web）。设计规范 docs/WEB_DESIGN.md（2026-09-29 goat 第三轮反馈后重做）：
// · 顶栏铺满全宽：左边品牌（和官网同一个猫头 + 像素字，点击回「行情」），正中七个栏目，右边 CHN / ENG、通知、我的钱包、设置。
// · 内容区：交易终端（现货、币详情、合约）铺满一屏不滚动；其他页面最大宽 1440。
// · 底部状态栏：行情推送、社区服务、钱包的真实连接状态。
// · 窄屏（手机浏览器打开网页版）：顶栏只留品牌和语言，栏目放到底部胶囊栏，和手机 App 一样好点。
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
// 内容页（流媒体 / 小精灵 / 社区 / 排行 / 我的资产 / 通知 / 设置）、顶栏下拉和电脑端模态框的样式
import './desk-content.css'

/** 五个栏目（2026-10-01 起：行情、现货、合约、社区、小精灵）。label 是函数：渲染时才翻译，切换语言后跟着变。match：这些路径开头的页面也算在这个栏目下（顶栏高亮用） */
const NAV = [
  { to: '/discover', label: () => t('行情||web-nav'), icon: BarChart3, match: ['/discover'] },
  { to: '/spot', label: () => t('现货||web-nav'), icon: Repeat, match: ['/spot', '/token', '/swap'] },
  { to: '/perp', label: () => t('合约||web-nav'), icon: CandlestickChart, match: ['/perp'] },
  // 2026-10-01 goat 社区合并：「流媒体」「排行」并进社区（社区左边菜单：动态 / 直播 / 会议 / 排行 / 消息 / 群组）
  { to: '/community', label: () => t('社区||web-nav'), icon: MessageCircle, match: ['/community', '/live', '/room', '/meet', '/meetings', '/rank', '/messages', '/groups', '/friends', '/g/', '/dm/', '/u/', '/post/', '/official'] },
  { to: '/flies', label: () => t('小精灵||web-nav'), icon: Cat, match: ['/flies', '/fly'] },
]
/**
 * 窄屏（手机浏览器）底部胶囊栏多一个「我」（2026-10-07 goat：手机上看不到个人中心，入口只藏在右上角头像菜单里）：
 * 进 /settings（窄屏是手机版的「我」页：资料、资产、安全、交易、社交、设置）。宽屏顶栏不加，宽屏右上角的钱包菜单就是个人中心
 */
const PHONE_NAV = [...NAV, { to: '/settings', label: () => t('我||web-nav'), icon: UserRound, match: ['/settings', '/portfolio', '/energy', '/earnings', '/approvals'] }]
/** 顶栏外观按钮：午夜黑 → 香芋白 → 空间 → 午夜黑（2026-10-03 加「空间」）。按钮上画的是「点了会变成」的那个 */
const NEXT_LOOK: Record<'dark' | 'light' | 'space', { to: 'dark' | 'light' | 'space'; icon: typeof Sun; label: () => string }> = {
  dark: { to: 'light', icon: Sun, label: () => t('切换到香芋白') },
  light: { to: 'space', icon: Mountain, label: () => t('切换到空间') },
  space: { to: 'dark', icon: Moon, label: () => t('切换到午夜黑') },
}
const lookOf = (setting: ThemeSetting, theme: 'dark' | 'light') => (setting === 'space' ? 'space' : theme)

/** 宽页面：最大宽 1440 */
const WIDE = ['/discover', '/live', '/meet', '/meetings', '/messages', '/groups', '/friends', '/flies', '/community', '/rank', '/portfolio', '/notifications', '/settings']
/** 交易终端：铺满一屏，整页不滚动。/swap 不算（2026-10-05：单独的闪兑是中间一块卡片，见 pages/Swap.tsx 的 deskCard） */
const TERM = ['/spot', '/token', '/perp']

export default function DesktopLayout() {
  const offline = useMarket((s) => s.offline)
  const communityUnread = useCommunityUnread()
  // 正在直播的房间数（社区红点）：公开接口，10 秒一拉（desktop/liveRooms.ts，和社区页同一份）
  useLiveRoomsPoll()
  const liveCount = useLiveRooms((s) => s.rooms?.length ?? 0)
  const { unreadNotifs, pendingRequests } = useSocial()
  const notifyUnread = Math.max(unreadNotifs, pendingRequests)
  const { pathname } = useLocation()
  const { evmAddress, address } = useWallet()
  // 0x4 插件或外部钱包（MetaMask 等只有 EVM）都算连着（2026-09-30）
  const connected = useWallet(isWalletConnected)
  const connecting = useWalletGate((s) => s.connecting)
  // 手机 App 扫码登录（没连钱包，2026-10-01）：顶栏照样有通知和账号菜单
  const appLogin = useSocial((s) => s.qrMode && s.status === 'ready')
  const { lang, setLang } = useLang()
  const theme = useTheme((s) => s.theme)
  const setting = useTheme((s) => s.setting)
  const setTheme = useTheme((s) => s.setTheme)
  const next = NEXT_LOOK[lookOf(setting, theme)]
  const NextIcon = next.icon
  const zh = lang !== 'en'
  const active = (m: string[]) => m.some((p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`) || pathname.startsWith(p) && p.endsWith('/'))
  // 群聊 / 私信 / 直播间 / 会议 / 动态对话：整屏页面，内容区固定高度由页面自己滚
  const chatMode = pathname.startsWith('/g/') || pathname.startsWith('/dm/') || pathname.startsWith('/room/') || pathname.startsWith('/post/') || pathname.startsWith('/meet/')
  const under = (list: string[]) => list.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  const term = under(TERM)
  const wide = term || under(WIDE)
  const myAddr = evmAddress || address || ''
  const socialStatus = useSocial((s) => s.status)
  const needTerms = useSocial((s) => s.needTerms)

  return (
    <div className={`desk ${chatMode ? 'desk-chat' : ''} ${term ? 'desk-term' : ''}`}>
      {/* 扫码登录的电脑：没人在用就自动退出（30 分钟没操作，快到点先问「还在吗？」） */}
      <QrIdleGuard />
      {/* 滚动边缘（香芋白 / 空间）：内容滚到顶栏下面先模糊变淡。★必须是单独一层：画在吸顶顶栏的伪元素上时浏览器拿不到背后的内容，只有压暗没有模糊（2026-10-03 实测） */}
      <div className="desk-edge" aria-hidden="true" />
      <header className="desk-bar">
        <div className="desk-bar-in">
          <NavLink to="/discover" className="desk-brand-link" aria-label={t('行情||web-nav')}><Brand /></NavLink>
          <nav className="desk-nav" aria-label={t('主导航')}>
            {NAV.map(({ to, label, icon: Icon, match }) => (
              <NavLink key={to} to={to} className={() => `desk-nav-item ${active(match) ? 'on' : ''}`} aria-current={active(match) ? 'page' : undefined}>
                {/* 图标只在「空间」外观显示（导航变成左边竖着的图标栏，space.css） */}
                <Icon className="desk-nav-ic" size={20} strokeWidth={1.8} aria-hidden="true" />
                <span className="desk-nav-t">{label()}</span>
                {/* 社区：有人在直播 = 红点（设计稿 LIVE 点）；没人直播但有未读消息 = 淡紫点 */}
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
            {/* 午夜黑 / 香芋白 / 空间（2026-10-02 goat 两种，10-03 加空间）：点一下换下一种，设置 → 外观里也能直接选 */}
            <button type="button" className="desk-theme" onClick={() => setTheme(next.to)} aria-label={next.label()} title={next.label()}>
              <NextIcon size={15} />
            </button>
            {connected ? <>
              {/* 通知：下拉面板（不跳手机页）；钱包胶囊：菜单（我的资产 / 我的主页 / 设置 / 断开），见 TopMenus.tsx */}
              <BellMenu unread={notifyUnread} />
              <WalletMenu />
            </> : appLogin ? <>
              <BellMenu unread={notifyUnread} />
              <AppLoginMenu />
            </> : (
              // 没连钱包：一个「连接钱包」，点了弹连接面板（0x4 Wallet 推荐放第一个，也能选其它钱包；网页上不创建 / 导入）
              <button type="button" className="desk-connect" onClick={connectWallet} disabled={connecting} aria-busy={connecting}>
                <Wallet size={16} strokeWidth={2} aria-hidden="true" /><span>{connecting ? t('正在连接') : t('连接钱包')}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 官方公告条：后台「首页公告」里生效的公告（DeskNotices.tsx），没有就不出现 */}
      <DeskNotices />
      {offline && <div className="desk-offline" role="status"><WifiOff size={15} className="shrink-0" />{t('行情连接中断，价格可能已过期')}</div>}
      <ScrollRestorer />
      <main id="main-content" className={`desk-main ${wide ? 'desk-wide' : 'desk-narrow'}`}>
        <Outlet />
        <ProposalSheet />
      </main>

      {/* 底部状态栏：真实连接状态。没连钱包时社区只读公开内容，不算故障 */}
      {!chatMode && <footer className="desk-status" aria-label={t('连接状态')}>
        <span className={`desk-status-item ${offline ? 'bad' : 'ok'}`}><i aria-hidden="true" />{offline ? t('行情中断') : t('行情已连接')}</span>
        {connected && <span className={`desk-status-item ${socialStatus === 'ready' ? 'ok' : socialStatus === 'error' ? 'bad' : 'wait'}`}><i aria-hidden="true" />{socialStatus === 'ready' ? t('社区已连接') : socialStatus === 'error' ? t('社区未连接') : needTerms ? t('社区未启用') : t('社区连接中')}</span>}
        {connected
          ? <span className="desk-status-item ok"><i aria-hidden="true" />{t('钱包 {a}', { a: shortId(myAddr) })}</span>
          : <button type="button" className="desk-status-item" onClick={connectWallet}><i aria-hidden="true" />{t('未连接钱包')}</button>}
        {/* 法律文件 + 下载中心（2026-10-01 goat：每个页面底下都要有；10-02：整排居中、去掉「0x4 Web」、「下载」改「下载中心」）：420.meme 上的页面，新标签打开 */}
        <nav className="desk-status-legal" aria-label={t('法律与下载')}>
          {/* 带 ?theme=：静态页跟随这边选的午夜黑 / 香芋白（2026-10-03 goat） */}
          <a className="desk-status-link" href={legalUrl('https://420.meme/terms/')} target="_blank" rel="noreferrer">{t('服务条款')}</a>
          <a className="desk-status-link" href={legalUrl('https://420.meme/privacy/')} target="_blank" rel="noreferrer">{t('隐私政策')}</a>
          <a className="desk-status-link" href={legalUrl('https://420.meme/risk/')} target="_blank" rel="noreferrer">{t('风险披露')}</a>
          <a className="desk-status-link" href={legalUrl('https://420.meme/download/')} target="_blank" rel="noreferrer">{t('下载中心')}</a>
        </nav>
      </footer>}

      {/* 窄屏：栏目放到底部胶囊栏 */}
      {!chatMode && <div className="desk-tabbar-floor">
        {/* 列数跟着栏目数走（2026-10-04 走查：以前写死 7 列，5 个按钮挤在左边） */}
        <nav aria-label={t('主导航')} className="app-nav glass desk-tabbar" style={{ gridTemplateColumns: `repeat(${PHONE_NAV.length}, minmax(0, 1fr))` }}>
          {/* 用 Link 不用 NavLink：NavLink 只在地址等于 to 时才给 aria-current，match 里的页面（社区下的 /live、我下的 /portfolio）不高亮 */}
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
