// 能量打赏小票（EIP-712 Tip）的共享定义：网页版组小票、0x4 Wallet 插件核对小票都用这一份。
// 和合约 contracts/gift-energy（Tip 结构）、服务器 server/src/giftEnergyCheck.ts（EIP712_TYPES）逐字一致，改一边要三边一起改。
import type { Hex } from 'viem'

export const GIFT_EIP712_NAME = '0x4 Gift Energy'
export const GIFT_EIP712_VERSION = '1'
/** 1 能量 = 1 USDT（18 位小数） */
export const ENERGY = 10n ** 18n
/** 第一版只有 0x4 一个平台 */
export const GIFT_PLATFORM_ID = 1n
/** 平台抽成硬上限 50%（合约写死） */
export const GIFT_MAX_FEE_BPS = 5000
/** 小票最远截止时间（服务器也不收 30 天以后的） */
export const GIFT_MAX_DEADLINE_SEC = 30 * 86400

export const TIP_TYPES = {
  Tip: [
    { name: 'user', type: 'address' },
    { name: 'platformId', type: 'uint256' },
    { name: 'streamer', type: 'address' },
    { name: 'channel', type: 'bytes32' },
    { name: 'cumulative', type: 'uint256' },
    { name: 'feeBps', type: 'uint16' },
    { name: 'deadline', type: 'uint64' },
  ],
} as const

export interface GiftTip { user: Hex; platformId: bigint; streamer: Hex; channel: Hex; cumulative: bigint; feeBps: number; deadline: bigint }
export interface GiftDomain { name: string; version: string; chainId: number; verifyingContract: Hex }

/** 组一张要签的小票（给 signTypedData；数字用字符串，跨进程和 JSON 都安全） */
export function tipTypedData(domain: GiftDomain, tip: GiftTip) {
  return {
    domain: { name: domain.name, version: domain.version, chainId: domain.chainId, verifyingContract: domain.verifyingContract },
    types: TIP_TYPES,
    primaryType: 'Tip' as const,
    message: {
      user: tip.user, platformId: tip.platformId.toString(), streamer: tip.streamer, channel: tip.channel,
      cumulative: tip.cumulative.toString(), feeBps: tip.feeBps, deadline: tip.deadline.toString(),
    },
  }
}

const ADDR = /^0x[0-9a-fA-F]{40}$/
const B32 = /^0x[0-9a-fA-F]{64}$/
const UINT = /^\d{1,78}$/
const low = (s: string) => s.toLowerCase() as Hex

/**
 * 严格解析一张小票签名请求（插件用）：形状必须和 TIP_TYPES 一模一样（字段、顺序、类型），域只有 name / version / chainId / verifyingContract，
 * 名字版本对得上；user 必须是 me；平台编号 1；主播不是自己也不是 0；累计是正的整数能量；比例 ≤ 50%；截止时间在 [现在, 现在 + 30 天]。
 * 任何一条不对返回 null（插件按「不支持这项签名」拒，不弹窗）。
 */
export function parseGiftTip(input: unknown, me: string, nowSec: number): { domain: GiftDomain; tip: GiftTip } | null {
  let td: { domain?: Record<string, unknown>; types?: Record<string, unknown>; primaryType?: unknown; message?: Record<string, unknown> }
  try { td = (typeof input === 'string' ? JSON.parse(input) : input) as typeof td } catch { return null }
  if (!td || typeof td !== 'object' || td.primaryType !== 'Tip') return null
  const d = td.domain || {}
  if (Object.keys(d).some((k) => !['name', 'version', 'chainId', 'verifyingContract'].includes(k))) return null
  if (d.name !== GIFT_EIP712_NAME || String(d.version) !== GIFT_EIP712_VERSION) return null
  const chainId = Number(d.chainId)
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || typeof d.verifyingContract !== 'string' || !ADDR.test(d.verifyingContract)) return null
  // 类型：只能有 Tip（可以带一份和域一致的 EIP712Domain），Tip 的字段逐项一致
  const types = td.types || {}
  if (Object.keys(types).some((k) => k !== 'Tip' && k !== 'EIP712Domain')) return null
  const fields = types.Tip as { name?: unknown; type?: unknown }[] | undefined
  if (!Array.isArray(fields) || fields.length !== TIP_TYPES.Tip.length) return null
  if (fields.some((f, i) => !f || f.name !== TIP_TYPES.Tip[i].name || f.type !== TIP_TYPES.Tip[i].type || Object.keys(f).length !== 2)) return null
  if (types.EIP712Domain !== undefined) {
    const dom = types.EIP712Domain as { name?: unknown; type?: unknown }[]
    const want = [['name', 'string'], ['version', 'string'], ['chainId', 'uint256'], ['verifyingContract', 'address']]
    if (!Array.isArray(dom) || dom.length !== 4 || dom.some((f, i) => f?.name !== want[i][0] || f?.type !== want[i][1])) return null
  }
  const m = td.message || {}
  if (Object.keys(m).length !== TIP_TYPES.Tip.length) return null
  const s = (k: string) => (typeof m[k] === 'string' || typeof m[k] === 'number' || typeof m[k] === 'bigint' ? String(m[k]) : '')
  const [user, streamer, channel, platformId, cumulative, feeBps, deadline] = ['user', 'streamer', 'channel', 'platformId', 'cumulative', 'feeBps', 'deadline'].map(s)
  if (!ADDR.test(user) || !ADDR.test(streamer) || !B32.test(channel) || ![platformId, cumulative, feeBps, deadline].every((x) => UINT.test(x))) return null
  const tip: GiftTip = { user: low(user), platformId: BigInt(platformId), streamer: low(streamer), channel: low(channel), cumulative: BigInt(cumulative), feeBps: Number(feeBps), deadline: BigInt(deadline) }
  if (tip.user !== low(me)) return null
  if (tip.platformId !== GIFT_PLATFORM_ID) return null
  if (tip.streamer === tip.user || /^0x0{40}$/.test(tip.streamer) || tip.streamer === low(d.verifyingContract)) return null
  if (tip.cumulative <= 0n || tip.cumulative % ENERGY !== 0n) return null
  if (!Number.isInteger(tip.feeBps) || tip.feeBps > GIFT_MAX_FEE_BPS) return null
  if (tip.deadline < BigInt(nowSec) || tip.deadline > BigInt(nowSec + GIFT_MAX_DEADLINE_SEC)) return null
  return { domain: { name: GIFT_EIP712_NAME, version: GIFT_EIP712_VERSION, chainId, verifyingContract: low(d.verifyingContract) }, tip }
}
