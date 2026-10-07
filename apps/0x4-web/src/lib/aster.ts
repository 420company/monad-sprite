// BSC 原生永续合约（Aster）：用户全程只用 BNB 当 gas。
// 结构和之前的合约层一致：行情 / 账户 / 下单 / 杠杆 / 撤单 / 存入 / 提出 / 授权。
// 鉴权模型（2026-09-18 用官方 demo 与真实接口核过）：
//  - 交易类请求必须由「已授权的 agent」签（主钱包直签会报 No agent found）。手动交易的 agent 从主钱包
//    对一条固定消息的确定性签名派生出来，不落地、不显示，解锁后可重算；第一次用或过期时自动用主钱包签一次 approveAgent。
//  - 管理类（approveAgent）：主钱包签 EIP-712，domain AsterSignTransaction chainId 56，字段首字母大写。
//  - 交易类：agent 签 EIP-712 Message{msg = 最终 querystring}，domain chainId 1666。
//  - 提现：主钱包签 Action（domain Aster chainId 56），再连同 agent 签名一起 POST。
//  - 存入：链上调 Treasury.deposit(USDT, amount, broker=1)，gas 用 BNB。
// Builder（Aster Code）：下单带 builder + feeRate，我们收成交额的 0.06%（2026-09-25 从 0.05% 调到 0.06%，吃单合计凑整 0.1%）。
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

/** 交易所接口地址。导出给 lib/asterBook.ts（网页版合约终端的盘口 / 最新成交，公开行情，不用签名） */
export const HOST = 'https://fapi.asterdex.com'
const BAPI = 'https://www.asterdex.com/bapi/futures/v1/public/future/aster'
export const BSC_CHAIN_ID = 56
export const BSC_USDT = '0x55d398326f99059fF775485246999027B3197955' // BSC 上的 USDT 是 18 位小数
export const TREASURY = '0x128463A60784c4D3f46c23Af3f65Ed859Ba87974'
/** 收费地址和费率上限写在 lib/asterPerpWrite.ts（插件也按它核对网页的下单），这里导出同一个值 */
export const BUILDER = PERP_BUILDER
// 用户批准的费率上限 = 我们实际收的：成交额的 0.06%。交易所允许的上限是 0.1%。
// ⚠️ 调高后，老用户授权里签的上限还是旧值，下单会被拒 → call() 里识别出来自动重新授权一次（见 FEE_REAUTH）。
//    果蝇自动交易（fly/stonkfly/aster.py）仍是 0.0005：它的授权服务器替用户重签不了，要调得让用户在 App 里重新授权。
export const BUILDER_FEE = PERP_BUILDER_FEE
/**
 * 实际下单收的 builder 费（2026-09-27）：普通 0.06% / VIP 0.04%，由服务器按是否 VIP 下发（lib/fees.ts 拉到后调 setPerpFeeRate）。
 * 授权时签的上限仍是 BUILDER_FEE，VIP 调低不用重签；超过上限的值一律不用（交易所会拒单）
 */
let orderFeeRate = BUILDER_FEE
export function setPerpFeeRate(rate: number) {
  orderFeeRate = rate >= 0 && rate <= Number(BUILDER_FEE) ? String(Number(rate.toFixed(6))) : BUILDER_FEE
}
export const perpFeeRate = () => Number(orderFeeRate)
export const MIN_DEPOSIT = 5
export const MIN_NOTIONAL = 5 // 交易所最小名义
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
export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; /** 成交额（美元）和其中主动买入的部分：合约 K 线才有，「买卖力量」用（lib/perpFlow.ts） */ quoteVolume?: number; buyQuote?: number }

const num = (s: string | number | null | undefined) => { const n = Number(s); return Number.isFinite(n) ? n : 0 }
export const symbolOf = (coin: string) => `${coin.toUpperCase()}USDT`
export const coinOf = (symbol: string) => symbol.replace(/USDT$/, '')

// ---------- nonce / 签名 ----------
let lastSec = 0, seq = 0
/** 官方约定：秒 × 1e6 + 同秒内递增，保证单调 */
function nonce(): number { const s = Math.floor(Date.now() / 1000); if (s === lastSec) seq++; else { lastSec = s; seq = 0 } return s * 1_000_000 + seq }
const qsOf = (p: Record<string, unknown>) => new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)])).toString()

async function readJson(r: Response) {
  const text = await r.text()
  let body: unknown = text
  try { body = JSON.parse(text) } catch { /* 非 JSON */ }
  return checked(r.ok, body, text)
}
/** 交易所回的结果：HTTP 失败或 code < 0 按错误抛（插件代办的只读查询回来的状态码和 JSON 也走这里） */
function checked(ok: boolean, body: unknown, text: string) {
  if (!ok || (body && typeof body === 'object' && 'code' in body && Number((body as { code: number }).code) < 0)) {
    const msg = body && typeof body === 'object' ? String((body as { msg?: string; error?: string }).msg || (body as { error?: string }).error || text) : text
    throw Object.assign(new Error(friendly(msg)), { aster: body })
  }
  return body
}
function friendly(msg: string): string {
  if (/No agent found/i.test(msg)) return 'NO_AGENT'
  // 下单费率超过用户授权时签的上限（平台费调高过）：要重新授权。交易所原话没有公开文档，按关键词宽松识别
  if (/fee ?rate|maxFeeRate|builder fee/i.test(msg)) return 'FEE_REAUTH'
  if (/Margin is insufficient/i.test(msg)) return t('保证金不足')
  if (/ReduceOnly Order is rejected/i.test(msg)) return t('没有可减的仓位')
  if (/notional|MIN_NOTIONAL/i.test(msg)) return t('订单金额低于交易所最小值 ${n}', { n: MIN_NOTIONAL })
  if (/precision|LOT_SIZE|PRICE_FILTER/i.test(msg)) return t('数量或价格精度不对')
  if (/No need to change/i.test(msg)) return 'NO_CHANGE'
  return msg
}

/** 主钱包签管理类请求（approveAgent 等）：字段首字母大写，类型按值推断，末尾固定 AsterChain / User / Nonce */
async function signMain(account: Account, primaryType: string, params: Record<string, string | number | boolean>) {
  const full: Record<string, string | number | boolean> = { ...params, asterChain: 'Mainnet', user: account.address, nonce: nonce() }
  const types = { [primaryType]: Object.entries(full).map(([k, v]) => ({ name: k[0].toUpperCase() + k.slice(1), type: typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? 'uint256' : 'string' })) }
  const message = Object.fromEntries(Object.entries(full).map(([k, v]) => [k[0].toUpperCase() + k.slice(1), typeof v === 'number' ? String(v) : v]))
  const signature = await account.signTypedData!({ domain: DOMAIN_MAIN, types, primaryType, message })
  return { ...full, signature, signatureChainId: 56 }
}

/** agent 签交易类请求：msg = 最终 querystring（不含 signature） */
async function signedRequest(agent: PerpAgent, user: string, method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, unknown> = {}) {
  const full = { ...params, asterChain: 'Mainnet', user, signer: agent.address, nonce: nonce() }
  const qs = qsOf(full)
  const signature = await agent.signTypedData({ domain: DOMAIN_AGENT, types: { Message: [{ name: 'msg', type: 'string' }] }, primaryType: 'Message', message: { msg: qs } })
  return readJson(await fetch(`${HOST}${path}?${qs}&signature=${signature}`, { method }))
}

// ---------- agent：手动交易用，从主钱包派生 ----------
/** 代理密钥只需要「地址」和「签结构化数据」两件事 */
export interface PerpAgent {
  address: Hex
  signTypedData(td: { domain: typeof DOMAIN_AGENT; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown> }): Promise<Hex>
}

let agentCache = new WeakMap<Account, PerpAgent>()
// 钱包一锁就扔掉代理密钥：网页层算出来的那把在内存里，不扔的话锁着也能继续下单
onLock(() => { agentCache = new WeakMap() })

/**
 * 对固定消息签名 → keccak → 私钥。签名是确定性的（RFC6979），同一个钱包每次算出同一把；不存任何地方。
 * App 里整个推导与签名都在原生模块内完成，网页层只拿得到代理地址（原生与网页版算出的是同一把，有对拍测试）。
 */
export async function agentFor(account: Account): Promise<PerpAgent> {
  let a = agentCache.get(account)
  if (a) return a
  // 网页版连的 0x4 浏览器插件：交易密钥在插件里派生，私钥不出插件；插件也不签「0x4 perp agent v2」原始消息（lib/vault/extension.ts）
  const ox4Agent = (account as Account & { ox4Agent?: () => Promise<PerpAgent> }).ox4Agent
  if (ox4Agent) {
    a = await ox4Agent()
  } else if (nativeVault) {
    // 原生锁定后代理密钥也跟着清，要先解锁（锁着就弹验证）
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
/** 主钱包签一次，把 agent 登记到交易所（只能开合约，不能提币，180 天有效），同时批准我们的 builder 费 */
export async function approveAgentAddress(account: Account, agentAddress: string, agentName: string): Promise<void> {
  const body = await signMain(account, 'ApproveAgent', { agentName: agentName.slice(0, 20), agentAddress, ipWhitelist: '', expired: Date.now() + AGENT_TTL_MS, canSpotTrade: false, canPerpTrade: true, canWithdraw: false, builder: BUILDER, maxFeeRate: BUILDER_FEE, builderName: '0x4' })
  await readJson(await fetch(`${HOST}/fapi/v3/approveAgent`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: qsOf(body) }))
}
/** 给果蝇用：新生成一把随机 agent，授权后把私钥交给调用方（加密存服务端），本函数不保存 */
export async function approveAgent(account: Account, agentName: string): Promise<{ agentKey: Hex; agentAddress: string }> {
  const agentKey = generatePrivateKey()
  const agentAddress = privateKeyToAccount(agentKey).address
  await approveAgentAddress(account, agentAddress, agentName)
  return { agentKey, agentAddress }
}
/**
 * 手动合约计入 VIP 交易额（2026-09-27）：给服务器授权一把「只读」代理 —— 交易、提币权限全关，只能查这个账户的成交记录。
 * 服务器生成这把代理、私钥加密保存；主钱包签一次授权，服务器向交易所确认权限确实只有「读」才启用。
 * 每个钱包每次打开 App 最多试一次，失败不影响交易。
 */
const readerTried = new WeakSet<Account>()
export async function linkPerpReader(account: Account): Promise<void> {
  if (readerTried.has(account)) return
  readerTried.add(account)
  // 网页版（插件钱包）：这一步要主钱包签名 = 插件弹「结构化签名」窗口，而它是后台自己发起的，不是用户操作（2026-09-29 goat 实测合约页一开就弹）。
  // 网页版先不自动授权；手机 App 里签名不弹窗，照旧
  if (isPluginAccount(account)) return
  try {
    const r = await api<{ agentAddress: string; approved: boolean }>('/api/fees/perp-reader')
    if (r.approved) return
    const body = await signMain(account, 'ApproveAgent', { agentName: '0x4volume', agentAddress: r.agentAddress, ipWhitelist: '', expired: Date.now() + AGENT_TTL_MS, canSpotTrade: false, canPerpTrade: false, canWithdraw: false, builder: BUILDER, maxFeeRate: BUILDER_FEE, builderName: '0x4' })
    await readJson(await fetch(`${HOST}/fapi/v3/approveAgent`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: qsOf(body) }))
    await api('/api/fees/perp-reader/confirm', { method: 'POST' })
  } catch { /* 下次打开 App 再试 */ }
}

/** 同一个钱包同时只做一次授权：账户 / 挂单 / 成交三个请求并发时各自去授权会撞车（实测有的返回 400） */
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
 * 用户主动授权交易密钥（2026-10-05 goat：存了钱进合约账户，合约页一直「未授权交易密钥」、余额全是 --，只想看余额也没地方授权）。
 * 网页版的只读查询碰到没授权不自动弹窗（见 call 的说明），所以合约页给一个按钮，点了走这里：主钱包签一次，之后照常读账户
 */
export async function authorizePerpAgent(account: Account): Promise<void> {
  const agent = await agentFor(account)
  await ensureAgent(account, agent.address)
  agentMissing.delete(account)
}
/** 网页版连的 0x4 浏览器插件：主钱包每个签名都要用户在插件里确认（lib/vault/extension.ts 给账户挂了 ox4Agent） */
const isPluginAccount = (account: Account) => typeof (account as Account & { ox4Agent?: unknown }).ox4Agent === 'function'
/** 网页版插件账户的只读查询：插件代办（lib/asterPerpRead.ts），返回 HTTP 状态码和交易所的 JSON */
type PerpReadFn = (endpoint: PerpReadEndpoint, params: Record<string, string>) => Promise<{ status: number; body: unknown }>
/** 网页版：后台只读查询碰到过「没授权」的钱包 → 什么时候看到的（下一次用户下单时先授权；60 秒内只读查询不再重复问交易所） */
const agentMissing = new WeakMap<Account, number>()
const AGENT_MISSING_RECHECK_MS = 60_000

/**
 * 交易类调用：没授权或过期时自动补一次授权再重试。
 * read = 页面定时刷新的只读查询（账户、挂单、成交、杠杆分档）。网页版（插件钱包）上只读查询碰到没授权不自动去授权：
 * 授权要主钱包签名 = 插件弹窗，页面每 8 秒刷新一次就弹一次（2026-09-29 goat 实测）。抛 NO_AGENT，页面按「还没开通」显示，
 * 等用户第一次下单（用户操作）时再授权。手机 App 签名不弹窗，照旧自动补。
 */
async function call(account: Account, method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, unknown> = {}, read = false) {
  const plugin = isPluginAccount(account)
  // 网页版只读查询：交给插件代办，插件自己签名、自己请求交易所，签名不交给网页（2026-09-29 审查，见 lib/asterPerpRead.ts）
  if (plugin && read) return pluginRead(account, path, params)
  const agent = await agentFor(account)
  // 网页版：后台只读查询已经知道还没授权，这次写操作（用户下单）先授权再签单子。
  // 不然先弹一个「合约下单」、交易所回没授权、再弹授权、再弹一次「合约下单」，一次下单三个窗口
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
    // NO_AGENT：还没授权 / 过期；FEE_REAUTH：授权里的平台费上限低于现在收的。两种都是主钱包重签一次授权
    const reauth = (x: unknown) => x instanceof Error && (x.message === 'NO_AGENT' || x.message === 'FEE_REAUTH')
    if (!reauth(e)) throw e
    await ensureAgent(account, agent.address)
    // 授权刚生效的一两秒内交易所各接口不同步（实测账户已 200、成交仍报 No agent found），退避重试几次
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
 * 网页版（插件钱包）的只读查询：只认 lib/asterPerpRead.ts 白名单里的接口和参数，交给插件的 perpRead。
 * 碰到「没授权」不自动去授权（授权要主钱包签名 = 插件弹窗，页面每 8 秒刷新就弹一次），抛 NO_AGENT，
 * 页面按「还没开通」显示；一分钟内刚确认过没授权，不再每 8 秒去问交易所（结果一样，还满屏 400）
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
 * 网页版（插件钱包）的合约写操作：一次用户操作的全部动作（改杠杆、改保证金模式、主单、止盈止损）一起交给插件的 perpWrite，
 * 插件核对白名单、自己签名、自己请求交易所，最多弹一个确认窗口；开着网页快捷交易且在上限以内就不弹（2026-09-30 goat）。
 * 没授权交易密钥（NO_AGENT）或平台费上限要更新（FEE_REAUTH）：主钱包授权一次再整批重发。
 * 只在还没有任何下单成功时整批重发（改杠杆、改保证金模式重发一次结果一样），不会重复下单。
 * 返回每个动作的结果（顺序：改杠杆 → 改保证金模式 → 主单 → 止盈止损），失败的由调用方决定怎么报
 */
type PerpWriteFn = (actions: PerpWriteAction[]) => Promise<{ results: PerpWriteResult[] }>
async function pluginWrite(account: Account, actions: PerpWriteAction[]): Promise<PerpWriteResult[]> {
  const write = (account as Account & { ox4PerpWrite?: PerpWriteFn }).ox4PerpWrite
  if (typeof write !== 'function') throw new Error(t('请更新 0x4 浏览器插件后再试'))
  perpWriteBatch(actions)   // 网页发出前按同一份白名单核一遍，格式不对在这里就报错，不去打扰插件
  const agent = await agentFor(account)
  // 后台只读查询已经知道还没授权：先授权再下单，免得先弹下单窗口、交易所回没授权、再弹授权、再弹一次下单
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
  // 授权刚生效的一两秒内交易所各接口不同步，退避重试几次（和 call() 一样）
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 700 * (i + 1)))
    results = (await write(actions)).results
    if (!needAuth(results)) { agentMissing.delete(account); return results }
  }
  const fee = results.some((r) => failMsg(r) === 'FEE_REAUTH')
  throw new Error(fee ? t('平台费授权更新失败，请稍后再试') : 'NO_AGENT')
}
/** 交易所回复里的错误原文 */
function messageOf(body: unknown): string {
  if (body && typeof body === 'object') return String((body as { msg?: string; error?: string }).msg || (body as { error?: string }).error || JSON.stringify(body))
  return String(body ?? '')
}
/** 某个动作失败了就按交易所原话（换成中文提示）抛出；没执行（前面失败了）的不管 */
function throwIfFailed(r: PerpWriteResult | undefined) {
  if (!r || !('status' in r) || perpWriteOk(r, r.status, r.body)) return
  checked(false, r.body, messageOf(r.body))
}
const isPluginWriter = (account: Account) => typeof (account as Account & { ox4PerpWrite?: unknown }).ox4PerpWrite === 'function'
/** 改杠杆 / 改保证金模式的动作（和 setLeverage 同一套取值） */
function settingsActions(market: PerpMarket, leverage: number, isCross: boolean): PerpWriteAction[] {
  return [
    { action: 'leverage', params: { symbol: market.symbol, leverage: String(Math.max(1, Math.min(market.maxLeverage, Math.round(leverage)))) } },
    { action: 'marginType', params: { symbol: market.symbol, marginType: isCross ? 'CROSSED' : 'ISOLATED' } },
  ]
}

// ---------- 行情（公开） ----------
interface ExSymbol { symbol: string; status: string; baseAsset: string; quoteAsset: string; marginAsset: string; pricePrecision: number; quantityPrecision: number }
let exInfo: { at: number; list: ExSymbol[] } | null = null
async function exchangeInfo(): Promise<ExSymbol[]> {
  if (exInfo && Date.now() - exInfo.at < 600_000) return exInfo.list
  const d = await readJson(await fetch(`${HOST}/fapi/v3/exchangeInfo`)) as { symbols: ExSymbol[] }
  exInfo = { at: Date.now(), list: d.symbols.filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT' && s.marginAsset === 'USDT') }
  return exInfo.list
}
/** 全部 USDT 永续 + 24h 行情 + 标记价 / 资金费，按成交额排序。杠杆上限公开接口不给，先按主流币 100x / 其它 20x 估，页面下单时交易所会按实际上限校验 */
// maxLeverage 在这里只是未连钱包时的估计值；连上钱包后 Perp 页用 loadLeverageBrackets 的真实分档覆盖（701 个合约里 325 个只有 5x）
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
  // 第 7 项 = 成交额，第 10 项 = 主动买入的成交额；老格式没有这两项就不带（不拿 0 冒充）
  const opt = (v: string | number | undefined) => v === undefined || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v)
  return raw.map((k) => ({ time: Math.floor(num(k[0]) / 1000), open: num(k[1]), high: num(k[2]), low: num(k[3]), close: num(k[4]), volume: num(k[5]), quoteVolume: opt(k[7]), buyQuote: opt(k[10]) }))
}

// ---------- 账户（agent 签名） ----------
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

// ---------- 交易 ----------
export function roundSz(sz: number, szDecimals: number): string { const f = 10 ** szDecimals; return (Math.floor(sz * f + 1e-9) / f).toFixed(szDecimals) }
export function roundPx(px: number, pxDecimals: number): string { return px.toFixed(pxDecimals) }
/** 交易所对每个合约的真实最高杠杆（按名义分档，取最小档也就是最高的那个数）。要签名，所以只有连了钱包才拿得到；拿不到就沿用 loadMarkets 的估计值 */
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
  // 网页版（插件钱包）：两个动作一起交给插件（最多一个确认窗口）；保证金模式「不用改」插件已按成功算
  if (isPluginWriter(account)) { for (const r of await pluginWrite(account, settingsActions(market, leverage, isCross))) throwIfFailed(r); return }
  await call(account, 'POST', '/fapi/v3/leverage', { symbol: market.symbol, leverage: Math.max(1, Math.min(market.maxLeverage, Math.round(leverage))) })
  try { await call(account, 'POST', '/fapi/v3/marginType', { symbol: market.symbol, marginType: isCross ? 'CROSSED' : 'ISOLATED' }) }
  catch (e) { if (!(e instanceof Error && e.message === 'NO_CHANGE')) throw e }
}
/**
 * leverage / isCross：下单前先把这个币的杠杆和保证金模式设好（给了 leverage 才设）。
 * 网页版（插件钱包）上和主单、止盈止损一起交给插件，一次下单最多一个确认窗口；手机 App 照旧先调 setLeverage 再下单
 */
export interface OrderInput { market: PerpMarket; isBuy: boolean; size: number; limitPx?: number; reduceOnly?: boolean; slippageBps?: number; takeProfit?: number; stopLoss?: number; leverage?: number; isCross?: boolean }
export interface OrderResult { filledSz: number; avgPx: number; resting: boolean; oid?: number; /** 主单之后挂的止盈 / 止损里没挂上的（2026-09-28 审查 #10：原来失败被吞掉，界面照样报成功） */ protectionFailed?: ('tp' | 'sl')[] }
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
  // 止盈 / 止损：反向、触发后市价平掉整个仓位；主单成交后再挂，挂失败不回滚主单，只提示
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
 * 网页版（插件钱包）下单：改杠杆、改保证金模式、主单、止盈、止损一次交给插件（lib/asterPerpWrite.ts），最多一个确认窗口。
 * 插件按顺序执行，前面失败后面不发；主单成交后止盈止损各挂各的，没挂上的照旧报给界面
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
 * 给已有仓位挂 / 改止盈或止损（2026-10-02 网页版 K 线上的交易线）：触发后市价平掉整个仓位，和下单时带的止盈止损是同一种单。
 * replaceOid = 要换掉的旧单：交易所同一方向同一种「平掉整个仓位」的触发单只能有一张，所以先撤旧的、再挂新的。
 * 旧的撤了、新的没挂上：抛的错误带 protectionGone = true，界面必须明说「现在没有保护了」。
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

// ---------- 出入金（BSC） ----------
export async function bscUsdtBalance(address: string): Promise<number> {
  try { return Number(await getEvmTokenBalance(BSC_CHAIN_ID, address, BSC_USDT)) / 1e18 } catch { return 0 }
}
/** 存入：approve（必要时）+ Treasury.deposit，两笔 BSC 交易，gas 用 BNB。到账约 1–3 分钟 */
export async function depositUsdt(account: Account, amount: number, onApproving?: () => void): Promise<Hex> {
  if (amount < MIN_DEPOSIT) throw new Error(t('最少存入 {n} USDT', { n: MIN_DEPOSIT }))
  const units = BigInt(Math.round(amount * 1e6)) * 10n ** 12n
  const bal = await getEvmTokenBalance(BSC_CHAIN_ID, account.address, BSC_USDT)
  if (bal < units) throw new Error(t('BNB Chain 上的 USDT 不够'))
  await ensureAllowance(account, BSC_CHAIN_ID, BSC_USDT, TREASURY, units, onApproving)
  return sendEvmTx(account, BSC_CHAIN_ID, { to: TREASURY, data: encodeFunctionData({ abi: TREASURY_ABI, functionName: 'deposit', args: [BSC_USDT as Hex, units, 1n] }) })
}
/** 提现手续费（交易所按当时 gas 估，USDT 计） */
export async function estimateWithdrawFee(): Promise<number> {
  try { const d = await readJson(await fetch(`${BAPI}/estimate-withdraw-fee?chainId=${BSC_CHAIN_ID}&network=EVM&currency=USDT&accountType=1`)) as { data?: { gasCost?: number } }; return num(d.data?.gasCost) || 0.2 } catch { return 0.2 }
}
/** 提出到 BNB Chain 的同一个地址：主钱包签 Action，agent 签请求 */
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

/** 钱包里的 BNB 余额（减去留给 gas 的一点） */
export async function bscBnbBalance(address: string): Promise<number> {
  try { return Number(await publicClient(BSC_CHAIN_ID).getBalance({ address: address as Hex })) / 1e18 } catch { return 0 }
}
export const BNB_GAS_RESERVE = 0.003
/** 用 BNB 存入：先在 BSC 上把 BNB 闪兑成 USDT（LI.FI 同链路线），到账后再存进合约账户。
 *  保证金永远是 USDT，用户不承担 BNB 抵押的折价和波动；代价是一次兑换费（约 0.1–0.3%）和多一笔 gas。 */
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
  // 同链兑换 sendEvmTx 已等回执；再确认余额确实到了，按实际到账数存入（不按报价数，避免差一点点失败）
  let after = before
  for (let i = 0; i < 10 && after <= before; i++) { await new Promise((r) => setTimeout(r, 1500)); after = await getEvmTokenBalance(BSC_CHAIN_ID, account.address, BSC_USDT) }
  const got = after - before
  if (got <= 0n) throw new Error(t('兑换已提交，USDT 还没到账。请一分钟后查看余额，再选择「USDT」存入。'))
  onPhase?.(t('第 2 步：存入合约账户（钱包签名）'))
  await ensureAllowance(account, BSC_CHAIN_ID, BSC_USDT, TREASURY, got, () => onPhase?.(t('第 2 步：授权 USDT（钱包签名）')))
  return sendEvmTx(account, BSC_CHAIN_ID, { to: TREASURY, data: encodeFunctionData({ abi: TREASURY_ABI, functionName: 'deposit', args: [BSC_USDT as Hex, got, 1n] }) })
}
