// Shared definition of the energy-tip ticket (EIP-712 Tip): web builds the ticket and the 0x4 Wallet extension verifies it against this same copy.
// Must stay verbatim-identical with the contract contracts/gift-energy (Tip struct) and the server server/src/giftEnergyCheck.ts (EIP712_TYPES) — changing one side means changing all three.
import type { Hex } from 'viem'

export const GIFT_EIP712_NAME = '0x4 Gift Energy'
export const GIFT_EIP712_VERSION = '1'
/** 1 energy = 1 USDT (18 decimals) */
export const ENERGY = 10n ** 18n
/** v1 has only the 0x4 platform */
export const GIFT_PLATFORM_ID = 1n
/** Platform cut hard cap 50% (hardcoded in the contract) */
export const GIFT_MAX_FEE_BPS = 5000
/** The ticket's furthest expiry (the server won't accept beyond 30 days either) */
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

/** Build a ticket to sign (for signTypedData; numbers as strings — safe across processes and JSON) */
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
 * Strictly parse a tip-signature request (for the extension): the shape must match TIP_TYPES exactly (fields, order, types); the domain is only name / version / chainId / verifyingContract,
 * name and version must match; user must be me; platform id 1; the streamer is neither me nor 0; the total is a positive integer amount of energy; the ratio <= 50%; expiry within [now, now + 30 days].
 * Any mismatch returns null (the extension rejects as "unsupported signature" without a popup).
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
  // Types: only Tip is allowed (may carry an EIP712Domain matching the domain); Tip fields must match one by one
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
