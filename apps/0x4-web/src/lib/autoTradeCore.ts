// Sprite spot autopilot (plan B): delegation generation and signing format (pure computation, no dependency on other app modules; the server integration script uses it directly too, keeping both sides identical)
import { encodeAbiParameters, encodePacked, hashTypedData, toFunctionSelector, type Account, type Hex } from 'viem'

/** On-chain addresses: MetaMask Delegation Framework v1.3.0 (CREATE2, same address on every chain, verified on-chain 2026-09-27); AutoTrader is pushed by the server (only exists after deployment) */
export const DF = {
  delegationManager: '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3',
  stateless7702: '0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B',
  erc20Period: '0x474e3Ae7E169e940607cC624Da8A15Eb120139aB',
  nativePeriod: '0x9BC0FAf4Aca5AE429F4c06aEEaC517520CB16BD9',
  allowedCalldata: '0xc2b0d624c1c4319760C96503BA27C347F3260f55',
  allowedMethods: '0x2c21fD0Cb9DC8445CB3fb0DC5E7Bb0Aca01842B5',
  allowedTargets: '0x7F20f61b1f09b08D970938F6fa563634d65c4EeB',
  exactCalldata: '0x99F2e9bF15ce5eC84685604836F71aB835DBBdED',
  timestamp: '0x1046bb45C8d673d4ea75321280DB34899413c069',
  valueLte: '0x92Bf12322527cAA612fd31a0e810472BBB106A8F',
} as const
/**
 * AutoTrader canonical address (BSC): deployed via a generic deterministic deployment factory (CREATE2); the address is uniquely determined by "contract code + constructor args (guardian, operator, USDT-only) + salt",
 * see contracts/auto-trade/script/deploy.sh. Hardcoded in the app; a server-pushed address that doesn't match is refused (GPT-6 review #2: the backend providing the trading service must not decide who gets approved).
 * If the contract code or constructor args change, replace this with the new address computed by deploy.sh address
 */
export const TRADER_BSC = '0xF7475059DF8d83DeA9a236f6e808A9e3e92B8673' as const
export const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955' as const
export const TRADER_ABI = [
  { type: 'function', name: 'epoch', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'revokeAll', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'held', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

const ROOT_AUTHORITY = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' as Hex
const DAY = 86400

export interface Caveat { enforcer: Hex; terms: Hex; args: Hex }
export interface Delegation { delegate: Hex; delegator: Hex; authority: Hex; caveats: Caveat[]; salt: bigint; signature: Hex }
/** Initially USDT payments only (single quota, GPT-6 review #3); no more signing BNB buy orders */
export type DelegationKind = 'buyErc20' | 'sell'

const cav = (enforcer: string, terms: Hex): Caveat => ({ enforcer: enforcer as Hex, terms, args: '0x' })
const expiry = (until: number) => cav(DF.timestamp, encodePacked(['uint128', 'uint128'], [0n, BigInt(until)]))
const toTrader = (trader: Hex) => cav(DF.allowedCalldata, encodePacked(['uint256', 'bytes'], [4n, encodeAbiParameters([{ type: 'address' }], [trader])]))

/** Two delegations (unsigned). payPerDay is in the smallest unit; start / until are seconds; salt = the user's current authorization version (epoch) in the contract (the contract only honors the current version) */
export function buildDelegations(o: { user: Hex; trader: Hex; payToken: Hex; payPerDay: bigint; start: number; until: number; salt: bigint }): Record<DelegationKind, Delegation> {
  const base = (caveats: Caveat[], salt: bigint): Delegation => ({ delegate: o.trader, delegator: o.user, authority: ROOT_AUTHORITY, caveats, salt, signature: '0x' })
  return {
    buyErc20: base([
      cav(DF.erc20Period, encodePacked(['address', 'uint256', 'uint256', 'uint256'], [o.payToken, o.payPerDay, BigInt(DAY), BigInt(o.start)])),
      toTrader(o.trader), expiry(o.until),
    ], o.salt),
    sell: base([
      cav(DF.allowedMethods, toFunctionSelector('transfer(address,uint256)')),
      toTrader(o.trader),
      cav(DF.valueLte, encodeAbiParameters([{ type: 'uint256' }], [0n])),
      expiry(o.until),
    ], o.salt),
  }
}

/** EIP-712: matches the on-chain getDomainHash / getDelegationHash of DelegationManager (the signature itself isn't hashed) */
export function delegationTypedData(chainId: number, d: Delegation) {
  return {
    domain: { name: 'DelegationManager', version: '1', chainId, verifyingContract: DF.delegationManager as Hex },
    types: {
      Delegation: [
        { name: 'delegate', type: 'address' }, { name: 'delegator', type: 'address' }, { name: 'authority', type: 'bytes32' },
        { name: 'caveats', type: 'Caveat[]' }, { name: 'salt', type: 'uint256' },
      ],
      Caveat: [{ name: 'enforcer', type: 'address' }, { name: 'terms', type: 'bytes' }],
    },
    primaryType: 'Delegation' as const,
    message: { delegate: d.delegate, delegator: d.delegator, authority: d.authority, caveats: d.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms })), salt: d.salt },
  }
}
export const delegationDigest = (chainId: number, d: Delegation) => hashTypedData(delegationTypedData(chainId, d))

export async function signDelegation(account: Account, chainId: number, d: Delegation): Promise<Delegation> {
  if (!account.signTypedData) throw new Error('钱包不支持签名')
  return { ...d, signature: await account.signTypedData(delegationTypedData(chainId, d)) }
}

