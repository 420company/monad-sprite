// 社交层客户端：签名登录、REST 调用、WebSocket、端到端加密私信
import type { SolanaWallet } from '@/lib/vault/signers'
import { translateServerError } from '@/lib/sysText'
import { t } from '@/lib/i18n'
import bs58 from 'bs58'
import type { Account } from 'viem'
import { signEvmLink } from './evmLink'

import { API_BASE } from './env'
import { WEB_SURFACE } from './surface'
import { currentWebDomain } from './siwx'
import { externalOf } from '@/lib/vault/external'

export const SOCIAL_API = API_BASE
const WS_URL = SOCIAL_API ? SOCIAL_API.replace(/^http/, 'ws') + '/ws' : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

/** thumb = 索引服务给的缩略图（头像展示用它）；image = 链上 metadata 里那张原图 */
export interface AvatarNft { chainId: number; contract: string; tokenId: string | null; image: string; name?: string | null; thumb?: string | null }
export interface Profile { /** 这个地址是小精灵（动态里点小精灵进来）：页面跳去小精灵页（2026-10-05） */ sprite?: { id: string; name: string; owner: string; ownerNickname: string | null } | null; address: string; nickname: string | null
  /** 这个账号的默认昵称（User + 编号，2026-09-29）；昵称和它一样说明用户还没自己起名。老服务器没有这个字段 */
  defaultNickname?: string | null
  avatar: string | null; bio: string | null; encPub: string | null; evmAddress?: string | null; handle?: string | null; lastSeen: number | null; avatarNft?: AvatarNft | null; xHandle?: string | null
  /** 只有自己的资料（/api/me、登录返回）带：EVM 地址是否已签名证明。老服务器没有这个字段 = undefined */
  evmVerified?: boolean }
export interface GroupGate { kind: 'token' | 'nft'; chainId: number; token: string; symbol: string | null; min: number }
/** 群会议（服务器 meetAuth.ts activeGroupMeeting）：participants = 此刻在会议里的人数，刚发起还没人进时是 0 */
export interface GroupMeeting { id: string; title: string; host: string; hostNickname: string | null; hasPassword: boolean; participants: number; since: number | null }
export interface Group {
  id: string; name: string; description: string | null; avatar: string | null; owner: string; isPublic: boolean
  /** 群号（6 位起的数字，可在「找群」里直接搜） */
  num?: number | null
  gate: GroupGate | null; token: { chain: string; address: string } | null; memberCount: number; role: 'owner' | 'admin' | 'member' | null; createdAt: number; joinMode?: 'open' | 'approval'
  /** 官方社区（平台管理员在后台建的）：true 时群名旁显示金色认证标，普通群永远 false */
  official?: boolean
  /** 群里正在开的会议（2026-10-07 群会议；只有群成员拿得到：我的群、群详情） */
  meeting?: GroupMeeting | null
  /** 官方社区关联的币种（可选） */
  officialToken?: { chain: string; address: string } | null
  /** 全体禁言中：只有群主和管理员能发言 */
  mutedAll?: boolean
  /** 禁止群成员私信（2026-09-29）：普通成员不能私信群里的其他普通成员，群主 / 管理员 / 平台工作人员照常 */
  dmLocked?: boolean
  /** 群公告：只有群成员拿得到 */
  announcement?: string | null
  announcementAt?: number | null
}
/** 币详情页的社区卡片：只有汇总数字，不含谁持有多少 */
export interface CommunityCard { id: string; name: string; avatar: string | null; memberCount: number; holders: number; totalUsd: number; joinMode: 'open' | 'approval'; gated: boolean; official?: boolean }
/** 币详情页「持币最多的社区」前 3 名（官方社区不单独成块，上榜时 official = true） */
export interface TokenCommunities { top: CommunityCard[] }
// perp 的账户权益来自 Hyperliquid；来源不可用时保持 null。
export interface FlyTick { ts: number; tick: number; equity: number; accountEquity?: number | null; equitySource?: string; pnlDelta: number | null; product?: string; symbol?: string; chain?: string; token?: string; price?: number; execution: string; /** 交易进程写的原因（暂停时说明为什么暂停） */ executionReason?: string | null; changedEdges: number; neural: { side?: string; left_hz?: number; right_hz?: number; difference_hz?: number; gate_spikes?: number; total_spikes?: number; KC_spikes?: number; reward_spikes?: number; aversive_spikes?: number; stimulus?: string } }
/** 自动找币（2026-09-27）：小精灵自己从热门 / 最新里挑币，最多 5 条链 */
export interface FlyAutoPick { source: 'hot' | 'new' | 'both'; chains: string[] }
export interface FlyParams { autoPick?: FlyAutoPick | null; tokens: { chain: string; address: string; symbol: string }[]; thresholdHz: number; learning: boolean; neuralMs: number; cadenceMin: number; budget: number; orderLimit: number; lossStop: number; leverage: number; market: 'spot' | 'perp'; senses?: ('funding' | 'oi')[]; decoderBaseline?: number }
export type FlyPlan = 'basic' | 'pro'
export type FlyMode = 'pending' | 'confirm' | 'perp'  // 没有纸面：pending = 领养了但还没选交易方式，worker 不派单
/** 合约逐笔确认（2026-09-28）：主人电脑端在线、开了「每笔交易先经我确认」时，小精灵的合约单先等主人批准（服务器 fly_perp_asks，10 分钟有效） */
export interface FlyAsk { id: string; flyId: string; flyName: string; side: 'BUY' | 'SELL'; coin: string; action: 'open' | 'close'; price: number; marginUsd: number; leverage: number; notional: number; status: string; createdAt: number; expiresAt: number }
export interface FlyProposal { id: string; flyId: string; flyName: string; side: 'buy' | 'sell'; symbol: string; chain: string; token: string; usd: number; price: number | null; expiresAt: number; /** 小精灵自己说的话（大模型生成，可能没有） */ say?: string | null; sayEn?: string | null; /** half = 翻倍出本（卖一半拿回本金） */ kind?: string | null }
export interface FlyPlanDef { price: number; slots: number; minCadence: number; label: string }
export type HoldStyle = 'quick' | 'double' | 'diamond'
export interface FlyPrefs { askWhenOnline: boolean; autoApproveUsd: number; dailyStopUsd: number; publicPnl: boolean; publicPositions: boolean; /** 现货持有方式（钻石手三档）：快进快出 / 翻倍出本 / 钻石手 */ holdStyle?: HoldStyle }
/** Zalien 卡（2026-09-27）：free = 从没领过、领的时候送 1 个月；idle = 免费月已用、现在空闲；busy = 上面挂着果蝇 */
export interface ZalienCard { tokenId: number; name: string; image: string; status: 'free' | 'idle' | 'busy'; fly: { id: string; name: string; mine: boolean; paidUntil: number | null; releaseAt: number | null } | null }
export interface ZalienCards { cards: ZalienCard[]; evmAddresses: number; liveFlies: number; maxFlies: number; contract: string }
export interface Fly { /** 只给主人：现货确认模式下没批、过期作废的交易申请次数（上次看过之后，2026-10-04） */ missedAsks?: number; autoTokens?: { chain: string; address: string; symbol: string }[]; nftToken?: number | null; /** 主人现在还持有这张 Zalien（服务器 60 秒持有快照；null = 没绑卡或暂时不知道） */ nftHolder?: boolean | null; releaseAt?: number | null; prefs?: Partial<FlyPrefs>; pnlHidden?: boolean; activated: boolean; realEquity: number | null; realAnchor: number | null; realizedTrades: number | null; turnover: number | null; plan: FlyPlan; paidUntil: number | null; expired: boolean; mode: FlyMode; leverage: number; marginUsd: number; agreementAt: number | null; /** 同意的是不是当前版本的真金协议 */ agreementCurrent?: boolean; perp: { mainAddress: string } | null; id: string; owner: string; ownerNickname: string | null; ownerAvatar: string | null; address: string; name: string; params: FlyParams; paused: boolean; tick: number; equity: number | null; cash: number | null; positions: Record<string, number>; halted: string | null; lastTickAt: number | null; createdAt: number; followers: number; online: boolean; pnl: number | null; frameUrl: string | null; ticks?: FlyTick[] }
/** key / params：2026-09-26 起服务端带模板（简体原文）和参数，前端按界面语言渲染；老通知只有 text */
export interface Notification { id: number; type: string; actor: string | null; actorNickname: string | null; actorAvatar: string | null; ref: string | null; text: string; key?: string; params?: Record<string, string | number> | null; read: boolean; createdAt: number }
export interface Member extends Profile { role: 'owner' | 'admin' | 'member'; joinedAt: number; /** 禁言到期时间（毫秒），没被禁言没有这个字段 */ mutedUntil?: number }
export interface ChatMessage { id: string; groupId: string; from: string; text: string; ts: number; replyTo?: string; mentions?: string[]; kind?: 'text' | 'image' | 'video' | 'voice' | 'tip' | 'system'; meta?: Record<string, unknown> }
/**
 * legacy：旧版客户端发出的，服务器上没有发件人自己那份密文；undecryptable：密文解不开（不是给这个钱包的）；
 * locked：网页版 0x4 插件锁着、这条还没解密（同时也是 undecryptable，不存本机、不 ack），插件解锁后重新拉
 */
export interface DmMessage { id: string; from: string; to: string; text: string; ts: number; failed?: boolean; legacy?: boolean; undecryptable?: boolean; locked?: boolean }
/** 私信会话对方的公开资料（会话列表用） */
export interface DmPeer { nickname: string | null; avatar: string | null; evmAddress: string | null; encPub: string | null }

let token: string | null = null
export const setToken = (t: string | null) => { token = t }
export const getToken = () => token

/**
 * 网页版没钱包时的写操作拦截（desktop/walletGate.ts 注册）：返回 true = 已打开钱包入口，这次请求不发。
 * 登录接口不会被拦（它只在钱包解锁后调用，那时拦截函数返回 false），手机 App 不注册。
 */
let writeGuard: (() => boolean) | null = null
export function setWriteGuard(fn: (() => boolean) | null) { writeGuard = fn }
/**
 * 只靠手机扫码登录的网页版做了要连钱包的事（动钱、改交易、私信…），服务器回 403 + code WALLET_REQUIRED（server/src/webQrScope.ts）：
 * 直接弹出连接钱包（desktop/walletGate.ts 注册），不报红色错误。连上钱包后这些功能都能用
 */
let walletRequired: (() => void) | null = null
export function setWalletRequiredHandler(fn: (() => void) | null) { walletRequired = fn }

/** anonymous：登录接口用。不带令牌、不拦写操作、401 也不当「令牌过期」（两次登录并发时，前一次的 nonce 被后一次作废会回 401，
 *  以前这会触发 onUnauthorized → 清掉后一次刚拿到的令牌再重登，网页版上就是登录窗口一个接一个弹，2026-09-29）
 *  token：这一次请求用指定的令牌、不用全局令牌（登录时先验本机存的令牌，确认钱包没换之前不能把它设成全局的，store/social.ts runLogin） */
export async function api<T>(path: string, init: RequestInit = {}, opts: { anonymous?: boolean; token?: string } = {}): Promise<T> {
  const method = (init.method || 'GET').toUpperCase()
  const bearer = opts.anonymous ? null : opts.token ?? token
  // 名字 WalletRequired + 文案「已取消」：报错过滤认作用户取消，不弹红色提示（lib/errors.ts）
  if (!bearer && !opts.anonymous && method !== 'GET' && writeGuard?.()) throw Object.assign(new Error('已取消'), { name: 'WalletRequired' })
  const res = await fetch(SOCIAL_API + path, {
    ...init,
    // 没有请求体时不带 content-type，否则 Fastify 会拒绝空 JSON
    headers: { ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(init.headers || {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    // 带着令牌却被拒 = 令牌过期或作废（登录接口走 anonymous，不会走到这里）
    if (res.status === 401 && bearer && bearer === token && onUnauthorized) onUnauthorized()
    if (res.status === 403 && (body as { code?: unknown }).code === 'WALLET_REQUIRED' && walletRequired) { walletRequired(); throw Object.assign(new Error('已取消'), { name: 'WalletRequired' }) }
    // 服务器报错是简体原文，按当前语言翻译（字典里没有就原样）
    // code：服务器给的机器可读原因（比如会议的 PASSWORD_REQUIRED / PASSWORD_WRONG / KICKED），界面按它分支，不靠比对文案
    throw Object.assign(new Error(translateServerError((body as { error?: string }).error || `HTTP ${res.status}`)), { status: res.status, code: (body as { code?: unknown }).code })
  }
  return body as T
}

/** /api/upload 的返回：图片带缩略图和宽高，其它只有 url */
export interface UploadResult { url: string; kind: string; thumb?: string; width?: number; height?: number }

/**
 * 上传一个文件。传了 onProgress 就走 XMLHttpRequest 拿上传进度（fetch 拿不到），
 * 错误处理和 api() 一样：401 触发重新登录，服务器报错按界面语言翻译。
 */
export function uploadFile(file: Blob, name?: string, onProgress?: (fraction: number) => void): Promise<UploadResult> {
  const fd = new FormData()
  if (name) fd.append('file', file, name); else fd.append('file', file)
  if (!onProgress || typeof XMLHttpRequest === 'undefined') return api<UploadResult>('/api/upload', { method: 'POST', body: fd })
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', SOCIAL_API + '/api/upload')
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && e.total) onProgress(e.loaded / e.total) }
    xhr.onload = () => {
      let body: unknown = {}
      try { body = JSON.parse(xhr.responseText) } catch { /* 非 JSON 当空 */ }
      if (xhr.status >= 200 && xhr.status < 300) { onProgress(1); resolve(body as UploadResult); return }
      if (xhr.status === 401 && token && onUnauthorized) onUnauthorized()
      reject(Object.assign(new Error(translateServerError((body as { error?: string }).error || `HTTP ${xhr.status}`)), { status: xhr.status }))
    }
    xhr.onerror = () => reject(new Error(t('网络连接失败，请重试')))
    xhr.ontimeout = xhr.onerror
    xhr.send(fd)
  })
}

/** 令牌失效时的回调，由社交 store 装上（清掉本机保存的令牌、回到重新验证） */
let onUnauthorized: (() => void) | null = null
export const setOnUnauthorized = (fn: (() => void) | null) => { onUnauthorized = fn }

/**
 * 签登录消息，换取 JWT。手机 App 用 Solana 私钥（私钥在哪由签名器决定，App 里在原生模块内）；电脑网页版用插件的 0x 地址（见函数里）。
 * ★只返回令牌、不设成全局令牌（2026-09-29 审查）：签名要等用户在插件里点确认，这期间可能换了号；
 * 以前这里直接 setToken，换号后新地址的登录会接着用上旧地址的令牌。由调用方确认钱包还是原来那个之后再设（store/social.ts runLogin）。
 */
export async function loginWithWallet(wallet: SolanaWallet | null, evmAddress?: string | null, evmAccount?: Account | null): Promise<{ token: string; user: Profile }> {
  const ext = wallet ? (wallet as SolanaWallet & { signLogin?: (m: string, evmLink?: string) => Promise<{ signature: string; chain: 'solana' | 'evm'; evmSignature?: string }> }).signLogin : undefined
  // ★网页版（2026-09-30 goat 定）：用插件的 0x 地址登录。服务器发 SIWE（EIP-4361，domain = 网页版域名、Chain ID 56，/api/auth/nonce?surface=web），
  // 插件用 EVM 私钥签（核对 domain 就是这个网站、地址是自己的），服务器按 evm_proofs 登进证明过这个 0x 的账号（和手机 App 同一个账号），
  // 没人证明过就是这个 0x 地址本身。令牌带网页标记（不能批准电脑 / 管理后台扫码），由签名命中的 nonce 决定，请求体里不带 surface。
  // 网页版只连插件，没有插件的 signLogin 就不登录（不退回「网页自己签」的老路）
  if (WEB_SURFACE) {
    // 外部钱包（2026-09-30：MetaMask、Phantom 等）：同一条 SIWE 登录消息，用它的 personal_sign 签（这些钱包自己会核对消息里的网站和当前网页是否一致）
    const external = !!evmAccount && !!externalOf(evmAccount)
    // domain：网页版现在在哪个域名（0x4-site.vercel.app 或 420.meme），服务器按它出题，插件 / 外部钱包核对它就是当前网站
    if ((!ext && !external) || !evmAddress) throw new Error(t('请先连接钱包'))
    const n = await api<{ nonce: string; issuedAt: string; message: string }>(`/api/auth/nonce?address=${evmAddress}&surface=web&domain=${currentWebDomain()}`, {}, { anonymous: true })
    let signature: string
    if (ext) {
      const r = await ext(n.message)
      if (r.chain !== 'evm') throw new Error(t('插件返回的登录签名不对，请更新插件后再试'))
      signature = r.signature
    } else signature = await evmAccount!.signMessage!({ message: n.message })
    return api<{ token: string; user: Profile }>('/api/auth/verify', { method: 'POST', body: JSON.stringify({ address: evmAddress, chainType: 'evm', signature, issuedAt: n.issuedAt }) }, { anonymous: true })
  }
  if (!wallet) throw new Error(t('请先连接钱包'))
  const address = wallet.publicKey.toBase58()
  // 手机 App：Solana 私钥签服务器给的登录消息（SIWS，domain = app.420.meme），原样签。
  // 传了已解锁的 evmAccount 就用同一个 nonce 顺带签 EVM 关联消息（lib/evmLink），服务器据此认定 EVM 地址归这个账号。EVM 签名失败不挡登录，之后解锁时再补
  const n = await api<{ nonce: string; issuedAt: string; message: string }>(`/api/auth/nonce?address=${address}`, {}, { anonymous: true })
  const linkable = !!evmAccount && !!evmAddress && evmAccount.address.toLowerCase() === evmAddress.toLowerCase()
  const sig = bs58.encode(await wallet.signMessage(new TextEncoder().encode(n.message)))
  const evmSignature = linkable ? await signEvmLink(evmAccount!, address, n.nonce).catch(() => undefined) : undefined
  return api<{ token: string; user: Profile }>('/api/auth/verify', { method: 'POST', body: JSON.stringify({ address, chainType: 'solana', signature: sig, issuedAt: n.issuedAt, evmAddress: evmAddress || undefined, evmSignature }) }, { anonymous: true })
}

/** 已登录状态下补签 EVM 地址证明：拿一次性 nonce → 签 → 提交。返回服务端给的工作人员身份（普通用户 null） */
export async function proveEvmLink(solanaAddress: string, account: Account): Promise<{ role: string | null }> {
  const { nonce } = await api<{ nonce: string }>('/api/me/evm-proof/challenge?v=2')
  const signature = await signEvmLink(account, solanaAddress, nonce)
  return api<{ role: string | null }>('/api/me/evm-proof', { method: 'POST', body: JSON.stringify({ evmAddress: account.address, nonce, signature }) })
}

// 端到端加密私信的实现已移到 src/lib/vault/dm.ts（App 里在原生完成，网页版仍在 JS）

// ---------- WebSocket ----------

type Listener = (data: Record<string, unknown>) => void

export class SocialSocket {
  private ws: WebSocket | null = null
  private listeners = new Set<Listener>()
  private joined = new Set<string>()
  private closed = false
  private retry = 0
  status: 'connecting' | 'open' | 'closed' = 'closed'
  onStatus: ((s: SocialSocket['status']) => void) | null = null

  connect() {
    if (!token) return
    this.closed = false
    this.status = 'connecting'; this.onStatus?.(this.status)
    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`)
    this.ws = ws
    ws.onopen = () => {
      this.retry = 0
      this.status = 'open'; this.onStatus?.(this.status)
      for (const g of this.joined) ws.send(JSON.stringify({ type: 'join', groupId: g }))
    }
    ws.onmessage = (e) => {
      try { const d = JSON.parse(e.data); for (const l of this.listeners) l(d) } catch { /* ignore */ }
    }
    ws.onclose = (ev) => {
      this.status = 'closed'; this.onStatus?.(this.status)
      // 服务器说这台电脑的登录被下线了（手机上让它下线、或扫码登录太久没操作）：不再重连，按登录失效处理
      if (ev?.code === 4003 && ev.reason === 'revoked') { this.closed = true; onUnauthorized?.(); return }
      if (!this.closed) setTimeout(() => this.connect(), Math.min(15_000, 1000 * 2 ** this.retry++))
    }
  }

  close() { this.closed = true; this.ws?.close(); this.ws = null }
  on(l: Listener) { this.listeners.add(l); return () => this.listeners.delete(l) }
  send(data: Record<string, unknown>) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(data)) }
  join(groupId: string) { this.joined.add(groupId); this.send({ type: 'join', groupId }) }
  leave(groupId: string) { this.joined.delete(groupId); this.send({ type: 'leave', groupId }) }
}
