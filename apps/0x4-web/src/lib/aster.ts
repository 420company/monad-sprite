// BSC-native perps (Aster): users pay gas in BNB throughout.
// Same structure as the previous contract layer: quotes / account / orders / leverage / cancels / deposits / withdrawals / authorization.
// Auth model (verified against the official demo and the real API on 2026-09-18):
//  - Trading requests must be signed by an "authorized agent" (signing directly with the main wallet reports No agent found). The manual-trading agent derives from the main wallet
//    Derived from a deterministic signature over a fixed message — never persisted, never displayed, recomputable after unlock; on first use or expiry, auto-sign one approveAgent with the main wallet.
//  - Management (approveAgent): the main wallet signs EIP-712, domain AsterSignTransaction, chainId 56, field names capitalized.
//  - Trading: the agent signs EIP-712 Message{msg = final querystring}, domain chainId 1666.
//  - Withdraw: the main wallet signs the Action (domain Aster, chainId 56), then POSTs it together with the agent signature.
//  - Deposit: call Treasury.deposit(USDT, amount, broker=1) on-chain, gas in BNB.
// Builder (Aster Code): orders carry builder + feeRate; we take 0.06% of volume (raised from 0.05% on 2026-09-25; taker total rounds to 0.1%).
import { encodeFunctionData, getTypesForEIP712Domain, hashDomain, hashStruct, keccak256, parseAbi, type Account, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { ensureAllowance, getEvmTokenBalance, publicClient, sendEvmTx } from './evm'
import { executeLifiStep, getLifiQuote } from './lifi'
import { NATIVE_EVM } from './chains'
import { Vault, nativeVault } from './vault/native'
import { ensureUnlocked, onLock } from './vault/gate'
import { t } from '@/lib/i18n'
import { api } from './social'
import { perpReadEndpointOf, perpReadQuery, type PerpReadEndpoint } from './asterPerpRead'
import { BUILDER as PERP_BUILDER, BUILDER_FEE as PERP_BUILDER_FEE, perpWriteBatch, perpWriteOk, type PerpWriteAction, type PerpWriteResult } from './asterPerpWrite'

/** Exchange API base URL. Exported for lib/asterBook.ts (web perps terminal order book / latest trades — public market data, no signature needed) */
export const HOST = 'https://fapi.asterdex.com'
const BAPI = 'https://www.asterdex.com/bapi/futures/v1/public/future/aster'
export const BSC_CHAIN_ID = 56
export const BSC_USDT = '0x55d398326f99059fF775485246999027B3197955' // USDT on BSC has 18 decimals
export const TREASURY = '0x128463A60784c4D3f46c23Af3f65Ed859Ba87974'
/** The fee address and rate cap live in lib/asterPerpWrite.ts (the extension also checks web orders against it); the same value is exported here */
export const BUILDER = PERP_BUILDER
// The user-approved fee cap = what we actually charge: 0.06% of volume. The exchange allows up to 0.1%.
// ⚠️ After raising it, existing users' authorized cap is still the old value and orders get rejected → call() detects this and auto re-authorizes once (see FEE_REAUTH).
//    The fly autopilot (fly/stonkfly/aster.py) stays at 0.0005: its authorization can't be re-signed by the server for the user — changing it requires the user to re-authorize in the app.
export const BUILDER_FEE = PERP_BUILDER_FEE
/**
 * Actual builder fee charged on orders (2026-09-27): 0.06% regular / 0.04% VIP, issued by the server based on VIP status (lib/fees.ts calls setPerpFeeRate after fetching).
 * The cap signed at authorization is still BUILDER_FEE; a VIP lowering needs no re-sign; anything above the cap is never used (the exchange would reject the order)
 */
let orderFeeRate = BUILDER_FEE
export function setPerpFeeRate(rate: number) {
  orderFeeRate = rate >= 0 && rate <= Number(BUILDER_FEE) ? String(Number(rate.toFixed(6))) : BUILDER_FEE
}
export const perpFeeRate = () => Number(orderFeeRate)
export const MIN_DEPOSIT = 5
export const MIN_NOTIONAL = 5 // Exchange minimum notional
export const AGENT_TTL_MS = 180 * 86400_000
const ZERO = '0x0000000000000000000000000000000000000000'
const DOMAIN_MAIN = { name: 'AsterSignTransaction', version: '1', chainId: 56, verifyingContract: ZERO } as const
const DOMAIN_AGENT = { name: 'AsterSignTransaction', version: '1', chainId: 1666, verifyingContract: ZERO } as const
const TREASURY_ABI = parseAbi(['function deposit(address currency, uint256 amount, uint256 broker)', 'function depositNative(uint256 broker) payable'])

export interface PerpMarket { index: number; coin: string; symbol: string; szDecimals: number; pxDecimals: number; maxLeverage: number; markPx: number; prevDayPx: number; change24h: number; funding: number; volume24h: number; openInterest: number; onlyIsolated: boolean }
export interface PerpPosition { coin: string; size: number; isLong: boolean; entryPx: number; positionValue: number; unrealizedPnl: number; roe: number; liquidationPx: number | null; marginUsed: number; leverage: number; isCross: boolean }
export interface PerpAccount { accountValue: number; withdrawable: number; marginUsed: number; positions: PerpPosition[] }
export interface PerpOrder { oid: number; coin: string; isBuy: boolean; limitPx: number; size: number; timestamp: number; reduceOnly?: boolean; trigger?: string }
export interface PerpFill { coin: string; px: number; sz: number; isBuy: boolean; time: number; dir: string; closedPnl: number; fee: number; hash: string }
export type Interval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d'
export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; /** Volume (USD) and the aggressive-buying portion of it: only perps K-lines have it; used by "buy/sell pressure" (lib/perpFlow.ts) */ quoteVolume?: number; buyQuote?: number }

const num = (s: string | number | null | undefined) => { const n = Number(s); return Number.isFinite(n) ? n : 0 }
export const symbolOf = (coin: string) => `${coin.toUpperCase()}USDT`
export const coinOf = (symbol: string) => symbol.replace(/USDT$/, '')

// ---------- nonce / signing ----------
let lastSec = 0, seq = 0
/** Official convention: seconds × 1e6 + increment within the same second, guaranteeing monotonicity */
function nonce(): number { const s = Math.floor(Date.now() / 1000); if (s === lastSec) seq++; else { lastSec = s; seq = 0 } return s * 1_000_000 + seq }
const qsOf = (p: Record<string, unknown>) => new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)])).toString()

async function readJson(r: Response) {
  const text = await r.text()
  let body: unknown = text
  try { body = JSON.parse(text) } catch { /* Non-JSON */ }
  return checked(r.ok, body, text)
}
/** Exchange results: HTTP failure or code < 0 throws as an error (read-only queries handled by the extension come back through here too, status code and JSON) */
function checked(ok: boolean, body: unknown, text: string) {
  if (!ok || (body && typeof body === 'object' && 'code' in body && Number((body as { code: number }).code) < 0)) {
    const msg = body && typeof body === 'object' ? String((body as { msg?: string; error?: string }).msg || (body as { error?: string }).error || text) : text
    throw Object.assign(new Error(friendly(msg)), { aster: body })
  }
  return body
}
function friendly(msg: string): string {
  if (/No agent found/i.test(msg)) return 'NO_AGENT'
  // Order fee rate exceeds the cap signed at authorization (platform fee was raised): re-authorization needed. The exchange's original message has no public docs — match loosely by keywords
  if (/fee ?rate|maxFeeRate|builder fee/i.test(msg)) return 'FEE_REAUTH'
  if (/Margin is insufficient/i.test(msg)) return t('保证金不足')
  if (/ReduceOnly Order is rejected/i.test(msg)) return t('没有可减的仓位')
  if (/notional|MIN_NOTIONAL/i.test(msg)) return t('订单金额低于交易所最小值 ${n}', { n: MIN_NOTIONAL })
  if (/precision|LOT_SIZE|PRICE_FILTER/i.test(msg)) return t('数量或价格精度不对')
  if (/No need to change/i.test(msg)) return 'NO_CHANGE'
  return msg
}

/** The main wallet signs management requests (approveAgent etc.): field names capitalized, types inferred from values, fixed trailing AsterChain / User / Nonce */
async function signMain(account: Account, primaryType: string, params: Record<string, string | number | boolean>) {
  const full: Record<string, string | number | boolean> = { ...params, asterChain: 'Mainnet', user: account.address, nonce: nonce() }
  const types = { [primaryType]: Object.entries(full).map(([k, v]) => ({ name: k[0].toUpperCase() + k.slice(1), type: typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? 'uint256' : 'string' })) }
  const message = Object.fromEntries(Object.entries(full).map(([k, v]) => [k[0].toUpperCase() + k.slice(1), typeof v === 'number' ? String(v) : v]))
  const signature = await account.signTypedData!({ domain: DOMAIN_MAIN, types, primaryType, message })
  return { ...full, signature, signatureChainId: 56 }
}

/** The agent signs trading requests: msg = the final querystring (excluding signature) */
async function signedRequest(agent: PerpAgent, user: string, method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, unknown> = {}) {
  const full = { ...params, asterChain: 'Mainnet', user, signer: agent.address, nonce: nonce() }
  const qs = qsOf(full)
  const signature = await agent.signTypedData({ domain: DOMAIN_AGENT, types: { Message: [{ name: 'msg', type: 'string' }] }, primaryType: 'Message', message: { msg: qs } })
  return readJson(await fetch(`${HOST}${path}?${qs}&signature=${signature}`, { method }))
}

// ---------- agent: for manual trading, derived from the main wallet ----------
/** The agent key only needs two things: the "address" and "sign structured data" */
export interface PerpAgent {
  address: Hex
  signTypedData(td: { domain: typeof DOMAIN_AGENT; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown> }): Promise<Hex>
}

let agentCache = new WeakMap<Account, PerpAgent>()
// Drop the agent key the moment the wallet locks: the web-derived one lives in memory — without dropping it, orders could keep going while locked
onLock(() => { agentCache = new WeakMap() })

/**
 * Fixed-message signature -> keccak -> private key. The signature is deterministic (RFC6979) — the same wallet derives the same key every time; stored nowhere.
 * In the app the whole derivation and signing happens inside the native module; the web layer only ever gets the agent address (native and web derive the same key — there's a cross-check test).
 */
export async function agentFor(account: Account): Promise<PerpAgent> {
  let a = agentCache.get(account)
  if (a) return a
  // The 0x4 browser extension connected on web: the trading key is derived inside the extension, the private key never leaves it; the extension also won't sign the raw "0x4 perp agent v2" message (lib/vault/extension.ts)
  const ox4Agent = (account as Account & { ox4Agent?: () => Promise<PerpAgent> }).ox4Agent
  if (ox4Agent) {
    a = await ox4Agent()
  } else if (nativeVault) {
    // Native locking also clears the agent key — unlock first (locked pops verification)
    await ensureUnlocked(t('确认合约交易'))
    const { address } = await Vault.agentAddress()
    a = {
      address: address as Hex,
      async signTypedData(td) {
        const domainSeparator = hashDomain({
          domain: td.domain,
          types: { EIP712Domain: getTypesForEIP712Domain({ domain: td.domain }) },
        } as Parameters<typeof hashDomain>[0])
        const structHash = hashStruct({ data: td.message, primaryType: td.primaryType, types: td.types } as Parameters<typeof hashStruct>[0])
        await ensureUnlocked(t('确认合约交易'))
        const { signature } = await Vault.signAgentTypedData({ domainSeparator, structHash })
        return signature as Hex
      },
    }
  } else {
    const sig = await account.signMessage!({ message: `0x4 perp agent v2\n${account.address.toLowerCase()}` })
    const local = privateKeyToAccount(keccak256(sig))
    a = { address: local.address, signTypedData: (td) => local.signTypedData(td as Parameters<typeof local.signTypedData>[0]) }
  }
  agentCache.set(account, a)
  return a
}
/** The main wallet signs once to register the agent with the exchange (perps only, no withdrawals, valid 180 days), approving our builder fee at the same time */
export async function approveAgentAddress(account: Account, agentAddress: string, agentName: string): Promise<void> {
  const body = await signMain(account, 'ApproveAgent', { agentName: agentName.slice(0, 20), agentAddress, ipWhitelist: '', expired: Date.now() + AGENT_TTL_MS, canSpotTrade: false, canPerpTrade: true, canWithdraw: false, builder: BUILDER, maxFeeRate: BUILDER_FEE, builderName: '0x4' })
  await readJson(await fetch(`${HOST}/fapi/v3/approveAgent`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: qsOf(body) }))
}
/** For the fly: generate a fresh random agent; after authorization, hand the private key to the caller (stored encrypted server-side) — this function saves nothing */
export async function approveAgent(account: Account, agentName: string): Promise<{ agentKey: Hex; agentAddress: string }> {
  const agentKey = generatePrivateKey()
  const agentAddress = privateKeyToAccount(agentKey).address
  await approveAgentAddress(account, agentAddress, agentName)
  return { agentKey, agentAddress }
}
/**
 * Manual perps count toward VIP volume (2026-09-27): authorize the server a "read-only" agent — trading and withdrawal permissions all off; it can only read this account's fill history.
 * The server generates this agent and stores its key encrypted; the main wallet signs one authorization, and it's only enabled after the server confirms with the exchange that permissions are really read-only.
 * Each wallet tries at most once per app launch; a failure doesn't affect trading.
 */
const readerTried = new WeakSet<Account>()
export async function linkPerpReader(account: Account): Promise<void> {
  if (readerTried.has(account)) return
  readerTried.add(account)
  // Web (extension wallet): this step needs the main wallet's signature = the extension pops a "structured signature" window, but it's initiated by the background itself, not a user action (2026-09-29 goat measured: it popped as soon as the perps page opened).
  // Web doesn't auto-authorize yet; the phone app signs without popups, as before
  if (isPluginAccount(account)) return
  try {
    const r = await api<{ agentAddress: string; approved: boolean }>('/api/fees/perp-reader')
    if (r.approved) return
    const body = await signMain(account, 'ApproveAgent', { agentName: '0x4volume', agentAddress: r.agentAddress, ipWhitelist: '', expired: Date.now() + AGENT_TTL_MS, canSpotTrade: false, canPerpTrade: false, canWithdraw: false, builder: BUILDER, maxFeeRate: BUILDER_FEE, builderName: '0x4' })
    await readJson(await fetch(`${HOST}/fapi/v3/approveAgent`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: qsOf(body) }))
    await api('/api/fees/perp-reader/confirm', { method: 'POST' })
  } catch { /* Try again next app launch */ }
}

/** One authorization at a time per wallet: the account / open-orders / fills requests racing to authorize concurrently would collide (measured: some return 400) */
const approving = new WeakMap<Account, Promise<void>>()
function ensureAgent(account: Account, agentAddress: string): Promise<void> {
  let p = approving.get(account)
  if (!p) {
    p = approveAgentAddress(account, agentAddress, '0x4-app').finally(() => { setTimeout(() => approving.delete(account), 3000) })
    approving.set(account, p)
  }
  return p
}
/**
 * The user proactively authorizes a trading key (2026-10-05 goat: funded the perps account, but the perps page kept saying "trading key not authorized" with balances all "--" — no place to authorize just to view balances).
 * Web read-only queries don't auto-popup on unauthorized (see call's note), so the perps page gets a button that goes here: the main wallet signs once, then reads work as usual
 */
export async function authorizePerpAgent(account: Account): Promise<void> {
  const agent = await agentFor(account)
  await ensureAgent(account, agent.address)
  agentMissing.delete(account)
}
/** The 0x4 browser extension connected on web: every main-wallet signature needs the user's confirmation in the extension (lib/vault/extension.ts mounted ox4Agent on the account) */
const isPluginAccount = (account: Account) => typeof (account as Account & { ox4Agent?: unknown }).ox4Agent === 'function'
/** Read-only queries for the web extension account: handled by the extension (lib/asterPerpRead.ts), returning the HTTP status code and the exchange's JSON */
type PerpReadFn = (endpoint: PerpReadEndpoint, params: Record<string, string>) => Promise<{ status: number; body: unknown }>
/** Web: a background read-only query once saw an "unauthorized" wallet → when it was seen (authorize before the user's next order; read-only queries don't re-ask the exchange within 60 seconds) */
const agentMissing = new WeakMap<Account, number>()
const AGENT_MISSING_RECHECK_MS = 60_000

/**
 * Trading calls: when unauthorized or expired, automatically top up one authorization and retry.
 * read = the page's periodic read-only queries (account, open orders, fills, leverage brackets). On web (extension wallet), read-only queries hitting "unauthorized" don't auto-authorize:
 * authorizing needs the main wallet's signature = an extension popup, and the page refreshes every 8 seconds so it would pop every 8 seconds (2026-09-29 goat verified). Throws NO_AGENT; the page shows "not enabled yet"
 * and waits for the user's first order (a user action) to authorize. The phone app signs without popups, so it still auto-tops-up as before.
 */
async function call(account: Account, method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, unknown> = {}, read = false) {
  const plugin = isPluginAccount(account)
  // Web read-only queries: handled by the extension — it signs itself and requests the exchange itself; signatures are never handed to the web page (2026-09-29 review, see lib/asterPerpRead.ts)
  if (plugin && read) return pluginRead(account, path, params)
  const agent = await agentFor(account)
  // Web: the background read-only query already knows it's unauthorized — this write op (the user's order) authorizes first, then signs the order.
  // Otherwise one order pops three windows: "perp order" first, then the exchange says not authorized, then the auth prompt, then "perp order" again
  if (plugin && !read && agentMissing.has(account)) {
    await ensureAgent(account, agent.address)
    agentMissing.delete(account)
    await new Promise((r) => setTimeout(r, 700))
  }
  try {
    const r = await signedRequest(agent, account.address, method, path, params)
    agentMissing.delete(account)
    return r
  } catch (e) {
    // NO_AGENT: not authorized / expired; FEE_REAUTH: the authorized platform-fee cap is below what's now charged. Both are fixed by the main wallet re-signing one authorization
    const reauth = (x: unknown) => x instanceof Error && (x.message === 'NO_AGENT' || x.message === 'FEE_REAUTH')
    if (!reauth(e)) throw e
    await ensureAgent(account, agent.address)
    // In the second or two after authorization takes effect, the exchange's endpoints are out of sync (measured: account already 200 while fills still report No agent found) — back off and retry a few times
    for (let i = 0; ; i++) {
      await new Promise((r) => setTimeout(r, 700 * (i + 1)))
      try { return await signedRequest(agent, account.address, method, path, params) }
      catch (e2) {
        if (!reauth(e2)) throw e2
        if (i >= 3) throw e2 instanceof Error && e2.message === 'FEE_REAUTH' ? new Error(t('平台费授权更新失败，请稍后再试')) : e2
      }
    }
  }
}

/**
 * Web (extension wallet) read-only queries: only the interfaces and params whitelisted in lib/asterPerpRead.ts are handed to the extension's perpRead.
 * Hitting "unauthorized" doesn't auto-authorize (authorizing needs the main wallet's signature = an extension popup, and the page refreshes every 8 seconds), so it throws NO_AGENT
 * and the page shows "not enabled yet"; if it was confirmed unauthorized within the last minute, don't ask the exchange every 8 seconds (same answer, plus a screenful of 400s)
 */
async function pluginRead(account: Account, path: string, params: Record<string, unknown>) {
  const q = perpReadQuery(perpReadEndpointOf(path), params)
  const read = (account as Account & { ox4PerpRead?: PerpReadFn }).ox4PerpRead
  if (typeof read !== 'function') throw new Error(t('请更新 0x4 浏览器插件后再试'))
  if (Date.now() - (agentMissing.get(account) ?? -Infinity) < AGENT_MISSING_RECHECK_MS) throw new Error('NO_AGENT')
  try {
    const r = await read(q.endpoint, q.params)
    const body = checked(r.status >= 200 && r.status < 300, r.body, typeof r.body === 'string' ? r.body : JSON.stringify(r.body))
    agentMissing.delete(account)
    return body
  } catch (e) {
    if (e instanceof Error && (e.message === 'NO_AGENT' || e.message === 'FEE_REAUTH')) { agentMissing.set(account, Date.now()); throw new Error('NO_AGENT') }
    throw e
  }
}

/**
 * Web (extension wallet) contract writes: every action in one user operation (change leverage, change margin mode, main order, TP/SL) goes to the extension's perpWrite in one batch;
 * the extension checks a whitelist, signs itself, and requests the exchange itself — at most one confirmation popup; with web quick-trade on and within limits, no popup (2026-09-30 goat).
 * No authorized trading key (NO_AGENT) or platform-fee cap needs updating (FEE_REAUTH): the main wallet authorizes once, then the whole batch is resent.
 * The batch is only resent when no order has succeeded yet (resending leverage/margin-mode changes is idempotent) — never double-orders.
 * Returns each action's result (order: leverage -> margin mode -> main order -> TP/SL); the caller decides how to report failures
 */
type PerpWriteFn = (actions: PerpWriteAction[]) => Promise<{ results: PerpWriteResult[] }>
async function pluginWrite(account: Account, actions: PerpWriteAction[]): Promise<PerpWriteResult[]> {
  const write = (account as Account & { ox4PerpWrite?: PerpWriteFn }).ox4PerpWrite
  if (typeof write !== 'function') throw new Error(t('请更新 0x4 浏览器插件后再试'))
  perpWriteBatch(actions)   // Before the web page sends, verify against the same whitelist once — bad formats error here instead of bothering the extension
  const agent = await agentFor(account)
  // The background read-only query already knows it's unauthorized: authorize before ordering — avoids popping the order window, getting "unauthorized" from the exchange, popping auth, then popping the order window again
  if (agentMissing.has(account)) {
    await ensureAgent(account, agent.address)
    agentMissing.delete(account)
    await new Promise((r) => setTimeout(r, 700))
  }
  const failMsg = (r: PerpWriteResult) => 'status' in r && !perpWriteOk(r, r.status, r.body) ? friendly(messageOf(r.body)) : null
  const needAuth = (rs: PerpWriteResult[]) => rs.some((r) => { const m = failMsg(r); return m === 'NO_AGENT' || m === 'FEE_REAUTH' })
    && !rs.some((r) => r.action === 'order' && 'status' in r && perpWriteOk(r, r.status, r.body))
  let results = (await write(actions)).results
  if (!needAuth(results)) { agentMissing.delete(account); return results }
  await ensureAgent(account, agent.address)
  // In the second or two after authorization takes effect, the exchange's endpoints are out of sync — back off and retry a few times (same as call())
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 700 * (i + 1)))
    results = (await write(actions)).results
    if (!needAuth(results)) { agentMissing.delete(account); return results }
  }
  const fee = results.some((r) => failMsg(r) === 'FEE_REAUTH')
  throw new Error(fee ? t('平台费授权更新失败，请稍后再试') : 'NO_AGENT')
}
/** The original error text in the exchange's response */
function messageOf(body: unknown): string {
  if (body && typeof body === 'object') return String((body as { msg?: string; error?: string }).msg || (body as { error?: string }).error || JSON.stringify(body))
  return String(body ?? '')
}
/** When an action fails, rethrow with the exchange's original message (rendered as a Chinese hint); actions that never ran (earlier failure) are left alone */
function throwIfFailed(r: PerpWriteResult | undefined) {
  if (!r || !('status' in r) || perpWriteOk(r, r.status, r.body)) return
  checked(false, r.body, messageOf(r.body))
}
const isPluginWriter = (account: Account) => typeof (account as Account & { ox4PerpWrite?: unknown }).ox4PerpWrite === 'function'
/** Change-leverage / change-margin-mode actions (same value set as setLeverage) */
function settingsActions(market: PerpMarket, leverage: number, isCross: boolean): PerpWriteAction[] {
  return [
    { action: 'leverage', params: { symbol: market.symbol, leverage: String(Math.max(1, Math.min(market.maxLeverage, Math.round(leverage)))) } },
    { action: 'marginType', params: { symbol: market.symbol, marginType: isCross ? 'CROSSED' : 'ISOLATED' } },
  ]
}

// ---------- Market data (public) ----------
interface ExSymbol { symbol: string; status: string; baseAsset: string; quoteAsset: string; marginAsset: string; pricePrecision: number; quantityPrecision: number }
let exInfo: { at: number; list: ExSymbol[] } | null = null
async function exchangeInfo(): Promise<ExSymbol[]> {
  if (exInfo && Date.now() - exInfo.at < 600_000) return exInfo.list
  const d = await readJson(await fetch(`${HOST}/fapi/v3/exchangeInfo`)) as { symbols: ExSymbol[] }
  exInfo = { at: Date.now(), list: d.symbols.filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT' && s.marginAsset === 'USDT') }
  return exInfo.list
}
/** All USDT perps + 24h market data + mark price / funding, sorted by volume. The public API doesn't give max leverage — estimate 100x for majors / 20x for the rest for now; the exchange validates against the real cap at order time */
// maxLeverage here is only a pre-wallet estimate; once the wallet connects, the Perp page overwrites it with loadLeverageBrackets' real brackets (325 of 701 contracts cap at 5x)
export async function loadMarkets(): Promise<PerpMarket[]> {
  const [syms, tickers, premiums] = await Promise.all([
    exchangeInfo(),
    readJson(await fetch(`${HOST}/fapi/v3/ticker/24hr`)) as Promise<{ symbol: string; lastPrice: string; priceChangePercent: string; quoteVolume: string; openPrice: string }[]>,
    readJson(await fetch(`${HOST}/fapi/v3/premiumIndex`)) as Promise<{ symbol: string; markPrice: string; lastFundingRate: string }[]>,
  ])
  const t = new Map(tickers.map((x) => [x.symbol, x])), p = new Map(premiums.map((x) => [x.symbol, x]))
  const out: PerpMarket[] = []
  syms.forEach((s, i) => {
    const tk = t.get(s.symbol), pm = p.get(s.symbol)
    if (!tk) return
    const mark = num(pm?.markPrice) || num(tk.lastPrice), prev = num(tk.openPrice)
    const coin = s.baseAsset
    out.push({ index: i, coin, symbol: s.symbol, szDecimals: s.quantityPrecision, pxDecimals: s.pricePrecision, maxLeverage: ['BTC', 'ETH', 'BNB'].includes(coin) ? 200 : ['SOL', 'XRP'].includes(coin) ? 100 : ['DOGE'].includes(coin) ? 75 : 5, markPx: mark, prevDayPx: prev, change24h: prev ? (mark - prev) / prev : num(tk.priceChangePercent) / 100, funding: num(pm?.lastFundingRate), volume24h: num(tk.quoteVolume), openInterest: 0, onlyIsolated: false })
  })
  return out.sort((a, b) => b.volume24h - a.volume24h)
}
export async function loadCandles(coin: string, interval: Interval, bars = 300): Promise<Candle[]> {
  const raw = await readJson(await fetch(`${HOST}/fapi/v3/klines?symbol=${symbolOf(coin)}&interval=${interval}&limit=${Math.min(1500, bars)}`)) as (string | number)[][]
  // Item 7 = volume, item 10 = aggressive-buy volume; the old format lacks both — omit them (never fake with 0)
  const opt = (v: string | number | undefined) => v === undefined || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v)
  return raw.map((k) => ({ time: Math.floor(num(k[0]) / 1000), open: num(k[1]), high: num(k[2]), low: num(k[3]), close: num(k[4]), volume: num(k[5]), quoteVolume: opt(k[7]), buyQuote: opt(k[10]) }))
}

// ---------- Account (agent-signed) ----------
export async function loadAccount(account: Account): Promise<PerpAccount> {
  const a = await call(account, 'GET', '/fapi/v3/account', {}, true) as { totalMarginBalance: string; totalWalletBalance: string; availableBalance: string; maxWithdrawAmount: string; totalInitialMargin: string; positions: { symbol: string; positionAmt: string; entryPrice: string; leverage: string; liquidationPrice: string; markPrice?: string; unRealizedProfit: string; marginType?: string; isolated?: boolean; isolatedMargin?: string; positionInitialMargin?: string }[] }
  const positions: PerpPosition[] = (a.positions || []).filter((p) => num(p.positionAmt) !== 0).map((p) => {
    const amt = num(p.positionAmt), size = Math.abs(amt), mark = num(p.markPrice) || num(p.entryPrice), lev = num(p.leverage) || 1
    const value = size * mark, margin = num(p.positionInitialMargin) || num(p.isolatedMargin) || value / lev, upnl = num(p.unRealizedProfit)
    const isCross = p.isolated === false || String(p.marginType || '').toLowerCase() === 'cross' || String(p.marginType || '').toUpperCase() === 'CROSSED'
    return { coin: coinOf(p.symbol), size, isLong: amt > 0, entryPx: num(p.entryPrice), positionValue: value, unrealizedPnl: upnl, roe: margin ? upnl / margin : 0, liquidationPx: num(p.liquidationPrice) || null, marginUsed: margin, leverage: lev, isCross }
  })
  return { accountValue: num(a.totalMarginBalance), withdrawable: num(a.maxWithdrawAmount) || num(a.availableBalance), marginUsed: num(a.totalInitialMargin), positions }
}
export async function loadOpenOrders(account: Account): Promise<PerpOrder[]> {
  const list = await call(account, 'GET', '/fapi/v3/openOrders', {}, true) as { orderId: number; symbol: string; side: string; price: string; stopPrice: string; origQty: string; time: number; reduceOnly: boolean; type: string }[]
  return list.map((o) => ({ oid: o.orderId, coin: coinOf(o.symbol), isBuy: o.side === 'BUY', limitPx: num(o.price) || num(o.stopPrice), size: num(o.origQty), timestamp: o.time, reduceOnly: o.reduceOnly, trigger: o.type === 'LIMIT' ? 'Limit' : o.type }))
}
export async function loadFills(account: Account, limit = 30): Promise<PerpFill[]> {
  const list = await call(account, 'GET', '/fapi/v3/userTrades', { limit }, true) as { id: number; symbol: string; side: string; price: string; qty: string; time: number; realizedPnl: string; commission: string }[]
  return list.sort((a, b) => b.time - a.time).slice(0, limit).map((f) => {
    const pnl = num(f.realizedPnl), buy = f.side === 'BUY'
    return { coin: coinOf(f.symbol), px: num(f.price), sz: num(f.qty), isBuy: buy, time: f.time, dir: pnl !== 0 ? (buy ? t('平空') : t('平多')) : (buy ? t('开多') : t('开空')), closedPnl: pnl, fee: num(f.commission), hash: String(f.id) }
  })
}

// ---------- Trading ----------
export function roundSz(sz: number, szDecimals: number): string { const f = 10 ** szDecimals; return (Math.floor(sz * f + 1e-9) / f).toFixed(szDecimals) }
export function roundPx(px: number, pxDecimals: number): string { return px.toFixed(pxDecimals) }
/** Each contract's real max leverage from the exchange (by notional bracket — the smallest bracket, i.e. the highest number). Requires signing, so it's only available with a wallet connected; otherwise keep loadMarkets' estimate */
let bracketCache: Record<string, number> | null = null
export async function loadLeverageBrackets(account: Account): Promise<Record<string, number>> {
  if (bracketCache) return bracketCache
  const r = await call(account, 'GET', '/fapi/v3/leverageBracket', {}, true) as { symbol: string; brackets: { initialLeverage: number }[] }[]
  const out: Record<string, number> = {}
  for (const s of Array.isArray(r) ? r : []) { const m = Math.max(0, ...(s.brackets || []).map((b) => Number(b.initialLeverage) || 0)); if (m) out[coinOf(s.symbol)] = m }
  if (Object.keys(out).length) bracketCache = out
  return out
}
export async function setLeverage(account: Account, market: PerpMarket, leverage: number, isCross: boolean): Promise<void> {
  // Web (extension wallet): both actions go to the extension together (at most one confirmation window); a margin mode of "no change" already counts as success on the extension side
  if (isPluginWriter(account)) { for (const r of await pluginWrite(account, settingsActions(market, leverage, isCross))) throwIfFailed(r); return }
  await call(account, 'POST', '/fapi/v3/leverage', { symbol: market.symbol, leverage: Math.max(1, Math.min(market.maxLeverage, Math.round(leverage))) })
  try { await call(account, 'POST', '/fapi/v3/marginType', { symbol: market.symbol, marginType: isCross ? 'CROSSED' : 'ISOLATED' }) }
  catch (e) { if (!(e instanceof Error && e.message === 'NO_CHANGE')) throw e }
}
/**
 * leverage / isCross: set this coin's leverage and margin mode before ordering (only set when leverage is given).
 * On web (extension wallet) it goes to the extension together with the main order and TP/SL — at most one confirmation window per order; the phone app still calls setLeverage first, then orders
 */
export interface OrderInput { market: PerpMarket; isBuy: boolean; size: number; limitPx?: number; reduceOnly?: boolean; slippageBps?: number; takeProfit?: number; stopLoss?: number; leverage?: number; isCross?: boolean }
export interface OrderResult { filledSz: number; avgPx: number; resting: boolean; oid?: number; /** TP / SL orders placed after the main order that failed to place (2026-09-28 review #10: failures used to be swallowed while the UI still reported success) */ protectionFailed?: ('tp' | 'sl')[] }
interface OrderResp { orderId: number; status: string; executedQty: string; avgPrice: string; cumQuote?: string }
export async function placeOrder(account: Account, o: OrderInput): Promise<OrderResult> {
  const { market } = o
  const side = o.isBuy ? 'BUY' : 'SELL'
  const base: Record<string, unknown> = { symbol: market.symbol, side, quantity: roundSz(o.size, market.szDecimals), builder: BUILDER, feeRate: orderFeeRate }
  if (o.reduceOnly) base.reduceOnly = 'true'
  const params = o.limitPx ? { ...base, type: 'LIMIT', price: roundPx(o.limitPx, market.pxDecimals), timeInForce: 'GTC' } : { ...base, type: 'MARKET' }
  if (isPluginWriter(account)) return placeOrderViaPlugin(account, o, params)
  if (o.leverage !== undefined) await setLeverage(account, market, o.leverage, !!o.isCross)
  const r = await call(account, 'POST', '/fapi/v3/order', params) as OrderResp
  // Take-profit / stop-loss: opposite direction, market-closes the whole position on trigger; placed after the main order fills — a placement failure doesn't roll back the main order, just notifies
  const tpsl = async (type: 'TAKE_PROFIT_MARKET' | 'STOP_MARKET', px: number) => call(account, 'POST', '/fapi/v3/order', { symbol: market.symbol, side: o.isBuy ? 'SELL' : 'BUY', type, stopPrice: roundPx(px, market.pxDecimals), closePosition: 'true', builder: BUILDER, feeRate: orderFeeRate })
  const extras: { kind: 'tp' | 'sl'; p: Promise<unknown> }[] = []
  if (o.takeProfit) extras.push({ kind: 'tp', p: tpsl('TAKE_PROFIT_MARKET', o.takeProfit) })
  if (o.stopLoss) extras.push({ kind: 'sl', p: tpsl('STOP_MARKET', o.stopLoss) })
  const settled = extras.length ? await Promise.allSettled(extras.map((x) => x.p)) : []
  const protectionFailed = extras.filter((_, i) => settled[i].status === 'rejected').map((x) => x.kind)
  return orderResult(r, protectionFailed)
}
function orderResult(r: OrderResp, protectionFailed: ('tp' | 'sl')[]): OrderResult {
  const filled = num(r.executedQty)
  if (r.status === 'FILLED' || (filled > 0 && r.status === 'PARTIALLY_FILLED')) return { filledSz: filled, avgPx: num(r.avgPrice) || (num(r.cumQuote) / (filled || 1)), resting: false, oid: r.orderId, protectionFailed }
  return { filledSz: 0, avgPx: 0, resting: true, oid: r.orderId, protectionFailed }
}
/**
 * Web (extension wallet) ordering: leverage change, margin-mode change, main order, TP, SL go to the extension in one shot (lib/asterPerpWrite.ts) — at most one confirmation window.
 * The extension executes in order; if an earlier step fails, later ones aren't sent; after the main order fills, TP and SL are placed independently — a failed one is still reported to the UI as before
 */
async function placeOrderViaPlugin(account: Account, o: OrderInput, main: Record<string, unknown>): Promise<OrderResult> {
  const { market } = o
  const str = (p: Record<string, unknown>) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)]))
  const protect = (type: 'TAKE_PROFIT_MARKET' | 'STOP_MARKET', px: number): PerpWriteAction => ({ action: 'order', params: { symbol: market.symbol, side: o.isBuy ? 'SELL' : 'BUY', type, stopPrice: roundPx(px, market.pxDecimals), closePosition: 'true', builder: BUILDER, feeRate: orderFeeRate } })
  const actions: PerpWriteAction[] = [
    ...(o.leverage !== undefined ? settingsActions(market, o.leverage, !!o.isCross) : []),
    { action: 'order', params: str(main) },
    ...(o.takeProfit ? [protect('TAKE_PROFIT_MARKET', o.takeProfit)] : []),
    ...(o.stopLoss ? [protect('STOP_MARKET', o.stopLoss)] : []),
  ]
  const results = await pluginWrite(account, actions)
  const nSettings = o.leverage !== undefined ? 2 : 0
  for (let i = 0; i < nSettings; i++) throwIfFailed(results[i])
  const mainRes = results[nSettings]
  throwIfFailed(mainRes)
  if (!mainRes || !('status' in mainRes)) throw new Error(t('下单失败'))
  const kinds: ('tp' | 'sl')[] = [...(o.takeProfit ? ['tp' as const] : []), ...(o.stopLoss ? ['sl' as const] : [])]
  const protectionFailed = kinds.filter((_, i) => { const r = results[nSettings + 1 + i]; return !r || !('status' in r) || !perpWriteOk(r, r.status, r.body) })
  return orderResult(mainRes.body as OrderResp, protectionFailed)
}
export function closePosition(account: Account, market: PerpMarket, p: PerpPosition, slippageBps = 100): Promise<OrderResult> {
  return placeOrder(account, { market, isBuy: !p.isLong, size: p.size, reduceOnly: true, slippageBps })
}
export async function cancelOrder(account: Account, market: PerpMarket, oid: number): Promise<void> {
  if (isPluginWriter(account)) { throwIfFailed((await pluginWrite(account, [{ action: 'cancel', params: { symbol: market.symbol, orderId: String(oid) } }]))[0]); return }
  await call(account, 'DELETE', '/fapi/v3/order', { symbol: market.symbol, orderId: oid })
}
/**
 * Attach / change TP or SL on an existing position (2026-10-02 trading lines on the web K-line chart): after triggering, the whole position is closed at market — same order type as the TP/SL attached at order time.
 * replaceOid = the old order to replace: the exchange allows only one "close whole position" trigger order per side per direction, so cancel the old one first, then place the new one.
 * Old cancelled but new not placed: the thrown error carries protectionGone = true, and the UI must say plainly "there is no protection now".
 */
export async function setProtection(account: Account, market: PerpMarket, isLong: boolean, kind: 'tp' | 'sl', px: number, replaceOid?: number): Promise<void> {
  if (!(px > 0)) throw new Error(t('请输入价格'))
  if (replaceOid !== undefined) await cancelOrder(account, market, replaceOid)
  const params = { symbol: market.symbol, side: isLong ? 'SELL' : 'BUY', type: kind === 'tp' ? 'TAKE_PROFIT_MARKET' : 'STOP_MARKET', stopPrice: roundPx(px, market.pxDecimals), closePosition: 'true', builder: BUILDER, feeRate: orderFeeRate }
  try {
    if (isPluginWriter(account)) throwIfFailed((await pluginWrite(account, [{ action: 'order', params }]))[0])
    else await call(account, 'POST', '/fapi/v3/order', params)
  } catch (e) {
    if (replaceOid !== undefined && e && typeof e === 'object') Object.assign(e, { protectionGone: true })
    throw e
  }
}

// ---------- Deposits / withdrawals (BSC) ----------
export async function bscUsdtBalance(address: string): Promise<number> {
  try { return Number(await getEvmTokenBalance(BSC_CHAIN_ID, address, BSC_USDT)) / 1e18 } catch { return 0 }
}
/** Deposit: approve (when needed) + Treasury.deposit — two BSC transactions, gas in BNB. Arrival takes ~1–3 minutes */
export async function depositUsdt(account: Account, amount: number, onApproving?: () => void): Promise<Hex> {
  if (amount < MIN_DEPOSIT) throw new Error(t('最少存入 {n} USDT', { n: MIN_DEPOSIT }))
  const units = BigInt(Math.round(amount * 1e6)) * 10n ** 12n
  const bal = await getEvmTokenBalance(BSC_CHAIN_ID, account.address, BSC_USDT)
  if (bal < units) throw new Error(t('BNB Chain 上的 USDT 不够'))
  await ensureAllowance(account, BSC_CHAIN_ID, BSC_USDT, TREASURY, units, onApproving)
  return sendEvmTx(account, BSC_CHAIN_ID, { to: TREASURY, data: encodeFunctionData({ abi: TREASURY_ABI, functionName: 'deposit', args: [BSC_USDT as Hex, units, 1n] }) })
}
/** Withdrawal fee (estimated by the exchange at then-gas, denominated in USDT) */
export async function estimateWithdrawFee(): Promise<number> {
  try { const d = await readJson(await fetch(`${BAPI}/estimate-withdraw-fee?chainId=${BSC_CHAIN_ID}&network=EVM&currency=USDT&accountType=1`)) as { data?: { gasCost?: number } }; return num(d.data?.gasCost) || 0.2 } catch { return 0.2 }
}
/** Withdraw to the same address on BNB Chain: the main wallet signs the Action, the agent signs the request */
export async function withdrawUsdt(account: Account, amount: number): Promise<{ withdrawId?: string; hash?: string }> {
  const fee = await estimateWithdrawFee()
  if (amount <= fee) throw new Error(t('提现要大于手续费 {fee} USDT', { fee }))
  const amt = (Math.floor(amount * 100) / 100).toString(), feeStr = fee.toString(), userNonce = Date.now() * 1000
  const userSignature = await account.signTypedData!({
    domain: { name: 'Aster', version: '1', chainId: BSC_CHAIN_ID, verifyingContract: ZERO },
    types: { Action: [{ name: 'type', type: 'string' }, { name: 'destination', type: 'address' }, { name: 'destination Chain', type: 'string' }, { name: 'token', type: 'string' }, { name: 'amount', type: 'string' }, { name: 'fee', type: 'string' }, { name: 'nonce', type: 'uint256' }, { name: 'aster chain', type: 'string' }] },
    primaryType: 'Action',
    message: { type: 'Withdraw', destination: account.address, 'destination Chain': 'BSC', token: 'USDT', amount: amt, fee: feeStr, nonce: BigInt(userNonce), 'aster chain': 'Mainnet' },
  })
  return call(account, 'POST', '/fapi/v3/aster/user-withdraw', { chainId: BSC_CHAIN_ID, asset: 'USDT', amount: amt, fee: feeStr, receiver: account.address, userNonce, userSignature }) as Promise<{ withdrawId?: string; hash?: string }>
}

/** BNB balance in the wallet (minus a bit reserved for gas) */
export async function bscBnbBalance(address: string): Promise<number> {
  try { return Number(await publicClient(BSC_CHAIN_ID).getBalance({ address: address as Hex })) / 1e18 } catch { return 0 }
}
export const BNB_GAS_RESERVE = 0.003
/** Depositing with BNB: first swap BNB to USDT on BSC (LI.FI same-chain route), then deposit into the perps account once it arrives.
 *  Margin is always USDT — the user never takes the BNB collateral haircut or volatility; the cost is one swap fee (~0.1–0.3%) and one extra gas tx. */
export async function depositBnb(account: Account, bnb: number, onPhase?: (p: string) => void): Promise<Hex> {
  if (!(bnb > 0)) throw new Error(t('请输入 BNB 数量'))
  const balance = await bscBnbBalance(account.address)
  if (bnb > balance - BNB_GAS_RESERVE) throw new Error(t('最多可用 {max} BNB（要留 {reserve} BNB 付手续费）', { max: Math.max(0, balance - BNB_GAS_RESERVE).toFixed(4), reserve: BNB_GAS_RESERVE }))
  onPhase?.(t('正在获取兑换路线…'))
  const fromAmount = BigInt(Math.round(bnb * 1e6)) * 10n ** 12n
  const quote = await getLifiQuote({ fromChain: BSC_CHAIN_ID, toChain: BSC_CHAIN_ID, fromToken: NATIVE_EVM, toToken: BSC_USDT, fromAmount, fromAddress: account.address, toAddress: account.address, slippage: 0.01 })
  const expect = Number(quote.estimate.toAmountMin) / 1e18
  if (expect < MIN_DEPOSIT) throw new Error(t('按现价只能换到约 {amount} USDT，低于最少存入 {min} USDT', { amount: expect.toFixed(2), min: MIN_DEPOSIT }))
  const before = await getEvmTokenBalance(BSC_CHAIN_ID, account.address, BSC_USDT)
  onPhase?.(t('第 1 步：BNB 换成 USDT（钱包签名）'))
  await executeLifiStep(quote, { solana: null, evm: account, solanaRpc: '' }, (ph) => onPhase?.(ph === 'signing' ? t('第 1 步：BNB 换成 USDT（钱包签名）') : ph === 'sent' ? t('兑换已上链，等待到账…') : t('第 1 步：授权')))
  // Same-chain swaps already waited for the receipt via sendEvmTx; then confirm the balance actually arrived and deposit the actual received amount (not the quoted amount, avoiding off-by-a-dust failures)
  let after = before
  for (let i = 0; i < 10 && after <= before; i++) { await new Promise((r) => setTimeout(r, 1500)); after = await getEvmTokenBalance(BSC_CHAIN_ID, account.address, BSC_USDT) }
  const got = after - before
  if (got <= 0n) throw new Error(t('兑换已提交，USDT 还没到账。请一分钟后查看余额，再选择「USDT」存入。'))
  onPhase?.(t('第 2 步：存入合约账户（钱包签名）'))
  await ensureAllowance(account, BSC_CHAIN_ID, BSC_USDT, TREASURY, got, () => onPhase?.(t('第 2 步：授权 USDT（钱包签名）')))
  return sendEvmTx(account, BSC_CHAIN_ID, { to: TREASURY, data: encodeFunctionData({ abi: TREASURY_ABI, functionName: 'deposit', args: [BSC_USDT as Hex, got, 1n] }) })
}
