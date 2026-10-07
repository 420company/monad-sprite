// Social state: login session, profile, groups, realtime messages, DMs. Chat history lives on the server (DMs stored encrypted-only); fetched when opening a conversation, realtime messages merged/deduped by id.
// Message retention mode (lib/chatPrefs): with "this device only", group chats and DMs also keep an encrypted local copy (lib/localChat),
// DM acked after local save so the server deletes my copy; with "auto-clear daily at 00:00", local history and media cache are wiped at local midnight
import { create } from 'zustand'
import { shortId } from '@/lib/format'
import { registerPush, reportLang } from '@/lib/push'
import { persistentSession, secureStore } from '@/lib/secureStore'
import {
  api, getToken, loginWithWallet, proveEvmLink, setOnUnauthorized, setToken, SocialSocket,
  type Profile, type Group, type Member, type ChatMessage, type DmMessage, type DmPeer, type Notification,
} from '@/lib/social'
import { confirmLocal, decodeDm, isLocalId, mergeMessages, olderCursor, removeIds, type DmWire } from '@/lib/chatHistory'
import { dailyClearDue, deviceTz, loadLocalPrefs, nextLocalMidnight, saveLocalPrefs, type ChatMode } from '@/lib/chatPrefs'
import { LocalChat, localChat } from '@/lib/localChat'
import { mediaCache } from '@/lib/mediaCache'
import type { GroupGate, FlyTick, FlyProposal } from '@/lib/social'
import { isWalletConnected, useWallet } from './wallet'
import type { PollInfo } from '@/components/PollBubble'
import { t } from '@/lib/i18n'
import { errorText, isUserCancel } from '@/lib/errors'
import { notifyHaptic, vibeKindOfNotif } from '@/lib/notifyHaptics'
import { WEB_SURFACE } from '@/lib/surface'
import { userActing } from '@/lib/userActivation'
import { pushLiveBanner } from '@/live/LiveBanner'
import { reportActivity } from '@/desktop/qrIdle'
import { currentRoute } from '@/lib/route'
import { termsAccepted, useBlocks, useTermsGate } from '@/lib/safety'

interface GroupDetail extends Group { members: Member[] }
/** One item in a multi-image group message (server only accepts first-party /files/ URLs) */
export interface GroupAlbumItem { url: string; thumb?: string; w?: number; h?: number; kind?: 'image' | 'video' }

interface SocialState {
  /** Native app: whether the locally saved login token has finished loading (route guard holds its verdict until then) */
  sessionLoaded: boolean
  /** Native app: a valid saved login token lets the user land on home even with the wallet locked */
  hasSession: boolean
  restoreSession: () => Promise<void>
  /** Token expired: clear the saved one; auto re-sign-in if the wallet is unlocked, otherwise let the route guard send the user to the unlock page */
  sessionExpired: () => void
  status: 'idle' | 'logging' | 'ready' | 'error'
  /** Wallet connected but terms not yet accepted, so social login hasn't happened (2026-10-02): the UI must say so and offer the entry point, never show "signing in" */
  needTerms: boolean
  error: string | null
  me: Profile | null
  socket: SocialSocket | null
  wsStatus: 'connecting' | 'open' | 'closed'
  onlineCount: number
  myGroups: Group[]
  discover: Group[]
  details: Record<string, GroupDetail>
  messages: Record<string, ChatMessage[]>
  typing: Record<string, Record<string, number>>
  roomOnline: Record<string, string[]>
  dms: Record<string, DmMessage[]>
  unreadDm: Record<string, number>
  /** DM peer profile (comes with the server's conversation list) */
  dmPeers: Record<string, DmPeer>
  /** Whether older history exists above (for scroll-up pagination) */
  groupHasMore: Record<string, boolean>
  dmHasMore: Record<string, boolean>
  /** Fetch group history: older = one page up, otherwise the latest 50. Returns how many were fetched */
  loadGroupHistory: (groupId: string, older?: boolean) => Promise<number>
  loadDmHistory: (peer: string, older?: boolean) => Promise<number>
  /** DM conversation list (server-side; restored after device switch / app restart) */
  loadDmList: () => Promise<void>
  /** scope: all = delete for everyone (both sides), me = delete only my side */
  deleteGroupMessage: (groupId: string, id: string, scope: 'all' | 'me') => Promise<void>
  deleteDm: (peer: string, id: string, scope: 'all' | 'me') => Promise<void>
  clearDm: (peer: string, scope: 'all' | 'me') => Promise<void>
  /** Message retention mode: cloud = encrypted cloud save / device = this device only / daily = auto-clear at 00:00 daily */
  chatMode: ChatMode
  /**
   * Web: the logged-in account registered a different DM key on the phone app (since 2026-09-30 web logs in
   * with the 0x address and may land on an app account, while the extension derives its DM key from its own
   * Solana private key — not necessarily the same one). Web then can't read incoming DMs (shows "cannot decrypt"),
   * and doesn't register its own key (that would break the app's DM reads); outgoing messages still send fine
   * (the peer's copy encrypted with their key, my copy with the app's key)
   */
  dmKeyElsewhere: boolean
  /** Records at or before this time are hidden (cleared by daily-clear mode; server cron may lag up to 5 min, so the client hides them first) */
  chatClearedBefore: number
  setChatMode: (mode: ChatMode) => Promise<void>
  polls: Record<string, PollInfo>
  /** Notifications */
  notifications: Notification[]
  /** Latest step per fly sprite (WebSocket push) */
  flyTicks: Record<string, FlyTick>
  /** Confirm mode: the fly sprite's pending proposals */
  flyProposals: FlyProposal[]
  dismissProposal: (id: string) => void
  /** Per-contract confirmations: bumped on new requests or status changes; the page refetches /api/fly/asks on change */
  flyAskSeq: number
  unreadNotifs: number
  pendingRequests: number
  /** Per-group unread count and last message (for the message list) */
  unreadGroup: Record<string, number>
  lastMsg: Record<string, ChatMessage>
  /** The group currently open; used to decide whether a message counts as unread */
  activeGroup: string | null
  loadNotifications: () => Promise<void>
  markNotifsRead: (id?: number) => Promise<void>
  setActiveGroup: (id: string | null) => void

  login: () => Promise<void>
  /** Web: this session came from a phone-app QR login (no wallet connected on this computer, 2026-10-01). Social, meetings, live work; trading and gifting need a wallet connection */
  qrMode: boolean
  /** QR login with "trust this device" chosen on the phone: no idle auto-logout */
  qrTrusted: boolean
  /** Web QR login: sign in with the web token issued after scan confirmation (omit = restore from the locally saved one). Returns true on success */
  loginWithQr: (token?: string, trusted?: boolean) => Promise<boolean>
  /** forget = also delete the locally saved token (on wallet reset) */
  logout: (forget?: boolean) => void
  refreshMe: () => Promise<void>
  updateProfile: (p: { nickname?: string; avatar?: string; bio?: string }) => Promise<void>
  loadGroups: (search?: string) => Promise<void>
  loadGroup: (id: string) => Promise<GroupDetail>
  createGroup: (p: { name: string; description?: string; avatar?: string; joinMode?: 'open' | 'approval'; gate?: GroupGate | null }) => Promise<Group>
  joinGroup: (id: string) => Promise<void>
  leaveGroup: (id: string) => Promise<void>
  setRole: (groupId: string, address: string, role: 'admin' | 'member') => Promise<void>
  kick: (groupId: string, address: string) => Promise<void>
  enterRoom: (groupId: string) => void
  exitRoom: (groupId: string) => void
  sendMessage: (groupId: string, text: string, replyTo?: string, mentions?: string[], atAll?: boolean) => void
  sendImage: (groupId: string, url: string) => void
  sendMedia: (groupId: string, kind: 'video' | 'voice', url: string, duration?: number) => void
  /** Multiple images/videos composed into one message (meta.images); meta.url holds the first image so old app versions show at least that */
  sendAlbum: (groupId: string, items: GroupAlbumItem[]) => void
  setPoll: (p: PollInfo) => void
  sendTyping: (groupId: string) => void
  sendDm: (to: string, peerPub: string, text: string) => Promise<void>
  markDmRead: (peer: string) => void
  recordTip: (t: { groupId?: string; to: string; chainId: number; token: string; symbol: string; amount: number; tx: string; message?: string }) => Promise<void>
}

const short = (a: string) => shortId(a) // First 5 + last 3 chars
// No nickname: show abbreviated address, preferring EVM (BSC-first; Solana addresses look unfamiliar to most users, 2026-09-25)
export const displayName = (p?: { nickname?: string | null; address: string; evmAddress?: string | null } | null) => (p ? p.nickname || short(p.evmAddress || p.address) : '')

/** Auto-retry after login failure.
 *
 *  Previously one failure parked the app at status='error' forever, recoverable only via manual "retry" or page
 *  refresh. Backend restarts, a subway-tunnel drop, a laptop waking from sleep — any single blip stranded the
 *  user on the error page even after service recovered. WebSocket already reconnects on its own; login didn't.
 *
 *  Backoff: 2s, 4s, 8s, 16s, then every 30s until success.
 *  ★Web (extension wallet) does NOT auto-retry: each retry pops another extension login window — goat confirmed
 *  on 2026-09-29 that dismissing one just spawns another two seconds later. Web stays at error (reason in
 *  error) and waits for the user to hit "sign in again" or trigger a login-gated action (the write gate in
 *  desktop/walletGate.ts). */
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryCount = 0
const clearRetry = () => { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null } retryCount = 0 }
const scheduleRetry = () => {
  if (retryTimer) return
  retryCount += 1
  const delay = Math.min(30_000, 2_000 * 2 ** (retryCount - 1))
  retryTimer = setTimeout(() => { retryTimer = null; void useSocial.getState().login() }, delay)
}

/**
 * Sign once to prove the EVM address when it hasn't been proven yet (see lib/evmLink.ts).
 * Silent by default: does nothing while the wallet is locked (no unlock prompt for this); the subscription
 * below retries once keysUnlocked turns true.
 * interactive = true is for pre-payment: sign even when locked (the gated signer will prompt unlock, and the
 * user is about to pay anyway); throws on failure so money never moves first.
 * Skipped when old servers don't return evmVerified (undefined).
 */
let evmProofInflight: Promise<boolean> | null = null
const evmProofGaveUp = new Set<string>()   // "account|EVM address" pairs explicitly rejected by the server this session are not retried
export async function proveEvmIfNeeded(opts: { interactive?: boolean } = {}): Promise<boolean> {
  const soc = useSocial.getState()
  const me = soc.me
  if (soc.status !== 'ready' || !me) return false
  if (me.evmVerified !== false) return true
  // Web signatures need an extension popup: never self-trigger without user action (the login window already proved it; old extension versions get topped up via interactive before payment)
  if (WEB_SURFACE && !opts.interactive) return false
  const { evmAccount, evmAddress, keysUnlocked } = useWallet.getState()
  if (!evmAccount || !evmAddress) return false
  if (!opts.interactive && !keysUnlocked) return false
  const key = `${me.address}|${evmAddress.toLowerCase()}`
  if (!opts.interactive && evmProofGaveUp.has(key)) return false
  if (evmProofInflight) return evmProofInflight
  evmProofInflight = (async () => {
    try {
      await proveEvmLink(me.address, evmAccount)
      const cur = useSocial.getState().me
      if (cur?.address === me.address) useSocial.setState({ me: { ...cur, evmAddress, evmVerified: true } })
      // Staff identity may have changed (e.g. super-admin); refetch. Dynamic import avoids a circular dep with lib/staff
      void import('@/lib/staff').then((m) => m.loadStaff(true)).catch(() => {})
      return true
    } catch (e) {
      const status = (e as { status?: number }).status
      if (status && status >= 400 && status < 500) evmProofGaveUp.add(key)
      if (opts.interactive) throw e
      return false
    } finally { evmProofInflight = null }
  })()
  return evmProofInflight
}

/** Saved tokens are bound to an address: switching wallets won't match, so nobody logs in with someone else's token */
const saveSession = (address: string, t: string) => secureStore.set('social-token', JSON.stringify({ address, token: t }))

// ---------- Web login token (2026-09-29 goat: extension kept popping "sign in") ----------
// Web has no native secure storage; tokens used to live only in memory: every refresh or new tab popped another extension login window.
// Now stored per-address in the browser: the same address reuses it first, re-signing only when the server says expired. Tokens last 7 days, renewable server-side up to 90 days after first signature.
// ★The 2026-09-29 security review said delete on extension lock/disconnect; changed 2026-10-06 per goat ("had to sign in again every morning"): no delete on lock (wallet stays attached,
//   just flagged as locked, see desktop/walletGate.ts); deleted only on extension disconnect, 0x4 Wallet disconnect (disconnectOx4), or opening web with no extension attached.
//   Tokens last 7 days, refreshed on each web open and every 6 hours while open, renewable up to 90 days from first signature (server/src/auth.ts WEB_TTL).
//   Web login tells the server it's web (lib/social.ts loginWithWallet passes surface: 'web'); tokens carry a web marker and can't approve computer/admin QR logins (server/src/meetAuth.ts).
//   v: 2 = token with the web marker; previously saved ones (no marker, could approve QR) are discarded and re-signed.
//   v: 3 = since 2026-09-30 web logs in with the 0x address (may land on a phone-app account); tokens saved under the extension's Solana address are discarded and re-signed.
const WEB_SESSION_KEY = '0x4.webSession'
const WEB_SESSION_V = 3
function readWebSession(address: string): string | null {
  if (!WEB_SURFACE) return null
  try {
    const s = JSON.parse(localStorage.getItem(WEB_SESSION_KEY) || 'null') as { address?: string; token?: string; v?: number } | null
    return s && s.v === WEB_SESSION_V && s.address === address && typeof s.token === 'string' && s.token ? s.token : null
  } catch { return null }
}
function saveWebSession(address: string, token: string) {
  if (!WEB_SURFACE) return
  try { localStorage.setItem(WEB_SESSION_KEY, JSON.stringify({ address, token, v: WEB_SESSION_V })) } catch { /* Can't persist in incognito: just means re-signing next time */ }
}
/** Web wallet disconnect: also delete the locally saved login token */
export function forgetWebSession() {
  try { localStorage.removeItem(WEB_SESSION_KEY) } catch { /* ignore */ }
}

// ---------- Web QR-login token (2026-10-01 goat: meet.420.meme retired; plugin-less computers sign into web via phone-app QR) ----------
// Same permissions as the extension-login token, but tied to a server session (kicking it off on the phone invalidates it immediately, server/src/auth.ts WEB_QR_*). Two choices on phone confirm (2026-10-01 goat):
//   - Trust this device: session kept 30 days, no idle logout → localStorage (survives browser close);
//   - This session only (public computer): sessionStorage — exits when the browser/tab closes, idle auto-logout, max 12 hours (see qrIdle.ts).
// Switches to wallet login when a wallet connects (App.tsx); deleted on "sign out".
const QR_SESSION_KEY = '0x4.webQrSession'
type QrSaved = { account: string; token: string; trusted: boolean }
// Old v1 entries in localStorage didn't distinguish trust: delete on sight
try { const old = JSON.parse(localStorage.getItem(QR_SESSION_KEY) || 'null') as { v?: number } | null; if (old && old.v !== 2) localStorage.removeItem(QR_SESSION_KEY) } catch { /* ignore */ }
function parseQr(raw: string | null, trusted: boolean): QrSaved | null {
  const s = JSON.parse(raw || 'null') as { account?: string; token?: string; v?: number } | null
  return s && (s.v === 1 || s.v === 2) && typeof s.account === 'string' && typeof s.token === 'string' && s.token ? { account: s.account, token: s.token, trusted } : null
}
export function readQrSession(): QrSaved | null {
  if (!WEB_SURFACE) return null
  try { return parseQr(sessionStorage.getItem(QR_SESSION_KEY), false) ?? parseQr(localStorage.getItem(QR_SESSION_KEY), true) } catch { return null }
}
function saveQrSession(account: string, token: string, trusted: boolean) {
  if (!WEB_SURFACE) return
  try {
    const v = JSON.stringify({ account, token, v: 2 })
    if (trusted) { localStorage.setItem(QR_SESSION_KEY, v); sessionStorage.removeItem(QR_SESSION_KEY) }
    else { sessionStorage.setItem(QR_SESSION_KEY, v); localStorage.removeItem(QR_SESSION_KEY) }
  } catch { /* Can't persist: just means re-scanning after refresh */ }
}
export function forgetQrSession() {
  try { sessionStorage.removeItem(QR_SESSION_KEY) } catch { /* ignore */ }
  try { localStorage.removeItem(QR_SESSION_KEY) } catch { /* ignore */ }
}

/**
 * Login identity for the current wallet (null when no wallet connected): the Solana address when a Solana
 * signer exists (phone app, 0x4 extension, Phantom); web external wallets are EVM-only (MetaMask etc.,
 * 2026-09-30) so they use the 0x address
 */
export function walletKey(): string | null {
  const w = useWallet.getState()
  if (!isWalletConnected(w)) return null
  return w.wallet ? w.address : w.evmAddress
}

/**
 * One in-flight login per address at a time (2026-09-29). Connecting the web extension mounts the signer
 * twice (connection return + extension-pushed "accounts changed"), with a logout sandwiched in between;
 * the second login() used to see idle and fire another nonce + signature: two login windows, the first
 * nonce invalidated to 401. Now the second one just joins the in-flight attempt.
 */
let loginFlight: { address: string; promise: Promise<void> } | null = null

export const useSocial = create<SocialState>()((set, get) => ({
  sessionLoaded: !persistentSession, hasSession: false,

  async restoreSession() {
    const address = useWallet.getState().address
    const raw = address ? await secureStore.get('social-token') : null
    try {
      const saved = raw ? (JSON.parse(raw) as { address: string; token: string }) : null
      if (saved && saved.address === address && saved.token) {
        setToken(saved.token)
        set({ hasSession: true })
      }
    } catch { /* Corrupt data is treated as absent */ }
    set({ sessionLoaded: true })
  },

  sessionExpired() {
    if (WEB_SURFACE) {
      // Web: re-login needs an extension popup, never self-triggered in the background. Clear the token, park at error with the reason, and wait for the user to hit "sign in again" or the next login-gated action
      forgetWebSession()
      // QR session expired: back to signed-out, scan again next time
      if (get().qrMode) { forgetQrSession(); get().logout(); set({ status: 'error', error: t('登录已过期，请重新扫码登录') }); return }
      if (get().status === 'logging') { setToken(null); return }   // The in-flight login will continue into signature login on its own
      if (get().status !== 'ready') return
      get().logout()
      set({ status: 'error', error: t('登录已过期，请重新登录') })
      return
    }
    if (!get().hasSession && get().status !== 'ready') return
    void secureStore.remove('social-token')
    setToken(null)
    set({ hasSession: false })
    // The in-flight login continues into signature login by itself; don't interfere here or we'd log in twice concurrently
    if (get().status === 'logging') return
    get().logout()
    if (useWallet.getState().keysUnlocked) void get().login()
  },

  status: 'idle', needTerms: false, error: null, me: null, flyTicks: {}, flyProposals: [], flyAskSeq: 0,
  dismissProposal: (id) => set({ flyProposals: get().flyProposals.filter((p) => p.id !== id) }), socket: null, wsStatus: 'closed', onlineCount: 0,
  myGroups: [], discover: [], details: {}, messages: {}, typing: {}, roomOnline: {}, dms: {}, unreadDm: {}, dmPeers: {}, groupHasMore: {}, dmHasMore: {}, polls: {},
  notifications: [], unreadNotifs: 0, pendingRequests: 0, unreadGroup: {}, lastMsg: {}, activeGroup: null,
  chatMode: 'cloud', chatClearedBefore: 0, dmKeyElsewhere: false,

  qrMode: false, qrTrusted: false,

  async loginWithQr(given, givenTrusted) {
    if (!WEB_SURFACE) return false
    const saved = readQrSession()
    const token = given || saved?.token
    const trusted = given ? !!givenTrusted : !!saved?.trusted
    if (!token) return false
    // With a wallet connected, wallet login takes over; the QR token isn't used
    if (walletKey()) return false
    set({ status: 'logging', error: null })
    let user: Profile
    try {
      user = await api<Profile>('/api/me', {}, { token })
    } catch (e) {
      if ((e as { status?: number }).status === 401) { forgetQrSession(); set({ status: 'idle' }) }
      else set({ status: 'error', error: errorText(e, t('登录失败')) || t('登录失败') })
      return false
    }
    // A wallet connected meanwhile: hand over to wallet login
    if (walletKey()) { if (get().status === 'logging') set({ status: 'idle' }); return false }
    setToken(token)
    saveQrSession(user.address, token, trusted)
    if (saved && !given) void refreshToken(user.address, token)
    else lastRefreshAt = Date.now()
    const socket = new SocialSocket()
    socket.onStatus = (st) => set({ wsStatus: st })
    socket.on((d) => { if (get().status === 'ready') handleEvent(d as SocketEvent, set, get) })
    socket.connect()
    clearRetry()
    // DM keys live on the phone/extension, not on a QR-logged computer: DMs prompt to check the phone (dmKeyElsewhere)
    set({ status: 'ready', me: user, socket, qrMode: true, qrTrusted: trusted, dmKeyElsewhere: !!user.encPub })
    void useBlocks.getState().load()
    startWebRefresh()
    get().loadGroups()
    get().loadNotifications()
    reportLang()
    return true
  },

  async login() {
    // Identity for this login: the wallet's Solana address; external wallets (web MetaMask etc., 2026-09-30) have no Solana address, so use their 0x address
    const address = walletKey()
    if (!address) return
    // Terms must be accepted before account creation/login (2026-10-02, store-listing requirement; lib/safety.ts). Not accepted: no login, show the terms sheet; wallet features keep working.
    // Account deletion wipes the acceptance record, so a new account isn't auto-created right after deletion
    if (!termsAccepted(address)) {
      if (get().status !== 'idle' || !get().needTerms) set({ status: 'idle', error: null, needTerms: true })
      useTermsGate.getState().show()
      return
    }
    if (get().needTerms) set({ needTerms: false })
    // QR-logged in and then a wallet connects: switch to wallet login (the wallet's account may differ from the QR one)
    if (get().qrMode) get().logout()
    if (get().status === 'ready') return
    // Same address already logging in: join that attempt, don't fire a second signature (see loginFlight). If a logout in between set it idle, flip the status back to "signing in"
    if (loginFlight?.address === address) { if (get().status !== 'logging') set({ status: 'logging', error: null }); return loginFlight.promise }
    if (get().status === 'logging') return
    const flight = { address, promise: Promise.resolve() }
    flight.promise = runLogin(address).finally(() => { if (loginFlight === flight) loginFlight = null })
    loginFlight = flight
    return flight.promise
  },

  logout(forget) {
    // Phone-QR-logged computer: on exit ("sign out", idle auto-logout, "stop and exit"), invalidate this session server-side first,
    // not just clearing the browser token (pre-launch security review #3, 2026-10-01). Clear locally even if the request fails; pass the current token explicitly since it's wiped right below
    const tok = getToken()
    if (get().qrMode && tok) void api('/api/meet/logout', { method: 'POST', keepalive: true }, { token: tok }).catch(() => { /* Already invalid / offline: still clear locally */ })
    clearRetry()
    stopWebRefresh()
    localLoaded.clear()
    useBlocks.getState().reset()
    if (midnightTimer) { clearTimeout(midnightTimer); midnightTimer = null }
    get().socket?.close()
    setToken(null)
    if (forget) { void secureStore.remove('social-token'); forgetWebSession(); forgetQrSession(); set({ hasSession: false }) }
    set({ status: 'idle', needTerms: false, me: null, qrMode: false, qrTrusted: false, dmKeyElsewhere: false, socket: null, wsStatus: 'closed', myGroups: [], details: {}, messages: {}, dms: {}, unreadDm: {}, dmPeers: {}, groupHasMore: {}, dmHasMore: {}, lastMsg: {}, unreadGroup: {}, typing: {}, roomOnline: {} })
  },

  async refreshMe() { try { const me = await api<Profile>('/api/me'); set({ me }) } catch { /* Ignore */ } },
  async updateProfile(p) {
    const me = await api<Profile>('/api/me', { method: 'PUT', body: JSON.stringify({ ...get().me, ...p }) })
    set({ me })
  },

  async loadGroups(search = '') {
    const [mine, discover] = await Promise.all([api<Group[]>('/api/groups/mine'), api<Group[]>(`/api/groups?q=${encodeURIComponent(search)}`)])
    set({ myGroups: mine, discover })
    // Subscribe to all my groups so messages and unread counts arrive even off the group page
    const socket = get().socket
    if (socket) for (const g of mine) socket.join(g.id)
    // Conversation-list previews: last message per group (server records); don't overwrite when a fresher realtime message already exists
    api<Record<string, ChatMessage>>('/api/groups/mine/last').then((last) => {
      const cur = { ...get().lastMsg }
      // Hide records already cleared by daily-clear mode (before the server cron gets to them)
      for (const [gid, m] of Object.entries(last)) if ((!cur[gid] || cur[gid].ts < m.ts) && m.ts > get().chatClearedBefore) cur[gid] = m
      set({ lastMsg: cur })
    }).catch(() => {})
    api<{ n: number }>('/api/groups/requests/pending-count').then((r) => set({ pendingRequests: r.n })).catch(() => {})
  },

  async loadNotifications() {
    try {
      const r = await api<{ unread: number; list: Notification[] }>('/api/notifications')
      set({ notifications: r.list, unreadNotifs: r.unread })
    } catch { /* ignore */ }
  },
  async markNotifsRead(id) {
    const r = await api<{ unread: number }>('/api/notifications/read', { method: 'POST', body: JSON.stringify(id ? { id } : {}) })
    set({ unreadNotifs: r.unread, notifications: get().notifications.map((n) => (!id || n.id === id ? { ...n, read: true } : n)) })
  },
  setActiveGroup(id) {
    set({ activeGroup: id, unreadGroup: id ? { ...get().unreadGroup, [id]: 0 } : get().unreadGroup })
  },

  async loadGroup(id) {
    const d = await api<GroupDetail>(`/api/groups/${id}`)
    const mine = get().myGroups.find((g) => g.id === id)
    const detail = { ...d, role: mine?.role ?? d.role }
    set({ details: { ...get().details, [id]: detail } })
    return detail
  },

  async createGroup(p) {
    const g = await api<Group>('/api/groups', { method: 'POST', body: JSON.stringify(p) })
    await get().loadGroups()
    return g
  },

  async joinGroup(id) {
    const r = await api<{ ok: boolean; pending?: boolean }>(`/api/groups/${id}/join`, { method: 'POST' })
    await get().loadGroups()
    if (r.pending) throw Object.assign(new Error(t('已提交申请，等群主审核')), { pending: true })
  },
  async leaveGroup(id) {
    await api(`/api/groups/${id}/leave`, { method: 'POST' })
    get().exitRoom(id)
    await get().loadGroups()
  },
  async setRole(groupId, address, role) {
    await api(`/api/groups/${groupId}/members/${address}/role`, { method: 'POST', body: JSON.stringify({ role }) })
    await get().loadGroup(groupId)
  },
  async kick(groupId, address) {
    await api(`/api/groups/${groupId}/members/${address}`, { method: 'DELETE' })
    await get().loadGroup(groupId)
  },

  enterRoom(groupId) { get().socket?.join(groupId) },
  exitRoom(groupId) { get().socket?.leave(groupId) },

  sendMessage(groupId, text, replyTo, mentions, atAll) { get().socket?.send({ type: 'msg', groupId, text, replyTo, mentions, ...(atAll ? { atAll: true } : {}) }); reportActivity('chat') },
  sendTyping(groupId) { get().socket?.send({ type: 'typing', groupId }) },
  sendImage(groupId, url) { get().socket?.send({ type: 'msg', groupId, text: '[图片]', kind: 'image', meta: { url } }) },
  sendMedia(groupId, kind, url, duration) { get().socket?.send({ type: 'msg', groupId, text: kind === 'video' ? '[视频]' : `[语音 ${Math.round(duration || 0)} 秒]`, kind, meta: { url, duration } }) },
  sendAlbum(groupId, items) {
    const first = items.find((x) => x.kind !== 'video') || items[0]
    if (!first) return
    get().socket?.send({ type: 'msg', groupId, text: `[图片] ×${items.length}`, kind: first.kind === 'video' ? 'video' : 'image', meta: { url: first.url, images: items } })
  },
  setPoll(p) { set({ polls: { ...get().polls, [p.id]: p } }) },

  async sendDm(to, peerPub, text) {
    const me = get().me
    if (!me) return
    const dmCrypto = useWallet.getState().dm
    if (!dmCrypto) return
    // Each message encrypted twice: one copy for the peer, one for myself (server-kept, so I can see what I sent after switching phones)
    const myPub = me.encPub || await dmCrypto.publicKey()
    const [payload, self] = await Promise.all([dmCrypto.encrypt(text, peerPub), dmCrypto.encrypt(text, myPub)])
    const cid = `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    // Show plaintext locally first, swap in the official id when the server ack (with cid) arrives. Insert into the list before sending so even the fastest ack matches
    const msg: DmMessage = { id: cid, from: me.address, to, text, ts: Date.now() }
    set({ dms: { ...get().dms, [to]: [...(get().dms[to] || []), msg] } })
    get().socket?.send({ type: 'dm', to, ...payload, self, cid })
  },

  markDmRead(peer) {
    // Server tracks the read position (so unread counts stay right on other devices / next app open); skip the request when locally already 0
    if (get().unreadDm[peer] !== 0 && get().status === 'ready') api(`/api/dms/${peer}/read`, { method: 'POST' }).catch(() => {})
    const changed = get().unreadDm[peer] !== 0
    set({ unreadDm: { ...get().unreadDm, [peer]: 0 } })
    if (changed) saveDmMetaSoon()
  },

  async loadGroupHistory(groupId, older = false) {
    const key = `g:${groupId}:${older}`
    if (inflight.has(key)) return 0
    inflight.add(key)
    try {
      const cursor = older ? olderCursor(get().messages[groupId] || []) : ''
      if (older && !cursor) return 0
      const r = await api<{ messages: ChatMessage[]; hasMore: boolean }>(`/api/groups/${groupId}/messages?limit=50${cursor ? '&' + cursor : ''}`)
      const local = older ? [] : await loadLocal<ChatMessage>('g', groupId)
      keepGroupLocally(groupId, r.messages)
      const list = fresh(mergeMessages(mergeMessages(get().messages[groupId] || [], local), r.messages))
      // When scrolling up, hasMore follows this page; when fetching the latest page, only set it if never scrolled up
      const hasMore = older || get().groupHasMore[groupId] === undefined ? r.hasMore : get().groupHasMore[groupId]
      set({ messages: { ...get().messages, [groupId]: list }, groupHasMore: { ...get().groupHasMore, [groupId]: hasMore } })
      const last = list[list.length - 1]
      if (last && (!get().lastMsg[groupId] || get().lastMsg[groupId].ts < last.ts)) set({ lastMsg: { ...get().lastMsg, [groupId]: last } })
      // Polls: start from the snapshot in the message, then fetch fresh counts and my vote
      for (const m of r.messages) {
        const p = m.meta?.event === 'poll' ? (m.meta.poll as PollInfo | undefined) : undefined
        if (!p || get().polls[p.id]) continue
        get().setPoll(p)
        api<PollInfo>(`/api/polls/${p.id}`).then((fresh) => get().setPoll(fresh)).catch(() => {})
      }
      return r.messages.length
    } finally { inflight.delete(key) }
  },

  async loadDmHistory(peer, older = false) {
    const key = `d:${peer}:${older}`
    if (inflight.has(key)) return 0
    inflight.add(key)
    try {
      const cursor = older ? olderCursor(get().dms[peer] || []) : ''
      if (older && !cursor) return 0
      const r = await api<{ messages: DmWire[]; hasMore: boolean }>(`/api/dms/${peer}?limit=50${cursor ? '&' + cursor : ''}`)
      const dmCrypto = useWallet.getState().dm
      const decoded = await Promise.all(r.messages.map((m) => decodeDm(m, dmCrypto ? (p) => dmCrypto.decrypt(p) : null)))
      const local = older ? [] : await loadLocal<DmMessage>('d', peer)
      void keepDmsLocally(decoded)
      const hasMore = older || get().dmHasMore[peer] === undefined ? r.hasMore : get().dmHasMore[peer]
      set({ dms: { ...get().dms, [peer]: fresh(mergeMessages(mergeMessages(get().dms[peer] || [], local), decoded)) }, dmHasMore: { ...get().dmHasMore, [peer]: hasMore } })
      return r.messages.length
    } finally { inflight.delete(key) }
  },

  async loadDmList() {
    try {
      const list = await api<{ peer: string; lastTs: number; unread: number; last: DmWire | null; profile: DmPeer }[]>('/api/dms')
      const dmCrypto = useWallet.getState().dm
      const dms = { ...get().dms }, unreadDm = { ...get().unreadDm }, dmPeers = { ...get().dmPeers }
      // Locally stored conversations (gone from the server in device-only mode): history, peer profiles, unread counts
      const o = get().me?.address
      if (localChat && o) {
        try {
          const meta = await localChat.getMeta<DmMeta>(o, 'dm')
          if (meta) { Object.assign(dmPeers, meta.peers); Object.assign(unreadDm, meta.unread) }
          for (const peer of await localChat.list(o, 'd')) dms[peer] = mergeMessages(dms[peer] || [], await loadLocal<DmMessage>('d', peer))
        } catch { /* Unreadable local records are treated as absent */ }
      }
      await Promise.all(list.map(async (c) => {
        dmPeers[c.peer] = c.profile
        unreadDm[c.peer] = Math.max(c.unread, get().chatMode === 'device' ? unreadDm[c.peer] || 0 : 0)
        if (c.last) dms[c.peer] = mergeMessages(dms[c.peer] || [], [await decodeDm(c.last, dmCrypto ? (p) => dmCrypto.decrypt(p) : null)])
      }))
      for (const k of Object.keys(dms)) dms[k] = fresh(dms[k])
      set({ dms, unreadDm, dmPeers })
      saveDmMetaSoon()
    } catch { /* A failed conversation-list fetch doesn't break realtime DMs */ }
  },

  async deleteGroupMessage(groupId, id, scope) {
    await api(`/api/groups/${groupId}/messages/${encodeURIComponent(id)}?scope=${scope}`, { method: 'DELETE' })
    removeGroupMessages(groupId, [id], set, get)
    localDo((o, lc) => lc.remove(LocalChat.conv(o, 'g', groupId), [id]))
  },

  async deleteDm(peer, id, scope) {
    // Local messages still awaiting server ack have no server counterpart; remove locally only
    if (!isLocalId(id)) await api(`/api/dms/${peer}/messages/${encodeURIComponent(id)}?scope=${scope}`, { method: 'DELETE' })
    set({ dms: { ...get().dms, [peer]: removeIds(get().dms[peer], [id]) } })
    localDo((o, lc) => lc.remove(LocalChat.conv(o, 'd', peer), [id]))
  },

  async clearDm(peer, scope) {
    await api(`/api/dms/${peer}?scope=${scope}`, { method: 'DELETE' })
    set({ dms: { ...get().dms, [peer]: [] }, unreadDm: { ...get().unreadDm, [peer]: 0 }, dmHasMore: { ...get().dmHasMore, [peer]: false } })
    localDo((o, lc) => lc.clearConv(LocalChat.conv(o, 'd', peer)))
  },

  async setChatMode(mode) {
    const o = get().me?.address
    if (!o || get().status !== 'ready') throw new Error(t('社交服务未连接'))
    const prev = get().chatMode
    const r = await api<ServerChatPrefs>('/api/me/chat-prefs', { method: 'PUT', body: JSON.stringify({ mode, ...deviceTz() }) })
    // Just switched to daily-clear: from now on, pre-midnight records wait for tonight's wipe
    saveLocalPrefs(o, { mode: r.mode, ...(r.mode === 'daily' && prev !== 'daily' ? { lastClear: Date.now() } : {}) })
    set({ chatMode: r.mode })
    armMidnight()
    if (r.mode === 'device' && prev !== 'device') {
      // Persist already-loaded history locally first, then pull down all my remaining server copies, save them, and ack in batches (server deletes as it goes)
      for (const [gid, list] of Object.entries(get().messages)) keepGroupLocally(gid, list)
      await keepDmsLocally(Object.values(get().dms).flat())
      await syncPendingDms()
    }
  },

  async recordTip(t) {
    await api('/api/tips', { method: 'POST', body: JSON.stringify(t) })
  },
}))

type SocketEvent = { type: string } & Record<string, unknown>

/** The login attempt itself (login() ensures one attempt per address). address = wallet address at kickoff; the attempt is voided if the wallet switches/disconnects mid-flight */
async function runLogin(address: string): Promise<void> {
  const set = useSocial.setState, get = useSocial.getState
  const { wallet, dm: dmCrypto, evmAddress, evmAccount, keysUnlocked, kind } = useWallet.getState()
  if (!walletKey()) return
  /** The web-connected 0x4 extension is currently locked (since 2026-10-06 locking the extension no longer signs web out; the extension may be locked when web opens) */
  const extLocked = WEB_SURFACE && kind === 'ox4' && !keysUnlocked
  /** Is the wallet still the kickoff address? (web extension lock/disconnect/account-switch detaches the wallet) */
  const still = () => walletKey() === address
  set({ status: 'logging', error: null })
  try {
    let user: Profile | null = null
    // ★Keep this attempt's token in a local variable; promote it to the global token only after confirming the wallet is still the kickoff address (2026-09-29 review:
    // previously signature login set the token globally the moment it arrived, and web's saved token was set before verification — a mid-flight account switch let the new address's login reuse the old address's token)
    let token: string | null = getToken()
    // Web: try this address's previously saved token first (no re-sign on refresh)
    if (WEB_SURFACE && !token) token = readWebSession(address)
    let fromSaved = false
    // Native app / web: try the locally saved token first; skip signing when it works
    if ((persistentSession || WEB_SURFACE) && token) {
      try {
        user = await api<Profile>('/api/me', {}, { token })
        fromSaved = true
      } catch (e) {
        if ((e as { status?: number }).status !== 401) throw e   // Offline etc.: native goes through retry, token kept
        user = null   // 401: native clears via sessionExpired triggered by api(); web clears it here
        token = null
        if (WEB_SURFACE) { forgetWebSession(); setToken(null) }
      }
    }
    if (!user) {
      // No usable token: wallet signature login needed. Don't prompt auth while the wallet is locked — hand it to the route guard for the unlock page
      if (persistentSession && !keysUnlocked) {
        set({ status: 'idle', hasSession: false })
        return
      }
      // Web with locked extension and expired saved token: don't sign unless user-initiated (signing needs the extension's unlock popup first; popping one on page open is unacceptable).
      // Park at "login expired"; come back when the user hits "sign in again" or does something login-gated (walletGate needSocialLogin) — then the extension pops unlock + login
      if (extLocked && !userActing()) {
        set({ status: 'error', error: t('登录已过期，请重新登录') })
        return
      }
      // Wallet unlocked: also sign once with the EVM key to prove the EVM address belongs to this account (admin badges etc. only trust proven ones). In the web extension both happen in the same window
      const r = await loginWithWallet(wallet, evmAddress, keysUnlocked ? evmAccount : null)
      user = r.user
      token = r.token
      // Native: token stored per-address in the keychain (an account switch won't match, so it can't be reused)
      if (persistentSession) { void saveSession(address, r.token); set({ hasSession: true }) }
    }
    if (!still()) { abandon(address); return }
    setToken(token)
    // Web: stored per-address only after confirming it's still this wallet (deleted on extension lock/disconnect, see desktop/walletGate.ts)
    saveWebSession(address, token!)
    // Logged in with a saved token: refresh it opportunistically (7 fresh days on app and web, up to 90 days from signature login); a server refresh refusal doesn't break this login
    if (fromSaved && user) void refreshToken(address, token!)
    else lastRefreshAt = Date.now()   // Fresh token from just-signed login: no need to refresh yet
    // Register this device's encryption public key on the profile so others can send me ciphertext. Skipped when the DM key is unavailable — never blocks login.
    // Web with locked extension: don't ask the extension for the public key (it would pop the unlock window); backfill after unlock (syncExtensionDmKey)
    const encPub = dmCrypto && !extLocked ? await dmCrypto.publicKey().catch(() => null) : null
    const { me, keyElsewhere } = await registerDmKey(user, encPub)
    if (!still()) { abandon(address); return }
    const socket = new SocialSocket()
    socket.onStatus = (s) => set({ wsStatus: s })
    socket.on((d) => { if (get().status === 'ready') handleEvent(d as SocketEvent, set, get) })
    socket.connect()
    clearRetry()
    set({ status: 'ready', me, socket, dmKeyElsewhere: keyElsewhere })
    // Blocklist: messages from blocked users are collapsed in group chats and live danmaku
    void useBlocks.getState().load()
    startWebRefresh()
    get().loadGroups()
    // Settle the retention mode before fetching the DM list: device-only mode must read local records first
    void initChatPrefs().finally(() => { void get().loadDmList() })
    get().loadNotifications()
    // Refresh my holdings snapshot (for the "top holder communities" ranking on coin detail pages); server throttles to 10 min, failures ignored
    api('/api/me/holdings/refresh', { method: 'POST' }).catch(() => {})
    void registerPush()
    reportLang()
    // Token-logged-in, or EVM signature failed at login: top up the signature now if the wallet is unlocked (if locked, wait for next unlock — no popup; web never self-pops)
    void proveEvmIfNeeded()
  } catch (e) {
    if (!still()) { abandon(address); return }
    // User rejected / closed the window in the extension: say so plainly, don't show it as a red error
    set({ status: 'error', error: isUserCancel(e) ? t('你取消了登录签名。需要时点「重新登录」') : errorText(e, t('登录失败')) || t('登录失败') })
    // Web doesn't auto-retry (each retry pops another extension window); see the note above scheduleRetry
    if (!WEB_SURFACE) scheduleRetry()
  }
}

/**
 * Register the DM public key (at login, plus backfill after web extension unlock). Returns the updated
 * profile and keyElsewhere: when web logs into a phone-app account via 0x but the app registered a different
 * DM key, don't overwrite (overwriting would break the app's DM reads) — web instead prompts to check DMs
 * on the phone (dmKeyElsewhere)
 */
async function registerDmKey(user: Profile, encPub: string | null): Promise<{ me: Profile; keyElsewhere: boolean }> {
  const keyElsewhere = WEB_SURFACE && !!encPub && !!user.encPub && user.encPub !== encPub
  const me = !encPub || user.encPub === encPub || keyElsewhere ? user : await api<Profile>('/api/me', { method: 'PUT', body: JSON.stringify({ nickname: user.nickname, avatar: user.avatar, bio: user.bio, encPub }) })
  return { me, keyElsewhere }
}

/**
 * Web 0x4 extension went from locked to unlocked (since 2026-10-06 locking the extension no longer signs
 * web out): backfill the DM public key registration skipped while locked; re-pull and decrypt DMs that
 * arrived locked
 */
async function syncAfterExtensionUnlock(): Promise<void> {
  const st = useSocial.getState()
  if (st.status !== 'ready' || !st.me || st.qrMode) return
  const { dm, kind } = useWallet.getState()
  if (kind !== 'ox4' || !dm) return
  const address = walletKey()
  try {
    const encPub = await dm.publicKey().catch(() => null)
    const { me, keyElsewhere } = await registerDmKey(st.me, encPub)
    if (walletKey() !== address || useSocial.getState().status !== 'ready') return
    useSocial.setState({ me, dmKeyElsewhere: keyElsewhere })
  } catch { /* Registration failure doesn't block reading DMs; retry at next login */ }
  const peers = Object.entries(useSocial.getState().dms).filter(([, list]) => list.some((m) => m.locked)).map(([peer]) => peer)
  await useSocial.getState().loadDmList()
  for (const peer of peers) void useSocial.getState().loadDmHistory(peer).catch(() => {})
  if (deviceMode()) void syncPendingDms().catch(() => {})
}

/** Swap a still-valid token for a fresh one (/api/auth/refresh). Discard it if logout / token swap happened meanwhile; failures ignored (the token itself is still valid, renew next time) */
function refreshToken(address: string, used: string): Promise<void> {
  lastRefreshAt = Date.now()
  return api<{ token: string }>('/api/auth/refresh', { method: 'POST' }, { token: used })
    .then((r) => {
      if (getToken() !== used) return   // Logged out / token swapped meanwhile
      setToken(r.token)
      if (persistentSession) void saveSession(address, r.token)
      if (useSocial.getState().qrMode) saveQrSession(address, r.token, useSocial.getState().qrTrusted)
      else saveWebSession(address, r.token)
    })
    .catch(() => {})
}

/**
 * Renewal while a web tab stays open (follow-up to the 2026-09-29 review, item 8). Web tokens then lasted
 * only 24h (7 days since 2026-10-06, server WEB_TTL) and were renewed only on page open — a tab left open
 * past 24h got signed out. Now renewed every 6 hours while open (checked every 15 min, so the first check
 * after the computer wakes catches up), plus on tab refocus when >10 min since last renewal.
 * Renewal cap is 90 days from signature login (was 7 days before 2026-10-06, governed by server
 * WEB_AUTH_MAX_AGE_MS); at the cap, refresh returns 401 and we go through "login expired, please sign in again".
 * Phone-app tokens last 7 days and renew on every open, so this isn't needed there.
 */
export const WEB_REFRESH_EVERY_MS = 6 * 3600_000
const WEB_REFRESH_ON_SHOW_MS = 10 * 60_000
const WEB_REFRESH_CHECK_MS = 15 * 60_000
let lastRefreshAt = 0
let webRefreshTimer: ReturnType<typeof setInterval> | null = null
function webRefreshIfDue(minGap: number) {
  const st = useSocial.getState(), used = getToken(), address = st.me?.address
  // QR login (no wallet): renew per account; wallet login: renew only if the wallet is still this address
  if (!WEB_SURFACE || st.status !== 'ready' || !used || !address || (!st.qrMode && address !== useWallet.getState().address)) return
  if (Date.now() - lastRefreshAt < minGap) return
  void refreshToken(address, used)
}
function startWebRefresh() {
  if (!WEB_SURFACE) return
  stopWebRefresh()
  webRefreshTimer = setInterval(() => webRefreshIfDue(WEB_REFRESH_EVERY_MS), WEB_REFRESH_CHECK_MS)
}
function stopWebRefresh() {
  if (webRefreshTimer) { clearInterval(webRefreshTimer); webRefreshTimer = null }
}

/** Wallet switched/disconnected mid-login: drop this attempt's result (token already saved per-address). If the wallet switched to another address, log that address in */
function abandon(address: string) {
  // The new address is already logging in (app kicked it off during the switch): status and token are its own, don't touch
  if (loginFlight && loginFlight.address !== address) return
  if (useSocial.getState().status === 'logging') { setToken(null); useSocial.setState({ status: 'idle', me: null }) }
  const key = walletKey()
  if (key && key !== address) setTimeout(() => { void useSocial.getState().login() }, 0)
}

// ---------- Message retention modes ----------

interface ServerChatPrefs { mode: ChatMode; tz: string | null; tzOffset: number | null; groupClearedBefore: number; nextClearAt: number | null }
/** Locally stored DM conversation extras: peer profiles (so the list still recognizes people after server records are deleted), unread counts */
interface DmMeta { peers: Record<string, DmPeer>; unread: Record<string, number> }

const S = () => useSocial.getState()
const ownerAddr = () => S().me?.address || null
const deviceMode = () => S().chatMode === 'device' && !!localChat && !!ownerAddr()

/** Local-record read/write errors never affect the UI; swallowed */
function localDo(fn: (owner: string, lc: LocalChat) => Promise<unknown>) {
  const o = ownerAddr()
  if (localChat && o) fn(o, localChat).catch(() => {})
}

/** Each conversation's local records are read once, on first open */
const localLoaded = new Set<string>()
async function loadLocal<T extends { id: string; ts: number }>(kind: 'g' | 'd', id: string): Promise<T[]> {
  const o = ownerAddr()
  if (!localChat || !o) return []
  const conv = LocalChat.conv(o, kind, id)
  if (localLoaded.has(conv)) return []
  localLoaded.add(conv)
  try { return await localChat.load<T>(conv) } catch { return [] }
}

/** After a daily-clear wipe, records older than the wipe point stay hidden */
function fresh<T extends { ts: number }>(list: T[]): T[] {
  const cb = S().chatClearedBefore
  return cb ? list.filter((m) => m.ts > cb) : list
}

function keepGroupLocally(groupId: string, msgs: ChatMessage[]) {
  if (!deviceMode() || !msgs.length) return
  localDo((o, lc) => lc.save(LocalChat.conv(o, 'g', groupId), msgs))
}

/**
 * Device-only mode: ack a DM only after it's safely stored encrypted locally.
 * Undecryptable ones are neither stored nor acked (still pullable from the server after next unlock);
 * unsent local temp messages aren't stored.
 */
async function keepDmsLocally(msgs: DmMessage[]): Promise<void> {
  const o = ownerAddr()
  if (!deviceMode() || !localChat || !o) return
  const ok = msgs.filter((m) => !m.undecryptable && !isLocalId(m.id))
  if (!ok.length) return
  const byPeer = new Map<string, DmMessage[]>()
  for (const m of ok) { const p = m.from === o ? m.to : m.from; byPeer.set(p, [...(byPeer.get(p) || []), m]) }
  try { for (const [peer, list] of byPeer) await localChat.save(LocalChat.conv(o, 'd', peer), list) }
  catch { return }   // Not stored → not acked; the server copy stays
  queueAck(ok.map((m) => m.id))
  saveDmMetaSoon()
}

/** Acks are batched and flushed every 300ms */
let ackQueue: string[] = []
let ackTimer: ReturnType<typeof setTimeout> | null = null
function queueAck(ids: string[]) {
  ackQueue.push(...ids)
  if (ackTimer) return
  ackTimer = setTimeout(flushAck, 300)
}
async function flushAck() {
  ackTimer = null
  while (ackQueue.length) {
    const ids = ackQueue.splice(0, 500)
    // Failed (offline) acks aren't retried: the server copy survives, and next online syncPendingDms pulls and acks again
    await api('/api/dms/ack', { method: 'POST', body: JSON.stringify({ ids }) }).catch(() => {})
  }
}
/** Test only: flush pending acks immediately */
export const flushChatAcks = () => { if (ackTimer) { clearTimeout(ackTimer); ackTimer = null } return flushAck() }

let metaTimer: ReturnType<typeof setTimeout> | null = null
function saveDmMetaSoon() {
  if (!deviceMode() || metaTimer) return
  metaTimer = setTimeout(() => {
    metaTimer = null
    const { dmPeers, unreadDm } = S()
    localDo((o, lc) => lc.setMeta(o, 'dm', { peers: dmPeers, unread: unreadDm } satisfies DmMeta))
  }, 500)
}

/** Device-only mode: pull down all DMs the server still holds for me, store locally, then ack */
let syncing: Promise<void> | null = null
export function syncPendingDms(): Promise<void> {
  syncing ||= (async () => {
    let after = 0, afterId = ''
    for (let guard = 0; guard < 100 && deviceMode(); guard++) {
      const r = await api<{ messages: DmWire[]; hasMore: boolean }>(`/api/dms/pending?limit=200&after=${after}&afterId=${encodeURIComponent(afterId)}`)
      if (!r.messages.length) break
      const dmCrypto = useWallet.getState().dm
      const decoded = await Promise.all(r.messages.map((m) => decodeDm(m, dmCrypto ? (p) => dmCrypto.decrypt(p) : null)))
      const o = ownerAddr()!
      const dms = { ...S().dms }
      for (const m of decoded) { const p = m.from === o ? m.to : m.from; dms[p] = mergeMessages(dms[p] || [], [m]) }
      useSocial.setState({ dms })
      await keepDmsLocally(decoded)
      const last = r.messages[r.messages.length - 1]
      after = last.ts; afterId = last.id
      if (!r.hasMore) break
    }
    await flushChatAcks()
  })().catch(() => {}).finally(() => { syncing = null })
  return syncing
}

/** After login: take the server's mode as source of truth, sync timezone, wipe on schedule, and in device-only mode pull DMs from the offline gap */
export async function initChatPrefs(): Promise<void> {
  const o = ownerAddr()
  if (!o) return
  const local = loadLocalPrefs(o)
  useSocial.setState({ chatMode: local.mode, chatClearedBefore: local.clearedBefore })
  try {
    const r = await api<ServerChatPrefs>('/api/me/chat-prefs')
    if (r.mode !== local.mode) saveLocalPrefs(o, { mode: r.mode, ...(r.mode === 'daily' ? { lastClear: Date.now() } : {}) })
    useSocial.setState({ chatMode: r.mode, chatClearedBefore: Math.max(local.clearedBefore, r.groupClearedBefore || 0) })
    // Timezone changed (traveling): midnight follows the new zone
    const tz = deviceTz()
    if (r.mode === 'daily' && (r.tz !== tz.tz || r.tzOffset !== tz.tzOffset)) api('/api/me/chat-prefs', { method: 'PUT', body: JSON.stringify(tz) }).catch(() => {})
  } catch { /* Falls back to the locally remembered value when unfetchable */ }
  checkDailyClear()
  armMidnight()
  if (S().chatMode === 'device') await syncPendingDms()
}

/** Daily-clear mode: past local midnight, wipe local records and media cache; pre-midnight UI records are hidden too */
export function checkDailyClear(now = Date.now()): boolean {
  const o = ownerAddr()
  if (!o) return false
  const p = loadLocalPrefs(o)
  const at = dailyClearDue(S().chatMode, p.lastClear, now)
  if (!at) return false
  saveLocalPrefs(o, { lastClear: now, clearedBefore: at })
  const before = <T extends { ts: number }>(rec: Record<string, T[]>) => Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, v.filter((m) => m.ts > at)]))
  const lastMsg = Object.fromEntries(Object.entries(S().lastMsg).filter(([, m]) => m.ts > at))
  useSocial.setState({ chatClearedBefore: at, messages: before(S().messages), dms: before(S().dms), lastMsg })
  localLoaded.clear()
  localDo((owner, lc) => lc.clearOwner(owner))
  mediaCache?.clear().catch(() => {})
  return true
}

let midnightTimer: ReturnType<typeof setTimeout> | null = null
function armMidnight() {
  if (midnightTimer) { clearTimeout(midnightTimer); midnightTimer = null }
  if (S().chatMode !== 'daily') return
  midnightTimer = setTimeout(() => { midnightTimer = null; checkDailyClear(); armMidnight() }, nextLocalMidnight() - Date.now() + 1000)
}

/** One page in flight per conversation at a time */
const inflight = new Set<string>()

/** Remove messages from a group; if the removed one was the conversation-list preview, replace it with the newest remaining */
function removeGroupMessages(groupId: string, ids: string[], set: (p: Partial<SocialState>) => void, get: () => SocialState) {
  const list = removeIds(get().messages[groupId], ids)
  const patch: Partial<SocialState> = { messages: { ...get().messages, [groupId]: list } }
  const last = get().lastMsg[groupId]
  if (last && ids.includes(last.id)) {
    const lastMsg = { ...get().lastMsg }
    if (list.length) lastMsg[groupId] = list[list.length - 1]; else delete lastMsg[groupId]
    patch.lastMsg = lastMsg
  }
  set(patch)
}

async function handleEvent(d: SocketEvent, set: (p: Partial<SocialState>) => void, get: () => SocialState) {
  switch (d.type) {
    case 'hello': set({ onlineCount: Number(d.online || 0) }); break
    case 'joined': {
      const groupId = String(d.groupId)
      const recent = (d.recent as ChatMessage[]) || []
      // Merge the last-60s cache with fetched history instead of overwriting wholesale
      keepGroupLocally(groupId, recent)
      set({ messages: { ...get().messages, [groupId]: fresh(mergeMessages(get().messages[groupId] || [], recent)) }, roomOnline: { ...get().roomOnline, [groupId]: (d.online as string[]) || [] } })
      recent.forEach((m) => { if (m.meta?.event === 'poll' && m.meta.poll) get().setPoll(m.meta.poll as PollInfo) })
      if (recent.length && !get().lastMsg[groupId]) set({ lastMsg: { ...get().lastMsg, [groupId]: recent[recent.length - 1] } })
      break
    }
    case 'msg': {
      const msg = d.msg as ChatMessage
      const list = get().messages[msg.groupId] || []
      if (list.some((m) => m.id === msg.id)) break   // Already in history
      keepGroupLocally(msg.groupId, [msg])
      const mine = msg.from === get().me?.address
      const viewing = get().activeGroup === msg.groupId
      set({
        messages: { ...get().messages, [msg.groupId]: mergeMessages(list, [msg]) },
        lastMsg: { ...get().lastMsg, [msg.groupId]: msg },
        unreadGroup: viewing || mine || msg.kind === 'system' ? get().unreadGroup : { ...get().unreadGroup, [msg.groupId]: (get().unreadGroup[msg.groupId] || 0) + 1 },
      })
      if (msg.meta?.event === 'poll' && msg.meta.poll) get().setPoll(msg.meta.poll as PollInfo)
      // Someone started a group meeting (2026-10-07): flag the group "in meeting" in the message list right away (cleared by the group page / next group-list fetch when it ends)
      if (msg.kind === 'system' && msg.meta?.event === 'meeting' && msg.meta.meeting) {
        const mt = msg.meta.meeting as { id: string; title: string; hasPassword?: boolean }
        set({ myGroups: get().myGroups.map((g) => (g.id === msg.groupId ? { ...g, meeting: { id: mt.id, title: mt.title, host: msg.from, hostNickname: null, hasPassword: !!mt.hasPassword, participants: 0, since: null } } : g)) })
      }
      if (msg.kind === 'system' && (msg.meta?.event === 'join' || msg.meta?.event === 'kick' || msg.meta?.event === 'group_update')) get().loadGroup(msg.groupId).catch(() => {})
      // Group-message haptics (off by default): others' messages only, not system messages, not while viewing the group; mentions get their own mention-notification buzz below, no double buzz here
      if (!mine && !viewing && msg.kind !== 'system' && !(msg.mentions || []).includes(get().me?.address || '')) notifyHaptic('group')
      break
    }
    case 'msgdel': {
      const gid = String(d.groupId), ids = (d.ids as string[]) || []
      removeGroupMessages(gid, ids, set, get)
      localDo((o, lc) => lc.remove(LocalChat.conv(o, 'g', gid), ids))
      break
    }
    case 'fly': set({ flyTicks: { ...get().flyTicks, [d.flyId as string]: d.tick as FlyTick } }); break
    case 'fly_proposal': set({ flyProposals: [d.proposal as FlyProposal, ...get().flyProposals].slice(0, 10) }); break
    case 'fly_ask': set({ flyAskSeq: get().flyAskSeq + 1 }); notifyHaptic('fly'); break
    case 'notify': {
      const n = d.n as Notification
      // Server updates a merged notification in place (fly sprite trade requests from while you were away, 2026-10-04): same id replaces the old one and moves to top; don't double-count unread if it was never read
      const old = get().notifications.find((x) => x.id === n.id)
      if (old) {
        set({ notifications: [n, ...get().notifications.filter((x) => x.id !== n.id)], unreadNotifs: get().unreadNotifs + (old.read ? 1 : 0) })
        break
      }
      set({ notifications: [n, ...get().notifications].slice(0, 100), unreadNotifs: get().unreadNotifs + 1 })
      if (n.type === 'join_request') set({ pendingRequests: get().pendingRequests + 1 })
      // Someone I follow went live: top banner (2026-09-30)
      if ((n.type as string) === 'live') pushLiveBanner(n as unknown as Parameters<typeof pushLiveBanner>[0])
      // DM notifications: no buzz while chatting with this person (the message is already seen)
      if (!(n.type === 'dm' && n.actor && viewingDm(n.actor))) notifyHaptic(vibeKindOfNotif(n.type, n.ref))
      break
    }
    case 'poll': {
      const p = d.poll as PollInfo
      // Keep my own vote, only refresh the counts
      const mine = get().polls[p.id]?.myVote ?? null
      get().setPoll({ ...p, myVote: mine })
      break
    }
    case 'typing': {
      const groupId = String(d.groupId)
      set({ typing: { ...get().typing, [groupId]: { ...(get().typing[groupId] || {}), [String(d.from)]: Date.now() } } })
      break
    }
    case 'dm': {
      const dmCrypto = useWallet.getState().dm
      const decrypt = dmCrypto ? (p: { ciphertext: string; nonce: string; epk: string }) => dmCrypto.decrypt(p) : null
      const wire = { id: String(d.id), from: String(d.from), to: String(d.to), ts: Number(d.ts) }
      if (d.echo) {
        // Ack of my own send: swap the local message to the official id; messages sent from other devices are backfilled by decrypting "my copy"
        const peer = wire.to
        const confirmed = typeof d.cid === 'string' ? confirmLocal(get().dms[peer], d.cid, wire.id, wire.ts) : null
        if (confirmed) {
          set({ dms: { ...get().dms, [peer]: confirmed } })
          void keepDmsLocally(confirmed.filter((m) => m.id === wire.id))
          break
        }
        if ((get().dms[peer] || []).some((m) => m.id === wire.id)) break
        const self = d.self as { ciphertext: string; nonce: string; epk: string } | undefined
        const msg = await decodeDm(self ? { ...wire, ...self } : { ...wire, legacy: true }, decrypt)
        set({ dms: { ...get().dms, [peer]: mergeMessages(get().dms[peer] || [], [msg]) } })
        void keepDmsLocally([msg])
        break
      }
      const from = wire.from
      if ((get().dms[from] || []).some((m) => m.id === wire.id)) break
      const msg = await decodeDm({ ...wire, ciphertext: String(d.ciphertext || ''), nonce: String(d.nonce || ''), epk: String(d.epk || '') }, decrypt)
      set({ dms: { ...get().dms, [from]: mergeMessages(get().dms[from] || [], [msg]) }, unreadDm: { ...get().unreadDm, [from]: (get().unreadDm[from] || 0) + 1 } })
      void keepDmsLocally([msg])
      saveDmMetaSoon()
      if (!viewingDm(from)) notifyHaptic('dm')
      break
    }
    case 'dmdel': {
      const peer = String(d.peer)
      const ids = (d.ids as string[]) || []
      set({ dms: { ...get().dms, [peer]: removeIds(get().dms[peer], ids) } })
      localDo((o, lc) => lc.remove(LocalChat.conv(o, 'd', peer), ids))
      break
    }
    case 'dmclear': {
      const peer = String(d.peer)
      set({ dms: { ...get().dms, [peer]: [] }, unreadDm: { ...get().unreadDm, [peer]: 0 } })
      localDo((o, lc) => lc.clearConv(LocalChat.conv(o, 'd', peer)))
      break
    }
    case 'error': {
      set({ error: String(d.error) })
      // Group send rejections (muted, all-muted, @all too frequent) must be visible to the sender
      if (d.groupId) import('@/components/Toast').then(({ toast }) => toast.error(t(String(d.error)))).catch(() => {})
      break
    }
  }
}


/** Currently DMing this person (DM page is #/dm/<address>): no buzz for incoming messages */
function viewingDm(peer: string): boolean {
  if (typeof location === 'undefined') return false
  try { return decodeURIComponent(currentRoute()).toLowerCase().startsWith(`/dm/${peer.toLowerCase()}`) } catch { return false }
}

/** Test only: feed a WebSocket event into the store (production path is SocialSocket's listeners) */
export const handleSocketEvent = (d: SocketEvent) => handleEvent(d, useSocial.setState, useSocial.getState)

setOnUnauthorized(() => useSocial.getState().sessionExpired())

// Network back, or page visible again (phone switched back, computer woke): run a login catch-up immediately,
// no waiting on the backoff timer. If already ready, login() returns internally on its own.
if (typeof window !== 'undefined') {
  const retryNow = () => {
    const st = useSocial.getState()
    // Web: retrying needs an extension login popup — popping one on tab refocus was one of goat's 9/29 "confirmed and it popped again" cases; not doing it
    if (st.status !== 'error' || WEB_SURFACE) return
    clearRetry()
    void st.login()
  }
  window.addEventListener('online', retryNow)
  // Phone sleep pauses timers: run a midnight check on foregrounding
  // Web tab refocus: refresh the token if >10 min since last renewal (webRefreshIfDue, no popups)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { retryNow(); webRefreshIfDue(WEB_REFRESH_ON_SHOW_MS); if (checkDailyClear()) armMidnight() } })
}

// Wallet locked → unlocked (unlock page / UnlockSheet / Face ID success): if social is logged in and the EVM address is still unproven, silently sign once to prove it
useWallet.subscribe((cur, prev) => {
  if (cur.keysUnlocked && !prev.keysUnlocked) {
    void proveEvmIfNeeded()
    // Web extension unlock (same wallet, not a fresh mount): backfill the DM public key registration and decrypt DMs that stayed locked
    if (WEB_SURFACE && cur.kind === 'ox4' && prev.kind === 'ox4' && cur.address === prev.address) void syncAfterExtensionUnlock()
  }
})
