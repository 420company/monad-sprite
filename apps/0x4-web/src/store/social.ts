// 社交状态：登录会话、资料、群、实时消息、私信。聊天记录存在服务器（私信只存密文），进会话时拉取，实时消息按 id 合并去重。
// 消息记录模式（lib/chatPrefs）：「只存在这台手机」时群聊和私信另存一份在本机（lib/localChat，加密），
// 私信本机存好后回 ack 让服务器删掉我那份；「每天 00:00 自动清空」时本机零点清掉本地记录和媒体缓存
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
/** 群多图消息里的一项（服务端只收本站 /files/ 地址） */
export interface GroupAlbumItem { url: string; thumb?: string; w?: number; h?: number; kind?: 'image' | 'video' }

interface SocialState {
  /** 原生 App：本机保存的登录令牌读完了没有（读完之前路由守卫先不做判断） */
  sessionLoaded: boolean
  /** 原生 App：本机有可用的登录令牌 → 钱包锁着也能直接进首页 */
  hasSession: boolean
  restoreSession: () => Promise<void>
  /** 令牌失效：清掉本机保存的，钱包解锁着就自动重新签名登录，锁着就交给路由守卫送回解锁页 */
  sessionExpired: () => void
  status: 'idle' | 'logging' | 'ready' | 'error'
  /** 钱包连着、但还没同意条款所以没登录社交功能（2026-10-02）：界面上说清楚并给入口，不能显示成「正在登录」 */
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
  /** 私信会话对方的资料（服务器会话列表带回来的） */
  dmPeers: Record<string, DmPeer>
  /** 往上翻还有没有更早的记录 */
  groupHasMore: Record<string, boolean>
  dmHasMore: Record<string, boolean>
  /** 拉群聊记录：older = 往上翻一页，否则拉最近 50 条。返回拉到几条 */
  loadGroupHistory: (groupId: string, older?: boolean) => Promise<number>
  loadDmHistory: (peer: string, older?: boolean) => Promise<number>
  /** 私信会话列表（服务器上的，换设备 / 重开 App 后恢复） */
  loadDmList: () => Promise<void>
  /** scope：all = 为所有人（双方）删除，me = 只删除我这边 */
  deleteGroupMessage: (groupId: string, id: string, scope: 'all' | 'me') => Promise<void>
  deleteDm: (peer: string, id: string, scope: 'all' | 'me') => Promise<void>
  clearDm: (peer: string, scope: 'all' | 'me') => Promise<void>
  /** 消息记录模式：cloud 加密云端保存 / device 只存在这台手机 / daily 每天 00:00 自动清空 */
  chatMode: ChatMode
  /**
   * 网页版：登进的账号在手机 App 上登记过另一把私信钥匙（2026-09-30 起网页版用 0x 地址登录，可能登进 App 的账号，
   * 而插件的私信钥匙按插件自己的 Solana 私钥派生，和 App 的不一定是同一把）。这时网页版读不了收到的私信（显示「无法解密」），
   * 也不把自己的钥匙登记上去（登记了 App 就读不了新私信）；发出去的照常能发（对方的那份按对方的钥匙加密，自己那份按 App 的钥匙加密）
   */
  dmKeyElsewhere: boolean
  /** 这个时间及以前的记录不再显示（每天清空模式清过；服务器定时任务最多晚 5 分钟，前端先藏起来） */
  chatClearedBefore: number
  setChatMode: (mode: ChatMode) => Promise<void>
  polls: Record<string, PollInfo>
  /** 通知 */
  notifications: Notification[]
  /** 各果蝇最新一步（WebSocket 推送） */
  flyTicks: Record<string, FlyTick>
  /** 确认模式：果蝇的待确认提案 */
  flyProposals: FlyProposal[]
  dismissProposal: (id: string) => void
  /** 合约逐笔确认：收到新申请或状态变化时加一，页面据此重新拉 /api/fly/asks */
  flyAskSeq: number
  unreadNotifs: number
  pendingRequests: number
  /** 每个群的未读数与最后一条消息（消息列表用） */
  unreadGroup: Record<string, number>
  lastMsg: Record<string, ChatMessage>
  /** 当前正在看的群，用来判断消息是否算未读 */
  activeGroup: string | null
  loadNotifications: () => Promise<void>
  markNotifsRead: (id?: number) => Promise<void>
  setActiveGroup: (id: string | null) => void

  login: () => Promise<void>
  /** 网页版：这次登录是用手机 App 扫码登录的（电脑上没连钱包，2026-10-01）。能用社交、会议、直播；交易、送礼要再连钱包 */
  qrMode: boolean
  /** 扫码登录时手机上选了「信任此设备」：不做无操作退出 */
  qrTrusted: boolean
  /** 网页版扫码登录：拿扫码确认后发下来的网页版令牌登录（不传 = 用本机存的那张恢复）。成功返回 true */
  loginWithQr: (token?: string, trusted?: boolean) => Promise<boolean>
  /** forget = 连本机保存的令牌一起删（重置钱包时） */
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
  /** 多张图 / 视频合成一条消息（meta.images）；meta.url 放第一张图片，旧版 App 至少显示这一张 */
  sendAlbum: (groupId: string, items: GroupAlbumItem[]) => void
  setPoll: (p: PollInfo) => void
  sendTyping: (groupId: string) => void
  sendDm: (to: string, peerPub: string, text: string) => Promise<void>
  markDmRead: (peer: string) => void
  recordTip: (t: { groupId?: string; to: string; chainId: number; token: string; symbol: string; amount: number; tx: string; message?: string }) => Promise<void>
}

const short = (a: string) => shortId(a) // 前 5 后 3
// 没有昵称时显示地址缩写：有 EVM 地址优先用 EVM（BSC 为主，Solana 地址对多数用户是陌生的一串，2026-09-25）
export const displayName = (p?: { nickname?: string | null; address: string; evmAddress?: string | null } | null) => (p ? p.nickname || short(p.evmAddress || p.address) : '')

/** 登录失败后的自动重试。
 *
 *  以前失败一次就永久停在 status='error'，只能靠用户点「重试」或刷新页面。
 *  后端重启那几秒、地铁里断一下网、电脑睡眠醒来——任何一次抖动都会把人
 *  卡在错误页上，哪怕服务早就恢复了。WebSocket 本来就会自己重连，登录反而不会。
 *
 *  退避：2s、4s、8s、16s，之后每 30s 一次，一直到成功。
 *  ★网页版（插件钱包）不自动重试：每重试一次就要插件再弹一个登录窗口，用户点了「拒绝」两秒后又弹（2026-09-29 goat 实测）。
 *  网页版失败后停在 error（error 里写原因），等用户点「重新登录」或做需要登录的操作（desktop/walletGate.ts 的写操作闸）再来。 */
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
 * EVM 地址还没签名证明时补签一次（见 lib/evmLink.ts）。
 * 默认静默：钱包锁着就什么都不做（不为这个弹解锁），等 keysUnlocked 变 true 时下面的订阅再调。
 * interactive = true 用在付款前：锁着也要签（带闸的签名器会弹解锁，用户本来就要付款），失败抛错，不让钱先转出去。
 * 老服务器不返回 evmVerified（undefined）时不做。
 */
let evmProofInflight: Promise<boolean> | null = null
const evmProofGaveUp = new Set<string>()   // 本次运行里被服务器明确拒过的「账号|EVM 地址」，不再反复试
export async function proveEvmIfNeeded(opts: { interactive?: boolean } = {}): Promise<boolean> {
  const soc = useSocial.getState()
  const me = soc.me
  if (soc.status !== 'ready' || !me) return false
  if (me.evmVerified !== false) return true
  // 网页版的签名要插件弹窗：没人点东西时不许自己弹（登录那一个窗口里已经顺带证明了；老版本插件没证明上的，付款前 interactive 再补）
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
      // 工作人员身份可能因此变化（比如超级管理员），重新拉一次；动态导入避免和 lib/staff 互相引用
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

/** 本机保存的令牌带上地址：换了钱包就对不上，不会拿别人的令牌登录 */
const saveSession = (address: string, t: string) => secureStore.set('social-token', JSON.stringify({ address, token: t }))

// ---------- 网页版登录令牌（2026-09-29 goat：插件一直弹「登录」） ----------
// 网页版没有原生安全存储，令牌以前只在内存里：刷新页面、开新标签页，都要插件再弹一次登录窗口。
// 现在按地址存在浏览器本地：同一个地址回来先用它，服务器说过期了才重新签。令牌 7 天有效，服务器最多续到首次签名后 90 天。
// ★2026-09-29 安全审查定的是插件锁定、断开时都删掉；2026-10-06 goat「睡一觉起来要重新登录」改成：插件锁定不删（钱包也不摘，
//   只标成锁着，见 desktop/walletGate.ts），插件断开、断开 0x4 Wallet（disconnectOx4）、打开网页时插件没连着才删。
//   令牌 7 天有效，每次打开网页、开着时每 6 小时续一次，从最初签名登录起最多续 90 天（server/src/auth.ts WEB_TTL）。
//   网页版登录时告诉服务器是网页版（lib/social.ts loginWithWallet 带 surface: 'web'），令牌带网页标记，不能批准电脑 / 管理后台扫码登录（server/src/meetAuth.ts）。
//   v: 2 = 带网页标记的令牌；之前存的（没有标记、能批准扫码）读到就不用，重新签一次。
//   v: 3 = 2026-09-30 起网页版用 0x 地址登录（可能登进手机 App 的账号）；之前用插件 Solana 地址登录存的令牌不用，重新签一次。
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
  try { localStorage.setItem(WEB_SESSION_KEY, JSON.stringify({ address, token, v: WEB_SESSION_V })) } catch { /* 无痕模式存不了：只是下次要重新签 */ }
}
/** 网页版断开钱包：连本机存的登录令牌一起删 */
export function forgetWebSession() {
  try { localStorage.removeItem(WEB_SESSION_KEY) } catch { /* ignore */ }
}

// ---------- 网页版扫码登录的令牌（2026-10-01 goat：meet.420.meme 下线，没装插件的电脑用手机 App 扫码登录网页版） ----------
// 和插件登录的令牌权限一样，但带服务器会话（手机上让它下线立刻失效，server/src/auth.ts WEB_QR_*）。手机确认时二选一（2026-10-01 goat）：
//   · 信任此设备：登录保留 30 天，不因没操作退出 → 存 localStorage（关掉浏览器也还在）；
//   · 仅本次登录（公共电脑）：存 sessionStorage，关掉浏览器或这个标签页就退出、长时间没有活动自动退出、最长 12 小时（见 qrIdle.ts）。
// 连上钱包时换成钱包登录（App.tsx），「退出登录」时删掉。
const QR_SESSION_KEY = '0x4.webQrSession'
type QrSaved = { account: string; token: string; trusted: boolean }
// 以前（v1）存在 localStorage 里的不分信任不信任：读到就删
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
  } catch { /* 存不了：只是刷新后要重新扫 */ }
}
export function forgetQrSession() {
  try { sessionStorage.removeItem(QR_SESSION_KEY) } catch { /* ignore */ }
  try { localStorage.removeItem(QR_SESSION_KEY) } catch { /* ignore */ }
}

/**
 * 当前钱包的登录标识（没连钱包返回 null）：有 Solana 签名器用 Solana 地址（手机 App、0x4 插件、Phantom）；
 * 网页版外部钱包只有 EVM（MetaMask 等，2026-09-30）用 0x 地址
 */
export function walletKey(): string | null {
  const w = useWallet.getState()
  if (!isWalletConnected(w)) return null
  return w.wallet ? w.address : w.evmAddress
}

/**
 * 同一个地址同时只登录一趟（2026-09-29）。网页版连插件时会先后两次挂上签名器（连接返回、插件推「账户变了」），
 * 中间还夹着一次 logout，以前第二次 login() 看到状态是 idle 就又发一次 nonce + 签名：两个登录窗口，前一次的 nonce 被作废回 401。
 * 现在第二次直接接上正在进行的那一趟。
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
    } catch { /* 坏数据当作没有 */ }
    set({ sessionLoaded: true })
  },

  sessionExpired() {
    if (WEB_SURFACE) {
      // 网页版：重新登录要插件弹窗，不在后台自己弹。清掉令牌，停在 error 写明原因，等用户点「重新登录」或下一次需要登录的操作
      forgetWebSession()
      // 扫码登录的过期了：回到没登录，下次再扫
      if (get().qrMode) { forgetQrSession(); get().logout(); set({ status: 'error', error: t('登录已过期，请重新扫码登录') }); return }
      if (get().status === 'logging') { setToken(null); return }   // 正在登录的那一趟会自己接着走签名登录
      if (get().status !== 'ready') return
      get().logout()
      set({ status: 'error', error: t('登录已过期，请重新登录') })
      return
    }
    if (!get().hasSession && get().status !== 'ready') return
    void secureStore.remove('social-token')
    setToken(null)
    set({ hasSession: false })
    // 正在登录的那一趟自己会接着走签名登录，这里不再插一脚，免得并发登两次
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
    // 连着钱包时走钱包登录，不用扫码的令牌
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
    // 这期间连上了钱包：交给钱包登录
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
    // 私信钥匙在手机 / 插件里，扫码登录的电脑上没有：私信提示去手机上看（dmKeyElsewhere）
    set({ status: 'ready', me: user, socket, qrMode: true, qrTrusted: trusted, dmKeyElsewhere: !!user.encPub })
    void useBlocks.getState().load()
    startWebRefresh()
    get().loadGroups()
    get().loadNotifications()
    reportLang()
    return true
  },

  async login() {
    // 这次登录的标识：钱包的 Solana 地址；外部钱包（网页版 MetaMask 等，2026-09-30）没有 Solana 地址，用它的 0x 地址
    const address = walletKey()
    if (!address) return
    // 创建 / 登录账号之前要先同意条款（2026-10-02，上架要求；lib/safety.ts）。没同意：不登录，弹出条款；钱包功能照常用。
    // 注销账号后同意记录会清掉，所以注销完不会马上又自动建一个新账号
    if (!termsAccepted(address)) {
      if (get().status !== 'idle' || !get().needTerms) set({ status: 'idle', error: null, needTerms: true })
      useTermsGate.getState().show()
      return
    }
    if (get().needTerms) set({ needTerms: false })
    // 扫码登录着、又连上了钱包：换成钱包登录（钱包对应的账号可能不是扫码的那个）
    if (get().qrMode) get().logout()
    if (get().status === 'ready') return
    // 同一个地址正在登录：接上那一趟，不再发第二次签名（见 loginFlight）。中间被 logout 置成 idle 的，状态改回「正在登录」
    if (loginFlight?.address === address) { if (get().status !== 'logging') set({ status: 'logging', error: null }); return loginFlight.promise }
    if (get().status === 'logging') return
    const flight = { address, promise: Promise.resolve() }
    flight.promise = runLogin(address).finally(() => { if (loginFlight === flight) loginFlight = null })
    loginFlight = flight
    return flight.promise
  },

  logout(forget) {
    // 手机扫码登录的电脑：退出（点「退出登录」、长时间没操作自动退出、「停止并退出」）时先让服务器作废这次会话，
    // 不只是清掉浏览器里的令牌（2026-10-01 上线前安全审查 #3）。请求失败也照样清本地；带上当前令牌显式传，下面马上就清了
    const tok = getToken()
    if (get().qrMode && tok) void api('/api/meet/logout', { method: 'POST', keepalive: true }, { token: tok }).catch(() => { /* 已经失效 / 断网：本地照清 */ })
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

  async refreshMe() { try { const me = await api<Profile>('/api/me'); set({ me }) } catch { /* 忽略 */ } },
  async updateProfile(p) {
    const me = await api<Profile>('/api/me', { method: 'PUT', body: JSON.stringify({ ...get().me, ...p }) })
    set({ me })
  },

  async loadGroups(search = '') {
    const [mine, discover] = await Promise.all([api<Group[]>('/api/groups/mine'), api<Group[]>(`/api/groups?q=${encodeURIComponent(search)}`)])
    set({ myGroups: mine, discover })
    // 订阅我加入的所有群，这样不在群页面也能收到消息、统计未读
    const socket = get().socket
    if (socket) for (const g of mine) socket.join(g.id)
    // 会话列表预览：各群最后一条（服务器上的记录）；已经有更新的实时消息就不覆盖
    api<Record<string, ChatMessage>>('/api/groups/mine/last').then((last) => {
      const cur = { ...get().lastMsg }
      // 每天清空模式清过的（服务器定时任务还没跑到时）不显示
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
    // 同一条加密两份：给对方的、给自己的（服务器存着，换手机后自己也能看到发过什么）
    const myPub = me.encPub || await dmCrypto.publicKey()
    const [payload, self] = await Promise.all([dmCrypto.encrypt(text, peerPub), dmCrypto.encrypt(text, myPub)])
    const cid = `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    // 本地先显示明文，服务器回执（带 cid）到了再换成正式 id。先放进列表再发，回执再快也能对上
    const msg: DmMessage = { id: cid, from: me.address, to, text, ts: Date.now() }
    set({ dms: { ...get().dms, [to]: [...(get().dms[to] || []), msg] } })
    get().socket?.send({ type: 'dm', to, ...payload, self, cid })
  },

  markDmRead(peer) {
    // 服务器记已读位置（别的设备、下次打开 App 的未读数才对）；本地已经是 0 就不重复请求
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
      // 往上翻时 hasMore 以这一页为准；拉最近一页时只在还没翻过的情况下设置
      const hasMore = older || get().groupHasMore[groupId] === undefined ? r.hasMore : get().groupHasMore[groupId]
      set({ messages: { ...get().messages, [groupId]: list }, groupHasMore: { ...get().groupHasMore, [groupId]: hasMore } })
      const last = list[list.length - 1]
      if (last && (!get().lastMsg[groupId] || get().lastMsg[groupId].ts < last.ts)) set({ lastMsg: { ...get().lastMsg, [groupId]: last } })
      // 投票：先用消息里的快照，再去拉一次最新票数和我投的哪项
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
      // 本机存着的会话（只存在手机模式下服务器上已经没有了）：记录、对方资料、未读数
      const o = get().me?.address
      if (localChat && o) {
        try {
          const meta = await localChat.getMeta<DmMeta>(o, 'dm')
          if (meta) { Object.assign(dmPeers, meta.peers); Object.assign(unreadDm, meta.unread) }
          for (const peer of await localChat.list(o, 'd')) dms[peer] = mergeMessages(dms[peer] || [], await loadLocal<DmMessage>('d', peer))
        } catch { /* 本机记录读不出来当作没有 */ }
      }
      await Promise.all(list.map(async (c) => {
        dmPeers[c.peer] = c.profile
        unreadDm[c.peer] = Math.max(c.unread, get().chatMode === 'device' ? unreadDm[c.peer] || 0 : 0)
        if (c.last) dms[c.peer] = mergeMessages(dms[c.peer] || [], [await decodeDm(c.last, dmCrypto ? (p) => dmCrypto.decrypt(p) : null)])
      }))
      for (const k of Object.keys(dms)) dms[k] = fresh(dms[k])
      set({ dms, unreadDm, dmPeers })
      saveDmMetaSoon()
    } catch { /* 会话列表拉不到不影响实时私信 */ }
  },

  async deleteGroupMessage(groupId, id, scope) {
    await api(`/api/groups/${groupId}/messages/${encodeURIComponent(id)}?scope=${scope}`, { method: 'DELETE' })
    removeGroupMessages(groupId, [id], set, get)
    localDo((o, lc) => lc.remove(LocalChat.conv(o, 'g', groupId), [id]))
  },

  async deleteDm(peer, id, scope) {
    // 还没收到服务器回执的本地消息，服务器上没有对应的一条，只从本机去掉
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
    // 刚切到每天清空：从现在算，今天零点以前的等今晚一起清
    saveLocalPrefs(o, { mode: r.mode, ...(r.mode === 'daily' && prev !== 'daily' ? { lastClear: Date.now() } : {}) })
    set({ chatMode: r.mode })
    armMidnight()
    if (r.mode === 'device' && prev !== 'device') {
      // 已经加载的记录先存进本机，再把服务器上我那份全部拉下来存好、逐批 ack（服务器随之删掉）
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

/** 登录这件事本身（login() 负责同一地址只跑一趟）。address = 发起时钱包的地址；中途钱包换了 / 断开了，这一趟作废 */
async function runLogin(address: string): Promise<void> {
  const set = useSocial.setState, get = useSocial.getState
  const { wallet, dm: dmCrypto, evmAddress, evmAccount, keysUnlocked, kind } = useWallet.getState()
  if (!walletKey()) return
  /** 网页版连的 0x4 插件现在锁着（2026-10-06 起插件锁了网页不登出，打开网页时插件可能锁着） */
  const extLocked = WEB_SURFACE && kind === 'ox4' && !keysUnlocked
  /** 钱包还是发起时那个地址吗（网页版插件锁定 / 断开 / 换号会把钱包摘掉） */
  const still = () => walletKey() === address
  set({ status: 'logging', error: null })
  try {
    let user: Profile | null = null
    // ★这一趟用的令牌先放在局部变量里，确认钱包还是发起时那个地址（still）之后才设成全局令牌（2026-09-29 审查：
    // 以前签名登录一拿到令牌就设成全局的、网页版本机存的令牌也是先设再验，这期间换了号，新地址的登录就接着用上旧地址的令牌）
    let token: string | null = getToken()
    // 网页版：这个地址上次登录存下的令牌先拿出来用（刷新页面不用再签）
    if (WEB_SURFACE && !token) token = readWebSession(address)
    let fromSaved = false
    // 原生 App / 网页版：先试本机保存的令牌，能用就不用签名
    if ((persistentSession || WEB_SURFACE) && token) {
      try {
        user = await api<Profile>('/api/me', {}, { token })
        fromSaved = true
      } catch (e) {
        if ((e as { status?: number }).status !== 401) throw e   // 断网等：原生走重试，令牌留着
        user = null   // 401：原生由 api() 触发 sessionExpired 清掉；网页版这里自己清
        token = null
        if (WEB_SURFACE) { forgetWebSession(); setToken(null) }
      }
    }
    if (!user) {
      // 没有可用令牌，要钱包签名登录。钱包锁着就不在这里弹验证：交给路由守卫送去解锁页
      if (persistentSession && !keysUnlocked) {
        set({ status: 'idle', hasSession: false })
        return
      }
      // 网页版插件锁着、存的令牌也过期了：不是用户点出来的就不签（签名要插件先弹解锁窗口，打开网页就弹一个不行）。
      // 停在「登录已过期」，用户点「重新登录」或做了要登录的事（walletGate needSocialLogin）时再来，那时插件弹解锁 + 登录
      if (extLocked && !userActing()) {
        set({ status: 'error', error: t('登录已过期，请重新登录') })
        return
      }
      // 钱包已解锁：顺带用 EVM 私钥签一次，证明 EVM 地址归这个账号（管理员标识等只认证明过的）。网页版插件里两件事是同一个窗口
      const r = await loginWithWallet(wallet, evmAddress, keysUnlocked ? evmAccount : null)
      user = r.user
      token = r.token
      // 原生：令牌按地址存进钥匙串（换了号对不上地址不会被拿来用）
      if (persistentSession) { void saveSession(address, r.token); set({ hasSession: true }) }
    }
    if (!still()) { abandon(address); return }
    setToken(token)
    // 网页版：确认还是这个钱包之后才按地址存（插件锁定 / 断开时会删掉，见 desktop/walletGate.ts）
    saveWebSession(address, token!)
    // 用的是本机存的令牌：顺手续期（App 和网页版都重新计 7 天，从签名登录起最多续 90 天）；服务端拒绝续期时不影响这次登录
    if (fromSaved && user) void refreshToken(address, token!)
    else lastRefreshAt = Date.now()   // 刚签名登录拿到的新令牌，不用马上续
    // 把本设备的加密公钥登记到资料里，别人才能给我发密文。私信密钥不可用时跳过，不挡登录。
    // 网页版插件锁着：不问插件要公钥（锁着会弹解锁窗口），解锁后补（syncExtensionDmKey）
    const encPub = dmCrypto && !extLocked ? await dmCrypto.publicKey().catch(() => null) : null
    const { me, keyElsewhere } = await registerDmKey(user, encPub)
    if (!still()) { abandon(address); return }
    const socket = new SocialSocket()
    socket.onStatus = (s) => set({ wsStatus: s })
    socket.on((d) => { if (get().status === 'ready') handleEvent(d as SocketEvent, set, get) })
    socket.connect()
    clearRetry()
    set({ status: 'ready', me, socket, dmKeyElsewhere: keyElsewhere })
    // 黑名单：群聊、直播弹幕里要把拉黑的人的话折叠起来
    void useBlocks.getState().load()
    startWebRefresh()
    get().loadGroups()
    // 先定下消息记录模式，再拉私信列表：只存在手机模式要先把本机记录读出来
    void initChatPrefs().finally(() => { void get().loadDmList() })
    get().loadNotifications()
    // 刷新我的持仓快照（币详情页「持币最多的社区」排名用），服务端 10 分钟节流，失败不管
    api('/api/me/holdings/refresh', { method: 'POST' }).catch(() => {})
    void registerPush()
    reportLang()
    // 用令牌登录的、或登录时 EVM 签名没成功的：钱包此刻已解锁就顺手补签（锁着就等下次解锁，不弹；网页版不自己弹）
    void proveEvmIfNeeded()
  } catch (e) {
    if (!still()) { abandon(address); return }
    // 用户在插件里点了拒绝 / 关掉窗口：说清楚，不当成红色报错
    set({ status: 'error', error: isUserCancel(e) ? t('你取消了登录签名。需要时点「重新登录」') : errorText(e, t('登录失败')) || t('登录失败') })
    // 网页版不自动重试（每次重试都要插件再弹一个窗口），见 scheduleRetry 上面的说明
    if (!WEB_SURFACE) scheduleRetry()
  }
}

/**
 * 登记私信公钥（登录时、网页版插件解锁后补）。返回登记后的资料和 keyElsewhere：
 * 网页版 0x 登录登进了手机 App 的账号、而那边登记的是另一把私信钥匙：不覆盖（覆盖了 App 就读不了新私信），网页版提示去手机上看私信（dmKeyElsewhere）
 */
async function registerDmKey(user: Profile, encPub: string | null): Promise<{ me: Profile; keyElsewhere: boolean }> {
  const keyElsewhere = WEB_SURFACE && !!encPub && !!user.encPub && user.encPub !== encPub
  const me = !encPub || user.encPub === encPub || keyElsewhere ? user : await api<Profile>('/api/me', { method: 'PUT', body: JSON.stringify({ nickname: user.nickname, avatar: user.avatar, bio: user.bio, encPub }) })
  return { me, keyElsewhere }
}

/**
 * 网页版 0x4 插件从锁着变成解锁（2026-10-06 起插件锁了网页不登出）：
 * 登录时插件锁着没问公钥的，现在补登记；锁着时没解开的私信（locked）重新拉一遍解密
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
  } catch { /* 登记失败不影响看私信，下次登录再登记 */ }
  const peers = Object.entries(useSocial.getState().dms).filter(([, list]) => list.some((m) => m.locked)).map(([peer]) => peer)
  await useSocial.getState().loadDmList()
  for (const peer of peers) void useSocial.getState().loadDmHistory(peer).catch(() => {})
  if (deviceMode()) void syncPendingDms().catch(() => {})
}

/** 拿还有效的令牌换一张新的（/api/auth/refresh）。这期间登出 / 换了令牌就不用它；失败不管（令牌本身还有效，下次再续） */
function refreshToken(address: string, used: string): Promise<void> {
  lastRefreshAt = Date.now()
  return api<{ token: string }>('/api/auth/refresh', { method: 'POST' }, { token: used })
    .then((r) => {
      if (getToken() !== used) return   // 这期间已经登出 / 换了令牌
      setToken(r.token)
      if (persistentSession) void saveSession(address, r.token)
      if (useSocial.getState().qrMode) saveQrSession(address, r.token, useSocial.getState().qrTrusted)
      else saveWebSession(address, r.token)
    })
    .catch(() => {})
}

/**
 * 网页版标签页一直开着时的续期（2026-09-29 复审建议 8）。当时网页版令牌只有 24 小时（2026-10-06 起 7 天，服务器 WEB_TTL），
 * 以前只在打开页面时续一次，标签页开着超过 24 小时就被登出。现在开着时每 6 小时续一次（每 15 分钟看一眼，
 * 电脑睡醒后的第一眼就补上），切回这个标签页时距上次续期超过 10 分钟也续一次。
 * 续期上限从签名登录起 90 天（2026-10-06 前是 7 天，服务器 WEB_AUTH_MAX_AGE_MS 管），到了续期回 401，照常走「登录已过期，请重新登录」。
 * 手机 App 令牌 7 天、每次打开都续，不需要这个。
 */
export const WEB_REFRESH_EVERY_MS = 6 * 3600_000
const WEB_REFRESH_ON_SHOW_MS = 10 * 60_000
const WEB_REFRESH_CHECK_MS = 15 * 60_000
let lastRefreshAt = 0
let webRefreshTimer: ReturnType<typeof setInterval> | null = null
function webRefreshIfDue(minGap: number) {
  const st = useSocial.getState(), used = getToken(), address = st.me?.address
  // 扫码登录（没有钱包）：按账号续；钱包登录：钱包还是这个地址才续
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

/** 登录进行中钱包换了 / 断开了：这一趟的结果不用（令牌已按地址存下）。钱包换成了另一个地址就给新地址登录 */
function abandon(address: string) {
  // 新地址已经在登录了（换号时 App 已经给新地址发起）：状态和令牌都是它的，别动
  if (loginFlight && loginFlight.address !== address) return
  if (useSocial.getState().status === 'logging') { setToken(null); useSocial.setState({ status: 'idle', me: null }) }
  const key = walletKey()
  if (key && key !== address) setTimeout(() => { void useSocial.getState().login() }, 0)
}

// ---------- 消息记录模式 ----------

interface ServerChatPrefs { mode: ChatMode; tz: string | null; tzOffset: number | null; groupClearedBefore: number; nextClearAt: number | null }
/** 本机存的私信会话附加信息：对方资料（服务器上的记录删了之后会话列表还认得人）、未读数 */
interface DmMeta { peers: Record<string, DmPeer>; unread: Record<string, number> }

const S = () => useSocial.getState()
const ownerAddr = () => S().me?.address || null
const deviceMode = () => S().chatMode === 'device' && !!localChat && !!ownerAddr()

/** 本机记录的读写出错不影响界面，吞掉 */
function localDo(fn: (owner: string, lc: LocalChat) => Promise<unknown>) {
  const o = ownerAddr()
  if (localChat && o) fn(o, localChat).catch(() => {})
}

/** 每个会话的本机记录只在第一次打开时读一遍 */
const localLoaded = new Set<string>()
async function loadLocal<T extends { id: string; ts: number }>(kind: 'g' | 'd', id: string): Promise<T[]> {
  const o = ownerAddr()
  if (!localChat || !o) return []
  const conv = LocalChat.conv(o, kind, id)
  if (localLoaded.has(conv)) return []
  localLoaded.add(conv)
  try { return await localChat.load<T>(conv) } catch { return [] }
}

/** 每天清空模式清过之后，比清理点早的不再显示 */
function fresh<T extends { ts: number }>(list: T[]): T[] {
  const cb = S().chatClearedBefore
  return cb ? list.filter((m) => m.ts > cb) : list
}

function keepGroupLocally(groupId: string, msgs: ChatMessage[]) {
  if (!deviceMode() || !msgs.length) return
  localDo((o, lc) => lc.save(LocalChat.conv(o, 'g', groupId), msgs))
}

/**
 * 只存在手机模式：私信在本机加密存好后才 ack，服务器收到 ack 删掉我那份。
 * 解不开的不存也不 ack（下次解锁后还能从服务器拉）；本机还没回执的临时消息不存。
 */
async function keepDmsLocally(msgs: DmMessage[]): Promise<void> {
  const o = ownerAddr()
  if (!deviceMode() || !localChat || !o) return
  const ok = msgs.filter((m) => !m.undecryptable && !isLocalId(m.id))
  if (!ok.length) return
  const byPeer = new Map<string, DmMessage[]>()
  for (const m of ok) { const p = m.from === o ? m.to : m.from; byPeer.set(p, [...(byPeer.get(p) || []), m]) }
  try { for (const [peer, list] of byPeer) await localChat.save(LocalChat.conv(o, 'd', peer), list) }
  catch { return }   // 没存进去就不 ack，服务器那份留着
  queueAck(ok.map((m) => m.id))
  saveDmMetaSoon()
}

/** ack 攒 300 毫秒一起发 */
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
    // 失败的（断网）不重试：服务器那份还在，下次上线 syncPendingDms 会再拉、再 ack
    await api('/api/dms/ack', { method: 'POST', body: JSON.stringify({ ids }) }).catch(() => {})
  }
}
/** 测试用：马上把攒着的 ack 发出去 */
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

/** 只存在手机模式：把服务器上还留着我那份的私信全部拉下来，本机存好后 ack */
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

/** 登录后：以服务器上的模式为准，同步时区，到点清理，只存在手机模式拉离线期间的私信 */
export async function initChatPrefs(): Promise<void> {
  const o = ownerAddr()
  if (!o) return
  const local = loadLocalPrefs(o)
  useSocial.setState({ chatMode: local.mode, chatClearedBefore: local.clearedBefore })
  try {
    const r = await api<ServerChatPrefs>('/api/me/chat-prefs')
    if (r.mode !== local.mode) saveLocalPrefs(o, { mode: r.mode, ...(r.mode === 'daily' ? { lastClear: Date.now() } : {}) })
    useSocial.setState({ chatMode: r.mode, chatClearedBefore: Math.max(local.clearedBefore, r.groupClearedBefore || 0) })
    // 换了时区（出差）：按新时区算零点
    const tz = deviceTz()
    if (r.mode === 'daily' && (r.tz !== tz.tz || r.tzOffset !== tz.tzOffset)) api('/api/me/chat-prefs', { method: 'PUT', body: JSON.stringify(tz) }).catch(() => {})
  } catch { /* 拉不到按本机记的 */ }
  checkDailyClear()
  armMidnight()
  if (S().chatMode === 'device') await syncPendingDms()
}

/** 每天清空模式：过了本地零点就清本机记录、媒体缓存，界面上零点以前的也藏掉 */
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

/** 同一个会话同时只拉一页 */
const inflight = new Set<string>()

/** 从群消息里去掉几条；如果删的是会话列表里那条预览，换成剩下的最后一条 */
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
      // 最近 60 秒的缓存和已经拉到的历史合并，不再整个覆盖
      keepGroupLocally(groupId, recent)
      set({ messages: { ...get().messages, [groupId]: fresh(mergeMessages(get().messages[groupId] || [], recent)) }, roomOnline: { ...get().roomOnline, [groupId]: (d.online as string[]) || [] } })
      recent.forEach((m) => { if (m.meta?.event === 'poll' && m.meta.poll) get().setPoll(m.meta.poll as PollInfo) })
      if (recent.length && !get().lastMsg[groupId]) set({ lastMsg: { ...get().lastMsg, [groupId]: recent[recent.length - 1] } })
      break
    }
    case 'msg': {
      const msg = d.msg as ChatMessage
      const list = get().messages[msg.groupId] || []
      if (list.some((m) => m.id === msg.id)) break   // 历史里已经有了
      keepGroupLocally(msg.groupId, [msg])
      const mine = msg.from === get().me?.address
      const viewing = get().activeGroup === msg.groupId
      set({
        messages: { ...get().messages, [msg.groupId]: mergeMessages(list, [msg]) },
        lastMsg: { ...get().lastMsg, [msg.groupId]: msg },
        unreadGroup: viewing || mine || msg.kind === 'system' ? get().unreadGroup : { ...get().unreadGroup, [msg.groupId]: (get().unreadGroup[msg.groupId] || 0) + 1 },
      })
      if (msg.meta?.event === 'poll' && msg.meta.poll) get().setPoll(msg.meta.poll as PollInfo)
      // 群里有人发起了群会议（2026-10-07）：消息列表里这个群马上标「会议中」（开完由群聊页 / 下次拉群列表更新）
      if (msg.kind === 'system' && msg.meta?.event === 'meeting' && msg.meta.meeting) {
        const mt = msg.meta.meeting as { id: string; title: string; hasPassword?: boolean }
        set({ myGroups: get().myGroups.map((g) => (g.id === msg.groupId ? { ...g, meeting: { id: mt.id, title: mt.title, host: msg.from, hostNickname: null, hasPassword: !!mt.hasPassword, participants: 0, since: null } } : g)) })
      }
      if (msg.kind === 'system' && (msg.meta?.event === 'join' || msg.meta?.event === 'kick' || msg.meta?.event === 'group_update')) get().loadGroup(msg.groupId).catch(() => {})
      // 群聊新消息震动（默认关）：别人发的、不是系统消息、不在这个群里看着；@ 到我的由随后的 mention 通知震，这里不重复
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
      // 服务器把合并的通知（小精灵在你离开时的交易申请，2026-10-04）原地更新：同一个 id 换掉旧的挪到最上面，原来就没读的不重复加未读数
      const old = get().notifications.find((x) => x.id === n.id)
      if (old) {
        set({ notifications: [n, ...get().notifications.filter((x) => x.id !== n.id)], unreadNotifs: get().unreadNotifs + (old.read ? 1 : 0) })
        break
      }
      set({ notifications: [n, ...get().notifications].slice(0, 100), unreadNotifs: get().unreadNotifs + 1 })
      if (n.type === 'join_request') set({ pendingRequests: get().pendingRequests + 1 })
      // 关注的人开播了：顶部弹横幅（2026-09-30）
      if ((n.type as string) === 'live') pushLiveBanner(n as unknown as Parameters<typeof pushLiveBanner>[0])
      // 私信的通知：正在和这个人聊天就不震（消息本身已经看到了）
      if (!(n.type === 'dm' && n.actor && viewingDm(n.actor))) notifyHaptic(vibeKindOfNotif(n.type, n.ref))
      break
    }
    case 'poll': {
      const p = d.poll as PollInfo
      // 保留自己的选择，只更新票数
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
        // 自己发的回执：本机那条换成正式 id；别的设备发的，用「给自己的那份」解密补进来
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
      // 群里发消息被拒（被禁言、全体禁言、@所有人太频繁）要让发的人看到
      if (d.groupId) import('@/components/Toast').then(({ toast }) => toast.error(t(String(d.error)))).catch(() => {})
      break
    }
  }
}


/** 正在和这个人私聊（私信页的地址是 #/dm/<地址>）：来了新消息不用再震 */
function viewingDm(peer: string): boolean {
  if (typeof location === 'undefined') return false
  try { return decodeURIComponent(currentRoute()).toLowerCase().startsWith(`/dm/${peer.toLowerCase()}`) } catch { return false }
}

/** 测试用：把一条 WebSocket 事件交给 store 处理（正常运行时由 SocialSocket 的监听器调用） */
export const handleSocketEvent = (d: SocketEvent) => handleEvent(d, useSocial.setState, useSocial.getState)

setOnUnauthorized(() => useSocial.getState().sessionExpired())

// 网络回来了、或者页面重新可见（手机切回来、电脑睡醒），立刻补一次登录，
// 不用干等退避计时器。已经是 ready 的话 login() 内部会自己 return。
if (typeof window !== 'undefined') {
  const retryNow = () => {
    const st = useSocial.getState()
    // 网页版：重试要插件弹登录窗口，切回标签页就弹一个是 goat 9/29 遇到的「点了确认又弹」之一，不做
    if (st.status !== 'error' || WEB_SURFACE) return
    clearRetry()
    void st.login()
  }
  window.addEventListener('online', retryNow)
  // 手机睡眠时计时器会停：切回前台补一次零点检查
  // 网页版切回标签页：距上次续期超过 10 分钟就续一次令牌（webRefreshIfDue，不弹任何窗口）
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { retryNow(); webRefreshIfDue(WEB_REFRESH_ON_SHOW_MS); if (checkDailyClear()) armMidnight() } })
}

// 钱包从锁定变成解锁（解锁页 / UnlockSheet / 面容 ID 成功）：社交已登录且 EVM 地址还没证明就静默补签一次
useWallet.subscribe((cur, prev) => {
  if (cur.keysUnlocked && !prev.keysUnlocked) {
    void proveEvmIfNeeded()
    // 网页版插件解锁（同一个钱包，不是新挂上的）：补登记私信公钥、解开锁着时没解的私信
    if (WEB_SURFACE && cur.kind === 'ox4' && prev.kind === 'ox4' && cur.address === prev.address) void syncAfterExtensionUnlock()
  }
})
