// Routing & access guards: no wallet → onboarding; wallet locked → unlock page; otherwise main UI
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

// Meeting rooms pull the whole AV stack; lazy-loaded, kept out of the first-screen bundle
const MeetingRoom = lazy(() => import('@/pages/MeetingRoom'))
// Share-link watch page (2026-09-30): viewable without login, login nudge after 15s
const Watch = lazy(() => import('@/pages/Watch'))
// Zalien-gated agent page (added 2026-10-07 for hackathon)
const Agent = lazy(() => import('@/pages/Agent'))
// Web desktop pages (2026-09-29 goat: web shouldn't look like the phone app): loaded only on wide screens with VITE_SURFACE=web; narrow screens fall back to the phone page
const DeskMarkets = lazy(() => import('@/desktop/pages/Markets'))
const DeskToken = lazy(() => import('@/desktop/pages/TokenTerminal'))
const DeskSpot = lazy(() => import('@/desktop/pages/TokenTerminal').then((m) => ({ default: m.DeskSpot })))
const DeskPerp = lazy(() => import('@/desktop/pages/PerpTerminal'))
// Community merge (2026-10-01 goat): feed / live / meetings / rankings / messages / groups all live under the community left menu (desktop/community/)
const DeskLive = lazy(() => import('@/desktop/community/LiveView'))
const DeskCommunity = lazy(() => import('@/desktop/community/FeedView'))
const DeskMeetings = lazy(() => import('@/desktop/community/MeetingsView'))
const DeskMessages = lazy(() => import('@/desktop/community/ChatsView').then((m) => ({ default: m.MessagesView })))
const DeskGroups = lazy(() => import('@/desktop/community/ChatsView').then((m) => ({ default: m.GroupsView })))
const DeskFriends = lazy(() => import('@/desktop/community/ChatsView').then((m) => ({ default: m.FriendsView })))
const DeskSprites = lazy(() => import('@/desktop/pages/SpritesDesk'))
// 2026-09-29 goat: web was missing the rankings page; profile / notifications / settings still opened phone pages → each gets a desktop page
const DeskRank = lazy(() => import('@/desktop/community/RankView'))
const DeskPortfolio = lazy(() => import('@/desktop/pages/PortfolioDesk'))
const DeskNotifications = lazy(() => import('@/desktop/pages/NotificationsDesk'))
const DeskSettings = lazy(() => import('@/desktop/pages/SettingsDesk'))
// Group chats / DMs / official announcements: conversation list left + chat window right; profile: info left + tabs right (2026-09-29; previously full-screen phone pages)
const DeskChat = lazy(() => import('@/desktop/pages/ChatDesk'))
const DeskProfile = lazy(() => import('@/desktop/pages/ProfileDesk'))
/** Wide-screen web uses desktop pages; everything else (phone app, narrow web) uses phone pages */
const desk = (el: React.ReactNode, phone: React.ReactNode) => WEB_SURFACE ? <Wide desk={<Suspense fallback={null}>{el}</Suspense>} phone={phone} /> : phone

/** Wide-screen /rank, /messages, /groups links opened in phone builds (app, narrow web): land on community with the matching tab selected (2026-10-04 review: previously just landed on community's last-visited tab) */
function CommunityAt({ tab }: { tab: CommunityTab }) {
  pageStore.set('community.tab', tab)
  return <Navigate to="/community" replace />
}


export default function App() {
  const { vault, wallet, keysUnlocked } = useWallet()
  // Web "wallet connected": counts for the 0x4 extension or external wallets (MetaMask etc. are EVM-only, no Solana signer wallet) (2026-09-30)
  const connected = useWallet(isWalletConnected)
  const walletId = useWallet((s) => (s.wallet ? s.address : s.evmAddress))
  const { sessionLoaded, hasSession } = useSocial()
  // Language switch: remount the shell per locale so every page re-renders; don't paint until the Traditional-Chinese conversion table is loaded
  const { lang, ready: langReady } = useLang()
  const loc = useLocation()
  const navigate = useNavigate()
  // Native shell: status bar, splash screen, meme.wallet.app:// deep links, Android back button (no-op on web)
  useEffect(() => { initNative((path) => navigate(path)) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Light buzz on function-key taps (native app only; Me → Notifications → key haptics can turn it off)
  useEffect(() => installPressHaptics(), [])
  // Back gestures: iOS left-edge swipe, Android system back key/gesture — same logic as the page back button (lib/swipeBack.ts)
  const pathRef = useRef(loc.pathname)
  pathRef.current = loc.pathname
  useEffect(() => installBackGestures(() => pathRef.current, navigate), []) // eslint-disable-line react-hooks/exhaustive-deps
  // System push: tapping a notification jumps to the matching page (no-op in builds without push enabled)
  useEffect(() => { initPush((path) => navigate(path)) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Auto-lock: backgrounding or idling past the threshold wipes in-memory private keys; the route guard sends the user back to the unlock page
  // Auto-lock is phone-app only (keys stored on device). Web keys live in the 0x4 extension, which locks itself; web clears the connection on lock, and after 5 idle minutes the page reverts to "connect wallet" (2026-10-04 review)
  useEffect(() => (WEB_SURFACE ? undefined : initAutoLock()), [])
  // Web: if the 0x4 browser extension already connected to this site and isn't locked, attach silently on open (no popup)
  useEffect(() => { if (WEB_SURFACE) void restoreWallet() }, [])
  // Web: energy balance syncs in realtime (changes on all devices after gifting/topup; the phone app doesn't mount this)
  useEnergySync()

  const hasWallet = !!vault
  // Whether the main UI is reachable. Native app: wallet unlocked, or a usable saved login token (social works while locked; money moves only after auth);
  // Web: only with the wallet unlocked
  const unlocked = persistentSession ? keysUnlocked || hasSession : !!wallet

  // Native app: read back the saved social login token (re-read after wallet switch)
  useEffect(() => {
    if (persistentSession && vault) void useSocial.getState().restoreSession()
  }, [vault?.publicKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto signature-login to the social layer on wallet unlock; sessions and DMs are cleared on lock
  // Detect BNG's chain and decimals at startup
  useEffect(() => { useBng.getState().detect() }, [])

  useEffect(() => {
    const social = useSocial.getState()
    if (!persistentSession) {
      if (connected) social.login()
      // Web without a wallet: use the locally saved QR-login token if present (2026-10-01, phone-app QR login to web); sign out otherwise
      else if (WEB_SURFACE && (social.qrMode || readQrSession())) { if (!social.qrMode) void social.loginWithQr() }
      else social.logout()
      return
    }
    // Native app: locking doesn't sign out. With a token, log in via token; without, wait for wallet unlock then signature-login
    if (!vault) { social.logout(true); return }
    if (sessionLoaded && (hasSession || keysUnlocked)) social.login()
  }, [wallet, connected, walletId, vault, sessionLoaded, hasSession, keysUnlocked])

  // Diagnostics builds only (VITE_DIAG=1): #/onboarding?preview=1 shows the welcome page even with a wallet, for recording the intro animation; always false in production builds
  const welcomePreview = import.meta.env.VITE_DIAG === '1' && loc.pathname === '/onboarding' && loc.search.includes('preview=1')
  let gate: React.ReactNode = null
  if (WEB_SURFACE) {
    // Web (2026-09-29 goat): enter the desktop frame even without a wallet, landing on markets by default; web never creates/imports/unlocks wallets — wallets connect via the 0x4 browser extension only
    if (!langReady) gate = <></>
    else if (loc.pathname.startsWith('/onboarding') || loc.pathname === '/unlock') gate = <Navigate to={connected ? '/' : '/discover'} replace />
    else if (!connected && loc.pathname === '/') gate = <Navigate to="/discover" replace />
  }
  // Share-link watch page (/watch/…): viewable without a wallet or unlock first (2026-09-30 goat: watch 15s, then the login nudge)
  else if (loc.pathname.startsWith('/watch/') && langReady) gate = null
  else if (!hasWallet && !loc.pathname.startsWith('/onboarding')) {
    // Phone camera scanning a computer login code with no wallet on this phone yet: create/import a wallet first, then return to this login code (2026-10-04 review: the code used to be dropped)
    if (loc.pathname === '/pc-login') { try { sessionStorage.setItem(AFTER_UNLOCK, loc.pathname + loc.search) } catch { /* Privacy mode */ } }
    gate = <Navigate to="/onboarding" replace />
  }
  // Local token not loaded yet: paint nothing (splash still covering) to avoid flashing the unlock page
  else if ((hasWallet && !sessionLoaded) || !langReady) gate = <></>
  else if (hasWallet && !unlocked && loc.pathname !== '/unlock' && !loc.pathname.startsWith('/onboarding')) {
    // /pc-login opened by scanning a computer login code with the phone camera: return here after unlock, never drop to home (2026-09-27)
    if (loc.pathname === '/pc-login') { try { sessionStorage.setItem(AFTER_UNLOCK, loc.pathname + loc.search) } catch { /* Privacy mode */ } }
    gate = <Navigate to="/unlock" replace />
  }
  else if (hasWallet && unlocked && ((loc.pathname === '/unlock' || (loc.pathname.startsWith('/onboarding') && loc.pathname !== '/onboarding/backup'))) && !welcomePreview) gate = <Navigate to={takeAfterUnlock()} replace />

  return (
    <>
    {/* Liquid fluid background fills the screen, content layer (app-shell) sits on top */}
    <LiquidBackground />
    {/* Frosted glass behind the status bar: scrolled-up content never overlaps the clock/battery (iOS's built-in edge shadow renders as a gray band in light mode; already disabled natively) */}
    <div className="status-glass" aria-hidden="true" />
    {/* Web (VITE_SURFACE=web) isn't capped at 480px wide — frame lives in desktop/DesktopLayout; phone app unchanged */}
    <div key={lang} className={WEB_SURFACE ? 'app-shell desk-shell min-h-full w-full' : 'app-shell mx-auto min-h-full w-full max-w-[480px]'}>
      {gate ?? (
        <Routes>
          {/* Web never creates/imports/unlocks (wallets connect via the 0x4 browser extension only); the guards above already reroute those two paths */}
          <Route path="/onboarding/*" element={WEB_SURFACE ? <Navigate to="/discover" replace /> : <Onboarding />} />
          <Route path="/unlock" element={WEB_SURFACE ? <Navigate to="/discover" replace /> : <Unlock />} />
          <Route path="/watch/:kind/:id" element={<Suspense fallback={null}><Watch /></Suspense>} />
          {/* <Need>: on web without a wallet, swap in the "connect 0x4 Wallet" placeholder; phone app renders as-is. Pages not wrapped in Need are viewable without a wallet */}
          <Route element={WEB_SURFACE ? <DesktopLayout /> : <Layout />}>
            {/* On web, / = my assets (the wallet menu lands here too); phone app still uses home */}
            <Route path="/" element={WEB_SURFACE ? <Navigate to={WEB_HOME} replace /> : <Need><Home /></Need>} />
            <Route path="/portfolio" element={desk(<Need><DeskPortfolio /></Need>, <Need><Home /></Need>)} />
            <Route path="/discover" element={desk(<DeskMarkets />, <Discover />)} />
            <Route path="/token/:chain/:address" element={<TokenRouter fallback={desk(<DeskToken />, <Token />)} />} />
            <Route path="/token/:mint" element={desk(<DeskToken />, <Token />)} />
            <Route path="/swap" element={<Need><Swap /></Need>} />
            {/* Web "spot": holdings / watchlist + instant cross-chain swap (phone app has no entry point; direct links still work) */}
            <Route path="/spot" element={desk(<DeskSpot />, <Spot />)} />
            {/* Monad testnet one-click launch (added 2026-10-07 for hackathon) */}
            <Route path="/launch" element={<Launch />} />
            {/* Zalien-gated agent: BSC holder check -> chat that trades on Monad testnet (added 2026-10-07 for hackathon) */}
            <Route path="/agent" element={<Suspense fallback={null}><Agent /></Suspense>} />
            {/* Perp trading and DMs are 0x4 Wallet exclusives (2026-09-30 goat): web with an external wallet shows the "0x4 Wallet exclusive" card instead (desktop/Ox4Only) */}
            {/* iOS store build ships without perps (lib/features PERP_ENABLED): this route bounces to home */}
            <Route path="/perp" element={PERP_ENABLED ? desk(<Ox4Only feature="perp"><DeskPerp /></Ox4Only>, <Need><Ox4Only feature="perp"><Perp /></Ox4Only></Need>) : <Navigate to="/" replace />} />
            <Route path="/community" element={desk(<DeskCommunity />, <Community />)} />
            <Route path="/g/:id" element={desk(<Need app><DeskChat kind="group" /></Need>, <Need><GroupChat /></Need>)} />
            <Route path="/dm/:address" element={desk(<Need><Ox4Only feature="dm"><DeskChat kind="dm" /></Ox4Only></Need>, <Need><Ox4Only feature="dm"><DmChat /></Ox4Only></Need>)} />
            <Route path="/u/:address" element={desk(<DeskProfile />, <Profile />)} />
            {/* These pages don't have desktop designs yet: on wide web they render in a centered column (DeskColumn) instead of full-bleed */}
            <Route path="/post/:id" element={desk(<DeskColumn chat><PostDetail /></DeskColumn>, <PostDetail />)} />
            <Route path="/live" element={desk(<DeskLive />, <Live />)} />
            {/* Web community meetings / messages / groups (phone app has no such entries: meetings live under "streaming", messages and groups under "community") */}
            <Route path="/meetings" element={desk(<DeskMeetings />, <Navigate to="/live" replace />)} />
            <Route path="/messages" element={desk(<DeskMessages />, <CommunityAt tab="groups" />)} />
            <Route path="/groups" element={desk(<DeskGroups />, <CommunityAt tab={WEB_SURFACE ? 'clubs' : 'groups'} />)} />
            {/* Friends (2026-10-04): a left-rail item in desktop community; the "friends" tab in phone community */}
            <Route path="/friends" element={desk(<DeskFriends />, <CommunityAt tab="friends" />)} />
            <Route path="/room/:id" element={<Need app><Room /></Need>} />
            {/* Meetings (rooms from the former meet.420.meme): meeting code format abc-defg-hij */}
            <Route path="/meet/:code" element={<Need app><Suspense fallback={null}><MeetingRoom /></Suspense></Need>} />
            {/* In-site balance page: doesn't exist in the phone app (lib/features), bounces to home */}
            <Route path="/earnings" element={BALANCE_FEATURES ? <Need><Earnings /></Need> : <Navigate to="/" replace />} />
            {/* Energy & earnings (web: top up energy, host today's earnings / pending / settlement records); no such page in the phone app */}
            <Route path="/energy" element={ENERGY_GIFTS ? <Need app><Suspense fallback={null}>{desk(<DeskColumn><EnergyEarnings /></DeskColumn>, <EnergyEarnings />)}</Suspense></Need> : <Navigate to="/" replace />} />
            <Route path="/rewards" element={desk(<Need><DeskColumn><Rewards /></DeskColumn></Need>, <Need><Rewards /></Need>)} />
            <Route path="/notifications" element={desk(<Need app><DeskNotifications /></Need>, <Need><Notifications /></Need>)} />
            <Route path="/approvals" element={desk(<Need><DeskColumn><Approvals /></DeskColumn></Need>, <Need><Approvals /></Need>)} />
            <Route path="/support" element={desk(<Need><DeskColumn><Support /></DeskColumn></Need>, <Need><Support /></Need>)} />
            <Route path="/support/:id" element={desk(<Need><DeskColumn><SupportTicket /></DeskColumn></Need>, <Need><SupportTicket /></Need>)} />
            {/* "0x4 official" all-member announcements (read-only) */}
            <Route path="/official" element={desk(<DeskChat kind="official" />, <Official />)} />
            {/* Activity log: on wide web it lives in the "My assets → Activity" tab */}
            <Route path="/activity" element={desk(<Navigate to="/portfolio?tab=activity" replace />, <Need><Activity /></Need>)} />
            <Route path="/settings" element={desk(<Need><DeskSettings /></Need>, <Need><Settings /></Need>)} />
            <Route path="/flies" element={desk(<DeskSprites />, <Flies />)} />
            {/* Rankings (web top-nav section): no phone-app entry; direct opens bounce to community */}
            <Route path="/rank" element={desk(<DeskRank />, <CommunityAt tab="rank" />)} />
            <Route path="/fly/:id" element={desk(<Need><DeskColumn><FlyDetail /></DeskColumn></Need>, <Need><FlyDetail /></Need>)} />
            {/* Old watch-page URL: now the "Live" tab of the detail page */}
            <Route path="/fly/:id/live" element={desk(<Need><DeskColumn><FlyDetail /></DeskColumn></Need>, <Need><FlyDetail /></Need>)} />
            <Route path="/pc-login" element={<Need><PcLogin /></Need>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
      <ToastHost />
      {/* New-version prompt on web (never appears in the native app) */}
      <UpdateToast />
      <AlertHost />
      {/* Report, terms acceptance (2026-10-02 store requirement): one site-wide each */}
      <ReportSheet />
      <TermsGate />
      {persistentSession && <UnlockSheet />}
      {/* Web: "connect 0x4 Wallet" panel (notes the extension is coming soon when not installed) */}
      {WEB_SURFACE && <WalletGateHost />}
      {/* Voice/video calls: incoming calls can pop on any page */}
      {!gate && <CallOverlay />}
      {!gate && <LiveBanner />}
    </div>
    </>
  )
}
