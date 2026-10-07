// 路由与访问守卫：无钱包 → 引导页；有钱包未解锁 → 解锁页；否则进入主界面
import { Suspense, lazy, useEffect, useRef } from 'react'
import LiveBanner from '@/live/LiveBanner'
import { BALANCE_FEATURES } from '@/lib/features'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { initNative } from '@/lib/native'
import { installPressHaptics } from '@/lib/pressHaptics'
import { installBackGestures } from '@/lib/swipeBack'
import { initAutoLock } from '@/lib/autolock'
import { readQrSession, useSocial } from '@/store/social'
import { initPush } from '@/lib/push'
import { useBng } from '@/store/bng'
import { isWalletConnected, useWallet } from '@/store/wallet'
import Layout from '@/components/Layout'
import DesktopLayout from '@/desktop/DesktopLayout'
import { WEB_SURFACE } from '@/lib/surface'
import { pageStore } from '@/lib/pageState'
import { AFTER_UNLOCK, takeAfterUnlock } from '@/lib/afterUnlock'
import type { CommunityTab } from '@/components/CommunityTabs'
import { PERP_ENABLED } from '@/lib/features'
import { WEB_HOME } from '@/lib/route'
import { Need, WalletGateHost } from '@/desktop/WalletRequired'
import Ox4Only from '@/desktop/Ox4Only'
import { DeskColumn } from '@/desktop/ui'
import { restoreWallet } from '@/desktop/walletGate'
import { Wide } from '@/desktop/useWide'
import { ToastHost } from '@/components/Toast'
import { AlertHost } from '@/components/AlertDialog'
import ReportSheet from '@/components/ReportSheet'
import TermsGate from '@/components/TermsGate'
import UnlockSheet from '@/components/UnlockSheet'
import CallOverlay from '@/components/CallOverlay'
import LiquidBackground from '@/components/LiquidBackground'
import UpdateToast from '@/components/UpdateToast'
import { persistentSession } from '@/lib/secureStore'
import { useLang } from '@/lib/i18n'
import Onboarding from '@/pages/Onboarding'
import Unlock from '@/pages/Unlock'
import Home from '@/pages/Home'
import Discover from '@/pages/Discover'
import Token from '@/pages/Token'
import Activity from '@/pages/Activity'
import Perp from '@/pages/Perp'
import Swap from '@/pages/Swap'
import Community from '@/pages/Community'
import GroupChat from '@/pages/GroupChat'
import DmChat from '@/pages/DmChat'
import Profile from '@/pages/Profile'
import Live from '@/pages/Live'
import Room from '@/pages/Room'
import Earnings from '@/pages/Earnings'
import { useEnergySync } from '@/components/energy/GiftFxLayer'
import { ENERGY_GIFTS } from '@/lib/energy'
const EnergyEarnings = lazy(() => import('@/pages/EnergyEarnings'))
import Rewards from '@/pages/Rewards'
import Notifications from '@/pages/Notifications'
import Approvals from '@/pages/Approvals'
import Support, { SupportTicket } from '@/pages/Support'
import Settings from '@/pages/Settings'
import Flies from '@/pages/Flies'
import FlyDetail from '@/pages/FlyDetail'
import PcLogin from '@/pages/PcLogin'
import PostDetail from '@/pages/PostDetail'
import Official from '@/pages/Official'
import Spot from '@/pages/Spot'
import Launch from '@/pages/Launch' // Monad testnet one-click launch (added 2026-10-07 for hackathon)
import { TokenRouter } from '@/pages/MonadToken' // monad-testnet renders the bonding-curve view (added 2026-10-07 for hackathon)

// 会议室带整个音视频库，按需加载，不进首屏包
const MeetingRoom = lazy(() => import('@/pages/MeetingRoom'))
// 分享链接的观看页（2026-09-30）：没登录也能看，15 秒后提示登录
const Watch = lazy(() => import('@/pages/Watch'))
// 网页版电脑端页面（2026-09-29 goat：网页版不要和手机一个样子）：只在 VITE_SURFACE=web 的宽屏上加载，窄屏退回手机同一页
const DeskMarkets = lazy(() => import('@/desktop/pages/Markets'))
const DeskToken = lazy(() => import('@/desktop/pages/TokenTerminal'))
const DeskSpot = lazy(() => import('@/desktop/pages/TokenTerminal').then((m) => ({ default: m.DeskSpot })))
const DeskPerp = lazy(() => import('@/desktop/pages/PerpTerminal'))
// 社区合并（2026-10-01 goat）：动态 / 直播 / 会议 / 排行 / 消息 / 群组都在社区左边菜单下（desktop/community/）
const DeskLive = lazy(() => import('@/desktop/community/LiveView'))
const DeskCommunity = lazy(() => import('@/desktop/community/FeedView'))
const DeskMeetings = lazy(() => import('@/desktop/community/MeetingsView'))
const DeskMessages = lazy(() => import('@/desktop/community/ChatsView').then((m) => ({ default: m.MessagesView })))
const DeskGroups = lazy(() => import('@/desktop/community/ChatsView').then((m) => ({ default: m.GroupsView })))
const DeskFriends = lazy(() => import('@/desktop/community/ChatsView').then((m) => ({ default: m.FriendsView })))
const DeskSprites = lazy(() => import('@/desktop/pages/SpritesDesk'))
// 2026-09-29 goat：网页版少了排行页；个人中心 / 通知 / 设置点进去还是手机页面 → 各做一个电脑端页面
const DeskRank = lazy(() => import('@/desktop/community/RankView'))
const DeskPortfolio = lazy(() => import('@/desktop/pages/PortfolioDesk'))
const DeskNotifications = lazy(() => import('@/desktop/pages/NotificationsDesk'))
const DeskSettings = lazy(() => import('@/desktop/pages/SettingsDesk'))
// 群聊 / 私信 / 官方公告：左会话列表 + 右聊天窗；个人主页：左资料右页签表（2026-09-29，原来是整屏手机页面）
const DeskChat = lazy(() => import('@/desktop/pages/ChatDesk'))
const DeskProfile = lazy(() => import('@/desktop/pages/ProfileDesk'))
/** 网页版宽屏用电脑端页面，其余（手机 App、窄屏网页版）用手机页面 */
const desk = (el: React.ReactNode, phone: React.ReactNode) => WEB_SURFACE ? <Wide desk={<Suspense fallback={null}>{el}</Suspense>} phone={phone} /> : phone

/** 宽屏的 /rank、/messages、/groups 链接在手机版（App、窄屏网页）打开：去社区并切到对应标签（2026-10-04 走查：以前只落到社区上次停留的标签） */
function CommunityAt({ tab }: { tab: CommunityTab }) {
  pageStore.set('community.tab', tab)
  return <Navigate to="/community" replace />
}


export default function App() {
  const { vault, wallet, keysUnlocked } = useWallet()
  // 网页版连着钱包没有：0x4 插件或外部钱包（MetaMask 等只有 EVM，没有 Solana 签名器 wallet）都算（2026-09-30）
  const connected = useWallet(isWalletConnected)
  const walletId = useWallet((s) => (s.wallet ? s.address : s.evmAddress))
  const { sessionLoaded, hasSession } = useSocial()
  // 切换语言：外壳按语言重挂一次，所有页面用新语言重新渲染；繁体转换表没加载好之前先不画
  const { lang, ready: langReady } = useLang()
  const loc = useLocation()
  const navigate = useNavigate()
  // 原生外壳：状态栏、启动图、meme.wallet.app:// 深度链接、Android 返回键（网页里是空操作）
  useEffect(() => { initNative((path) => navigate(path)) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // 点按功能按键轻微震一下（只在原生 App；我 → 通知 → 按键震动 可关）
  useEffect(() => installPressHaptics(), [])
  // 返回手势：iOS 左边缘右滑、Android 系统返回键 / 手势，和页面返回按钮同一套逻辑（lib/swipeBack.ts）
  const pathRef = useRef(loc.pathname)
  pathRef.current = loc.pathname
  useEffect(() => installBackGestures(() => pathRef.current, navigate), []) // eslint-disable-line react-hooks/exhaustive-deps
  // 系统推送：点通知跳到对应页面（没打开推送的包里是空操作）
  useEffect(() => { initPush((path) => navigate(path)) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // 自动锁定：切后台或闲置超过阈值就清掉内存里的私钥，路由守卫会把人送回解锁页
  // 自动锁定只给手机 App（本机存私钥）。网页版的钥匙在 0x4 插件里、插件自己会锁；网页这边一锁就把连接清掉，闲置 5 分钟页面就变回「连接钱包」（2026-10-04 走查）
  useEffect(() => (WEB_SURFACE ? undefined : initAutoLock()), [])
  // 网页版：0x4 浏览器插件已经对这个网站连过而且没锁，打开就直接挂上（不弹窗）
  useEffect(() => { if (WEB_SURFACE) void restoreWallet() }, [])
  // 网页版：能量余额实时同步（送礼 / 充值后所有设备一起变，手机 App 不挂）
  useEnergySync()

  const hasWallet = !!vault
  // 能不能进主界面。原生 App：钱包解锁着，或本机有可用的登录令牌（锁着也能刷社交，动钱时再验证）；
  // 网页版：钱包解锁着才行
  const unlocked = persistentSession ? keysUnlocked || hasSession : !!wallet

  // 原生 App：读回本机保存的社交登录令牌（换钱包后重读）
  useEffect(() => {
    if (persistentSession && vault) void useSocial.getState().restoreSession()
  }, [vault?.publicKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // 钱包解锁后自动用签名登录社交层；锁定即清空会话与私信
  // 启动时识别 BNG 所在链与精度
  useEffect(() => { useBng.getState().detect() }, [])

  useEffect(() => {
    const social = useSocial.getState()
    if (!persistentSession) {
      if (connected) social.login()
      // 网页版没连钱包：本机有扫码登录的令牌就用它（2026-10-01，手机 App 扫码登录网页版），没有就登出
      else if (WEB_SURFACE && (social.qrMode || readQrSession())) { if (!social.qrMode) void social.loginWithQr() }
      else social.logout()
      return
    }
    // 原生 App：锁定不登出。有令牌就直接用令牌登录，没有令牌等钱包解锁后签名登录
    if (!vault) { social.logout(true); return }
    if (sessionLoaded && (hasSession || keysUnlocked)) social.login()
  }, [wallet, connected, walletId, vault, sessionLoaded, hasSession, keysUnlocked])

  // 仅诊断构建（VITE_DIAG=1）：#/onboarding?preview=1 在已有钱包时也显示欢迎页，用来录开场动画；正式构建里恒为 false
  const welcomePreview = import.meta.env.VITE_DIAG === '1' && loc.pathname === '/onboarding' && loc.search.includes('preview=1')
  let gate: React.ReactNode = null
  if (WEB_SURFACE) {
    // 网页版（2026-09-29 goat）：没钱包也直接进电脑端外框，默认落在行情页；网页版不做创建 / 导入 / 解锁钱包，钱包只连 0x4 浏览器插件
    if (!langReady) gate = <></>
    else if (loc.pathname.startsWith('/onboarding') || loc.pathname === '/unlock') gate = <Navigate to={connected ? '/' : '/discover'} replace />
    else if (!connected && loc.pathname === '/') gate = <Navigate to="/discover" replace />
  }
  // 分享链接进来的观看页（/watch/…）：没钱包、没解锁也能先看（2026-09-30 goat：先看 15 秒再提示登录）
  else if (loc.pathname.startsWith('/watch/') && langReady) gate = null
  else if (!hasWallet && !loc.pathname.startsWith('/onboarding')) {
    // 用手机相机扫电脑登录码、这部手机上还没有钱包：先去建 / 导入钱包，建好后回到这个登录码（2026-10-04 走查：以前登录码直接丢了）
    if (loc.pathname === '/pc-login') { try { sessionStorage.setItem(AFTER_UNLOCK, loc.pathname + loc.search) } catch { /* 隐私模式 */ } }
    gate = <Navigate to="/onboarding" replace />
  }
  // 本机令牌还没读出来：先什么都不画（启动图还盖着），免得一闪解锁页
  else if ((hasWallet && !sessionLoaded) || !langReady) gate = <></>
  else if (hasWallet && !unlocked && loc.pathname !== '/unlock' && !loc.pathname.startsWith('/onboarding')) {
    // 用手机相机扫电脑登录码打开的 /pc-login：解锁后要回到这里，不能丢到首页（2026-09-27）
    if (loc.pathname === '/pc-login') { try { sessionStorage.setItem(AFTER_UNLOCK, loc.pathname + loc.search) } catch { /* 隐私模式 */ } }
    gate = <Navigate to="/unlock" replace />
  }
  else if (hasWallet && unlocked && ((loc.pathname === '/unlock' || (loc.pathname.startsWith('/onboarding') && loc.pathname !== '/onboarding/backup'))) && !welcomePreview) gate = <Navigate to={takeAfterUnlock()} replace />

  return (
    <>
    {/* 液态流体背景铺满整屏，内容层（app-shell）压在上面 */}
    <LiquidBackground />
    {/* 状态栏后面一条毛玻璃：页面滚上去时内容不会和时间 / 电量叠在一起（iOS 自带的边缘阴影在浅色下是灰带，已在原生里关掉） */}
    <div className="status-glass" aria-hidden="true" />
    {/* 网页版（VITE_SURFACE=web）不限 480 宽，外框见 desktop/DesktopLayout；手机 App 照旧 */}
    <div key={lang} className={WEB_SURFACE ? 'app-shell desk-shell min-h-full w-full' : 'app-shell mx-auto min-h-full w-full max-w-[480px]'}>
      {gate ?? (
        <Routes>
          {/* 网页版不做创建 / 导入 / 解锁（钱包只连 0x4 浏览器插件），上面的守卫已经把这两个地址转走 */}
          <Route path="/onboarding/*" element={WEB_SURFACE ? <Navigate to="/discover" replace /> : <Onboarding />} />
          <Route path="/unlock" element={WEB_SURFACE ? <Navigate to="/discover" replace /> : <Unlock />} />
          <Route path="/watch/:kind/:id" element={<Suspense fallback={null}><Watch /></Suspense>} />
          {/* <Need>：网页版没连钱包时换成「连接 0x4 Wallet」占位；手机 App 原样渲染。没包 Need 的页面没钱包也能看 */}
          <Route element={WEB_SURFACE ? <DesktopLayout /> : <Layout />}>
            {/* 网页版的 / = 我的资产（钱包菜单也进这里）；手机 App 照旧是首页 */}
            <Route path="/" element={WEB_SURFACE ? <Navigate to={WEB_HOME} replace /> : <Need><Home /></Need>} />
            <Route path="/portfolio" element={desk(<Need><DeskPortfolio /></Need>, <Need><Home /></Need>)} />
            <Route path="/discover" element={desk(<DeskMarkets />, <Discover />)} />
            <Route path="/token/:chain/:address" element={<TokenRouter fallback={desk(<DeskToken />, <Token />)} />} />
            <Route path="/token/:mint" element={desk(<DeskToken />, <Token />)} />
            <Route path="/swap" element={<Need><Swap /></Need>} />
            {/* 网页版「现货」：持仓 / 自选 + 闪兑跨链（手机 App 没有入口，直接打开也能用） */}
            <Route path="/spot" element={desk(<DeskSpot />, <Spot />)} />
            {/* Monad testnet one-click launch (added 2026-10-07 for hackathon) */}
            <Route path="/launch" element={<Launch />} />
            {/* 合约交易、私信是 0x4 Wallet 专属（2026-09-30 goat）：网页版连外部钱包时换成「0x4 Wallet 专属」卡（desktop/Ox4Only） */}
            {/* iOS 上架版不带合约（lib/features PERP_ENABLED）：进这个地址就回首页 */}
            <Route path="/perp" element={PERP_ENABLED ? desk(<Ox4Only feature="perp"><DeskPerp /></Ox4Only>, <Need><Ox4Only feature="perp"><Perp /></Ox4Only></Need>) : <Navigate to="/" replace />} />
            <Route path="/community" element={desk(<DeskCommunity />, <Community />)} />
            <Route path="/g/:id" element={desk(<Need app><DeskChat kind="group" /></Need>, <Need><GroupChat /></Need>)} />
            <Route path="/dm/:address" element={desk(<Need><Ox4Only feature="dm"><DeskChat kind="dm" /></Ox4Only></Need>, <Need><Ox4Only feature="dm"><DmChat /></Ox4Only></Need>)} />
            <Route path="/u/:address" element={desk(<DeskProfile />, <Profile />)} />
            {/* 以下几页还没做电脑端专门设计：网页版宽屏先放进居中一栏（DeskColumn），不再铺满整屏 */}
            <Route path="/post/:id" element={desk(<DeskColumn chat><PostDetail /></DeskColumn>, <PostDetail />)} />
            <Route path="/live" element={desk(<DeskLive />, <Live />)} />
            {/* 网页版社区的会议 / 消息 / 群组（手机 App 没有这几个入口：会议在「流媒体」页，消息和群在「社区」页） */}
            <Route path="/meetings" element={desk(<DeskMeetings />, <Navigate to="/live" replace />)} />
            <Route path="/messages" element={desk(<DeskMessages />, <CommunityAt tab="groups" />)} />
            <Route path="/groups" element={desk(<DeskGroups />, <CommunityAt tab={WEB_SURFACE ? 'clubs' : 'groups'} />)} />
            {/* 好友（2026-10-04）：电脑端社区左栏一项；手机版是社区的「好友」标签 */}
            <Route path="/friends" element={desk(<DeskFriends />, <CommunityAt tab="friends" />)} />
            <Route path="/room/:id" element={<Need app><Room /></Need>} />
            {/* 会议（原 meet.420.meme 的会议室）：会议码 abc-defg-hij */}
            <Route path="/meet/:code" element={<Need app><Suspense fallback={null}><MeetingRoom /></Suspense></Need>} />
            {/* 站内余额页：手机 App 里没有（lib/features），直接回首页 */}
            <Route path="/earnings" element={BALANCE_FEATURES ? <Need><Earnings /></Need> : <Navigate to="/" replace />} />
            {/* 能量与收益（网页版：充值能量、主播今日收益 / 待到账 / 结算记录）；手机 App 没有这一页 */}
            <Route path="/energy" element={ENERGY_GIFTS ? <Need app><Suspense fallback={null}>{desk(<DeskColumn><EnergyEarnings /></DeskColumn>, <EnergyEarnings />)}</Suspense></Need> : <Navigate to="/" replace />} />
            <Route path="/rewards" element={desk(<Need><DeskColumn><Rewards /></DeskColumn></Need>, <Need><Rewards /></Need>)} />
            <Route path="/notifications" element={desk(<Need app><DeskNotifications /></Need>, <Need><Notifications /></Need>)} />
            <Route path="/approvals" element={desk(<Need><DeskColumn><Approvals /></DeskColumn></Need>, <Need><Approvals /></Need>)} />
            <Route path="/support" element={desk(<Need><DeskColumn><Support /></DeskColumn></Need>, <Need><Support /></Need>)} />
            <Route path="/support/:id" element={desk(<Need><DeskColumn><SupportTicket /></DeskColumn></Need>, <Need><SupportTicket /></Need>)} />
            {/* 「0x4 官方」全员公告（只读） */}
            <Route path="/official" element={desk(<DeskChat kind="official" />, <Official />)} />
            {/* 活动记录：网页版宽屏在「我的资产 → 活动记录」页签里 */}
            <Route path="/activity" element={desk(<Navigate to="/portfolio?tab=activity" replace />, <Need><Activity /></Need>)} />
            <Route path="/settings" element={desk(<Need><DeskSettings /></Need>, <Need><Settings /></Need>)} />
            <Route path="/flies" element={desk(<DeskSprites />, <Flies />)} />
            {/* 排行（网页版顶栏栏目）：手机 App 没有这个入口，直接打开就回社区 */}
            <Route path="/rank" element={desk(<DeskRank />, <CommunityAt tab="rank" />)} />
            <Route path="/fly/:id" element={desk(<Need><DeskColumn><FlyDetail /></DeskColumn></Need>, <Need><FlyDetail /></Need>)} />
            {/* 老的观看页地址：现在是详情页的「现在」分页 */}
            <Route path="/fly/:id/live" element={desk(<Need><DeskColumn><FlyDetail /></DeskColumn></Need>, <Need><FlyDetail /></Need>)} />
            <Route path="/pc-login" element={<Need><PcLogin /></Need>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
      <ToastHost />
      {/* 网页版有新版本时的提示（原生 App 里不会出现） */}
      <UpdateToast />
      <AlertHost />
      {/* 举报、同意条款（2026-10-02 上架要求）：全站各一个 */}
      <ReportSheet />
      <TermsGate />
      {persistentSession && <UnlockSheet />}
      {/* 网页版：「连接 0x4 Wallet」面板（没装插件时说明插件即将上架） */}
      {WEB_SURFACE && <WalletGateHost />}
      {/* 语音 / 视频通话：任何页面都能弹来电 */}
      {!gate && <CallOverlay />}
      {!gate && <LiveBanner />}
    </div>
    </>
  )
}
