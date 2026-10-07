// Social layer client: signed login, REST calls, WebSocket, end-to-end encrypted DMs
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

/** thumb = the thumbnail from the indexing service (used for avatar display); image = the original from the on-chain metadata */
export interface AvatarNft { chainId: number; contract: string; tokenId: string | null; image: string; name?: string | null; thumb?: string | null }
export interface Profile { /** This address is the sprite (entered by tapping the sprite in the feed): route to the sprite page (2026-10-05) */ sprite?: { id: string; name: string; owner: string; ownerNickname: string | null } | null; address: string; nickname: string | null
  /** This account's default nickname (User + number, 2026-09-29); a matching nickname means the user hasn't picked one yet. Old servers lack this field */
  defaultNickname?: string | null
  avatar: string | null; bio: string | null; encPub: string | null; evmAddress?: string | null; handle?: string | null; lastSeen: number | null; avatarNft?: AvatarNft | null; xHandle?: string | null
  /** Only your own profile (/api/me, login response) carries it: whether the EVM address has a signed proof. Old servers lack this field = undefined */
  evmVerified?: boolean }
export interface GroupGate { kind: 'token' | 'nft'; chainId: number; token: string; symbol: string | null; min: number }
/** Group meeting (server meetAuth.ts activeGroupMeeting): participants = the number of people in the meeting right now, 0 when just created and nobody's joined yet */
export interface GroupMeeting { id: string; title: string; host: string; hostNickname: string | null; hasPassword: boolean; participants: number; since: number | null }
export interface Group {
  id: string; name: string; description: string | null; avatar: string | null; owner: string; isPublic: boolean
  /** Group number (6+ digits, searchable directly in "find groups") */
  num?: number | null
  gate: GroupGate | null; token: { chain: string; address: string } | null; memberCount: number; role: 'owner' | 'admin' | 'member' | null; createdAt: number; joinMode?: 'open' | 'approval'
  /** Official community (created by platform admins in the backend): true shows a gold verified badge beside the group name; regular groups are always false */
  official?: boolean
  /** Ongoing meeting in a group (2026-10-07 group meetings; members only: my groups, group details) */
  meeting?: GroupMeeting | null
  /** The coin linked to an official community (optional) */
  officialToken?: { chain: string; address: string } | null
  /** All-muted: only the owner and admins can speak */
  mutedAll?: boolean
  /** No DMs between group members (2026-09-29): regular members can't DM other regular members in a group; owners / admins / platform staff as usual */
  dmLocked?: boolean
  /** Group announcement: members only */
  announcement?: string | null
  announcementAt?: number | null
}
/** Coin detail page's community card: aggregate numbers only, no per-holder amounts */
export interface CommunityCard { id: string; name: string; avatar: string | null; memberCount: number; holders: number; totalUsd: number; joinMode: 'open' | 'approval'; gated: boolean; official?: boolean }
/** Coin detail page's top 3 "communities holding the most" (official communities don't get their own block; official = true when ranked) */
export interface TokenCommunities { top: CommunityCard[] }
// Perp account equity comes from Hyperliquid; stays null when the source is unavailable.
export interface FlyTick { ts: number; tick: number; equity: number; accountEquity?: number | null; equitySource?: string; pnlDelta: number | null; product?: string; symbol?: string; chain?: string; token?: string; price?: number; execution: string; /** The reason written by the trading process (explains why when paused) */ executionReason?: string | null; changedEdges: number; neural: { side?: string; left_hz?: number; right_hz?: number; difference_hz?: number; gate_spikes?: number; total_spikes?: number; KC_spikes?: number; reward_spikes?: number; aversive_spikes?: number; stimulus?: string } }
/** Auto coin discovery (2026-09-27): the sprite picks coins from hot / new listings itself, max 5 chains */
export interface FlyAutoPick { source: 'hot' | 'new' | 'both'; chains: string[] }
export interface FlyParams { autoPick?: FlyAutoPick | null; tokens: { chain: string; address: string; symbol: string }[]; thresholdHz: number; learning: boolean; neuralMs: number; cadenceMin: number; budget: number; orderLimit: number; lossStop: number; leverage: number; market: 'spot' | 'perp'; senses?: ('funding' | 'oi')[]; decoderBaseline?: number }
export type FlyPlan = 'basic' | 'pro'
export type FlyMode = 'pending' | 'confirm' | 'perp'  // No paper: pending = adopted but no trading mode chosen yet — the worker assigns no orders
/** Per-order perps confirmation (2026-09-28): when the owner is online on desktop and has "confirm each trade with me" on, the sprite's perps orders wait for the owner's approval (server fly_perp_asks, valid 10 minutes) */
export interface FlyAsk { id: string; flyId: string; flyName: string; side: 'BUY' | 'SELL'; coin: string; action: 'open' | 'close'; price: number; marginUsd: number; leverage: number; notional: number; status: string; createdAt: number; expiresAt: number }
export interface FlyProposal { id: string; flyId: string; flyName: string; side: 'buy' | 'sell'; symbol: string; chain: string; token: string; usd: number; price: number | null; expiresAt: number; /** The sprite's own words (LLM-generated, may be absent) */ say?: string | null; sayEn?: string | null; /** half = double-then-free-ride (sell half to recover principal) */ kind?: string | null }
export interface FlyPlanDef { price: number; slots: number; minCadence: number; label: string }
export type HoldStyle = 'quick' | 'double' | 'diamond'
export interface FlyPrefs { askWhenOnline: boolean; autoApproveUsd: number; dailyStopUsd: number; publicPnl: boolean; publicPositions: boolean; /** Spot holding styles (three diamond-hand tiers): quick in-out / double-then-free-ride / diamond hands */ holdStyle?: HoldStyle }
/** Zalien card (2026-09-27): free = never claimed, claiming grants 1 month; idle = free month used up, currently idle; busy = a fly is running on it */
export interface ZalienCard { tokenId: number; name: string; image: string; status: 'free' | 'idle' | 'busy'; fly: { id: string; name: string; mine: boolean; paidUntil: number | null; releaseAt: number | null } | null }
export interface ZalienCards { cards: ZalienCard[]; evmAddresses: number; liveFlies: number; maxFlies: number; contract: string }
export interface Fly { /** Owner only: count of trade requests that went unapproved and expired-void under spot confirm mode (since last viewed, 2026-10-04) */ missedAsks?: number; autoTokens?: { chain: string; address: string; symbol: string }[]; nftToken?: number | null; /** The owner still holds this Zalien (server 60-second holding snapshot; null = no card bound or temporarily unknown) */ nftHolder?: boolean | null; releaseAt?: number | null; prefs?: Partial<FlyPrefs>; pnlHidden?: boolean; activated: boolean; realEquity: number | null; realAnchor: number | null; realizedTrades: number | null; turnover: number | null; plan: FlyPlan; paidUntil: number | null; expired: boolean; mode: FlyMode; leverage: number; marginUsd: number; agreementAt: number | null; /** Whether the agreed agreement is the current real-money version */ agreementCurrent?: boolean; perp: { mainAddress: string } | null; id: string; owner: string; ownerNickname: string | null; ownerAvatar: string | null; address: string; name: string; params: FlyParams; paused: boolean; tick: number; equity: number | null; cash: number | null; positions: Record<string, number>; halted: string | null; lastTickAt: number | null; createdAt: number; followers: number; online: boolean; pnl: number | null; frameUrl: string | null; ticks?: FlyTick[] }
/** key / params: since 2026-09-26 the server sends a template (Simplified Chinese source) plus params, and the client renders per UI language; old notifications only have text */
export interface Notification { id: number; type: string; actor: string | null; actorNickname: string | null; actorAvatar: string | null; ref: string | null; text: string; key?: string; params?: Record<string, string | number> | null; read: boolean; createdAt: number }
export interface Member extends Profile { role: 'owner' | 'admin' | 'member'; joinedAt: number; /** Mute expiry (ms); absent when not muted */ mutedUntil?: number }
export interface ChatMessage { id: string; groupId: string; from: string; text: string; ts: number; replyTo?: string; mentions?: string[]; kind?: 'text' | 'image' | 'video' | 'voice' | 'tip' | 'system'; meta?: Record<string, unknown> }
/**
 * legacy: sent by an old client — the server has no copy of the sender's own ciphertext; undecryptable: the ciphertext can't be decrypted (not for this wallet);
 * locked: web 0x4 extension is locked and this message isn't decrypted yet (also undecryptable — not stored locally, not acked); re-pulled after the extension unlocks
 */
export interface DmMessage { id: string; from: string; to: string; text: string; ts: number; failed?: boolean; legacy?: boolean; undecryptable?: boolean; locked?: boolean }
/** The DM conversation peer's public profile (for the conversation list) */
export interface DmPeer { nickname: string | null; avatar: string | null; evmAddress: string | null; encPub: string | null }

let token: string | null = null
export const setToken = (t: string | null) => { token = t }
export const getToken = () => token

/**
 * Web write-op interception when there's no wallet (registered in desktop/walletGate.ts): returning true = the wallet entry is already open, this request is not sent.
 * The login endpoint is never intercepted (it's only called after the wallet unlocks, when the interceptor returns false); the phone app doesn't register it.
 */
let writeGuard: (() => boolean) | null = null
export function setWriteGuard(fn: (() => boolean) | null) { writeGuard = fn }
/**
 * Web logged in via phone QR scan only, attempting something that needs a wallet (moving money, changing trades, DMs…): the server returns 403 + code WALLET_REQUIRED (server/src/webQrScope.ts):
 * pop the wallet-connect flow directly (registered in desktop/walletGate.ts), no red error. Once a wallet is connected, all these features work.
 */
let walletRequired: (() => void) | null = null
export function setWalletRequiredHandler(fn: (() => void) | null) { walletRequired = fn }

/** anonymous: for the login endpoints. No token, write ops not blocked, and a 401 is not treated as "token expired" (with two concurrent logins, the first login's nonce is invalidated by the second and returns 401 —
 *  that used to trigger onUnauthorized -> wipe the just-obtained token of the second login and re-login, i.e. login popups one after another on web, 2026-09-29)
 *  token: this request uses the given token instead of the global one (during login, first verify the locally stored token and confirm the wallet hasn't changed before promoting it to global — store/social.ts runLogin) */
export async function api<T>(path: string, init: RequestInit = {}, opts: { anonymous?: boolean; token?: string } = {}): Promise<T> {
  const method = (init.method || 'GET').toUpperCase()
  const bearer = opts.anonymous ? null : opts.token ?? token
  // Named WalletRequired with the copy "cancelled": the error filter treats it as user-cancelled, no red toast (lib/errors.ts)
  if (!bearer && !opts.anonymous && method !== 'GET' && writeGuard?.()) throw Object.assign(new Error('已取消'), { name: 'WalletRequired' })
  const res = await fetch(SOCIAL_API + path, {
    ...init,
    // Omit content-type when there's no body, otherwise Fastify rejects the empty JSON
    headers: { ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(init.headers || {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Rejected despite carrying a token = the token expired or was revoked (login endpoints go through anonymous and never reach here)
    if (res.status === 401 && bearer && bearer === token && onUnauthorized) onUnauthorized()
    if (res.status === 403 && (body as { code?: unknown }).code === 'WALLET_REQUIRED' && walletRequired) { walletRequired(); throw Object.assign(new Error('已取消'), { name: 'WalletRequired' }) }
    // Server errors come in Simplified Chinese source; translate per current language (as-is when the dictionary lacks it)
    // code: the machine-readable reason from the server (e.g. meeting PASSWORD_REQUIRED / PASSWORD_WRONG / KICKED) — the UI branches on it, never on comparing copy
    throw Object.assign(new Error(translateServerError((body as { error?: string }).error || `HTTP ${res.status}`)), { status: res.status, code: (body as { code?: unknown }).code })
  }
  return body as T
}

/** /api/upload response: images come with thumbnail and dimensions; everything else is url-only */
export interface UploadResult { url: string; kind: string; thumb?: string; width?: number; height?: number }

/**
 * Upload a file. With onProgress, go through XMLHttpRequest for upload progress (fetch can't provide it);
 * error handling is the same as api(): 401 triggers re-login, server errors are translated into the UI language.
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
      try { body = JSON.parse(xhr.responseText) } catch { /* Non-JSON treated as empty */ }
      if (xhr.status >= 200 && xhr.status < 300) { onProgress(1); resolve(body as UploadResult); return }
      if (xhr.status === 401 && token && onUnauthorized) onUnauthorized()
      reject(Object.assign(new Error(translateServerError((body as { error?: string }).error || `HTTP ${xhr.status}`)), { status: xhr.status }))
    }
    xhr.onerror = () => reject(new Error(t('网络连接失败，请重试')))
    xhr.ontimeout = xhr.onerror
    xhr.send(fd)
  })
}

/** Callback for expired tokens, installed by the social store (clears the locally saved token, returns to re-verification) */
let onUnauthorized: (() => void) | null = null
export const setOnUnauthorized = (fn: (() => void) | null) => { onUnauthorized = fn }

/**
 * Sign the login message to exchange for a JWT. The phone app signs with the Solana private key (where the key lives is the signer's business; in-app it's inside the native module); the desktop web signs with the extension's 0x address (see inside the function).
 * Only returns the token — never promotes it to global (2026-09-29 review): signing waits on the user confirming in the extension, during which they might switch accounts;
 * it used to setToken here directly, so logging in with a new address would keep using the old address's token. The caller promotes it only after confirming the wallet is still the same one (store/social.ts runLogin).
 */
export async function loginWithWallet(wallet: SolanaWallet | null, evmAddress?: string | null, evmAccount?: Account | null): Promise<{ token: string; user: Profile }> {
  const ext = wallet ? (wallet as SolanaWallet & { signLogin?: (m: string, evmLink?: string) => Promise<{ signature: string; chain: 'solana' | 'evm'; evmSignature?: string }> }).signLogin : undefined
  // Web (goat's call 2026-09-30): log in with the extension's 0x address. The server issues SIWE (EIP-4361, domain = the web domain, Chain ID 56, /api/auth/nonce?surface=web),
  // The extension signs with the EVM private key (verifying the domain is this site and the address is its own); the server logs into this 0x account per the evm_proofs proof (the same account as the phone app),
  // Nobody has proven this is the 0x address itself. The token carries a web mark (can't approve desktop / admin QR scans), decided by the nonce the signature hit — the request body carries no surface.
  // Web only connects via the plugin; without the plugin's signLogin there's no login (no falling back to the old "web signs itself" path)
  if (WEB_SURFACE) {
    // External wallets (2026-09-30: MetaMask, Phantom, etc.): sign the same SIWE login message with their personal_sign (these wallets check the message's site against the current page themselves)
    const external = !!evmAccount && !!externalOf(evmAccount)
    // domain: which domain the web build is currently on (0x4-site.vercel.app or 420.meme) — the server issues the challenge against it, and the extension / external wallets verify it matches the current site
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
  // Phone app: the Solana private key signs the server-issued login message (SIWS, domain = app.420.meme), signed as-is.
  // With an unlocked evmAccount passed in, sign the EVM link message with the same nonce on the way (lib/evmLink) — the server attributes the EVM address to this account. An EVM signature failure doesn't block login; it's retried at the next unlock
  const n = await api<{ nonce: string; issuedAt: string; message: string }>(`/api/auth/nonce?address=${address}`, {}, { anonymous: true })
  const linkable = !!evmAccount && !!evmAddress && evmAccount.address.toLowerCase() === evmAddress.toLowerCase()
  const sig = bs58.encode(await wallet.signMessage(new TextEncoder().encode(n.message)))
  const evmSignature = linkable ? await signEvmLink(evmAccount!, address, n.nonce).catch(() => undefined) : undefined
  return api<{ token: string; user: Profile }>('/api/auth/verify', { method: 'POST', body: JSON.stringify({ address, chainType: 'solana', signature: sig, issuedAt: n.issuedAt, evmAddress: evmAddress || undefined, evmSignature }) }, { anonymous: true })
}

/** Backfill the EVM address proof while logged in: fetch a one-time nonce → sign → submit. Returns the staff identity the server assigns (null for regular users) */
export async function proveEvmLink(solanaAddress: string, account: Account): Promise<{ role: string | null }> {
  const { nonce } = await api<{ nonce: string }>('/api/me/evm-proof/challenge?v=2')
  const signature = await signEvmLink(account, solanaAddress, nonce)
  return api<{ role: string | null }>('/api/me/evm-proof', { method: 'POST', body: JSON.stringify({ evmAddress: account.address, nonce, signature }) })
}

// The end-to-end encrypted DM implementation has moved to src/lib/vault/dm.ts (done natively in the app, still in JS on web)

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
      // Server says this computer's session was logged out elsewhere (kicked from the phone, or the QR login sat idle too long): don't reconnect, treat it as an expired session
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
