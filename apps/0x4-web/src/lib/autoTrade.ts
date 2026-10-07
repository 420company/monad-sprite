// Sprite spot full-auto (plan B, 2026-09-27; revised per GPT-6 review and the 6th internal review): app side
// Enable flow (all signature-only; only "re-enable / revoke on an already-upgraded wallet" costs the user a little BNB gas):
//   1. The contract address must be the hardcoded TRADER_BSC in the app — reject if the server sends a different one (review #2)
//   2. Wallet already on the MetaMask implementation (enabled before, or last attempt unfinished): call revokeAll() first to void old delegations so old and new allowances can't stack (review #4)
//   3. Sign 2 delegations: USDT buy (daily allowance, one budget, review #3) + sell (can only sell what the sprite bought), salt = current on-chain version
//   4. If not yet attached, attach EIP-7702: wallet address stays the same, attached to MetaMask's audited stateless implementation (server relays and pays gas); if another wallet already upgraded it, ask the user first
// Version and 7702 status are read directly from chain — never trust the server.
import { encodeFunctionData, recoverTypedDataAddress, type Account, type Hex } from 'viem'
import { publicClient, sendEvmTx } from './evm'
import { api } from './social'
import { t } from './i18n'

export { DF, TRADER_BSC, USDT_BSC, buildDelegations, delegationTypedData, delegationDigest, signDelegation, type Caveat, type Delegation, type DelegationKind } from './autoTradeCore'
import { buildDelegations, delegationTypedData, signDelegation, DF, TRADER_ABI, TRADER_BSC, USDT_BSC, type Delegation, type DelegationKind } from './autoTradeCore'
import type { AutoTradeSigner } from './vault/signers'
const DAY = 86400
/** The app's own hard caps (regardless of what the server pushes): max 100k USDT/day (goat 2026-09-28), max 90 days; the native signing module enforces the same caps (2nd review #3) */
export const HARD_MAX_PER_DAY = 100_000
export const DAY_CHOICES = [7, 30, 90] as const

/**
 * EIP-7702 authorization signature: attaches the account to MetaMask's stateless smart-account implementation. The native wallet only signs the digest (private key never leaves the native module).
 * nonce is the user EOA's current transaction nonce (the server relays the tx, so it's the current value)
 */
export async function signAuthorization7702(account: Account, chainId: number, nonce: number): Promise<{ address: Hex; chainId: number; nonce: number; r: Hex; s: Hex; yParity: number }> {
  const auth = { address: DF.stateless7702 as Hex, chainId, nonce }
  const a = account as Account & { signAuthorization?: (x: typeof auth) => Promise<{ r: Hex; s: Hex; yParity: number }> }
  if (a.signAuthorization) {
    const sig = await a.signAuthorization(auth)
    return { ...auth, r: sig.r, s: sig.s, yParity: sig.yParity }
  }
  throw new Error('钱包不支持这项授权')
}

// ---------- Server interaction ----------
export interface AutoConfig { enabled: boolean; chainId: number; trader: Hex | null; payToken: Hex; payDecimals: number; payPrice: number; nativePrice: number; minPerDayUsd: number; maxPerDayUsd: number }
export interface AutoStatus {
  active: boolean; chainId: number; perDayUsd: number; until: number | null; delegated7702: boolean; stoppedAt?: number | null
  /** Trades already in the sending stage with no final result yet (pause can't touch them) */ inflight?: number
  /** Banned: the server won't trade for you, but you can still pause */ banned?: boolean
  /** Whether enabling is allowed; whyNot carries the reason when not */ eligible?: boolean; whyNot?: string | null
  /** Which delegation version was last enabled (same as current on-chain version → void first, then enable) */ lastEpoch?: number | null
  /** Enabled, but the on-chain delegation was replaced by another wallet (the server will deactivate it once noticed before execution) */ replaced?: boolean
  /** On-chain delegation already voided, server deactivated */ revoked?: boolean
  /** Account re-bound to another wallet; the previous full-auto was deactivated by the server */ evmChanged?: boolean
  /** Record of an older-version enable; needs re-enabling */ outdated?: boolean
  /** Has an enable record but paused */ stopped?: boolean
  /** Whether the server recognizes this account's EVM address (EVM accounts are recognized natively; Solana accounts need a signed proof first) */ evmOk?: boolean
}
export const autoConfig = () => api<AutoConfig>('/api/auto/config')
export const autoStatus = () => api<AutoStatus>('/api/auto/status')

const CHAIN = 56
const lc = (x: string) => x.toLowerCase()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const MM_CODE = lc('0xef0100' + DF.stateless7702.slice(2))
/** Account status on BNB Chain: none = plain account / metamask = on MetaMask's stateless implementation / other = upgraded by another wallet (impl = that implementation's address) */
export type WalletKind = 'none' | 'metamask' | 'other'
function kindOf(code: string | undefined): { kind: WalletKind; impl: Hex | null } {
  const c = lc(code || '0x')
  if (c === '0x' || c === '') return { kind: 'none', impl: null }
  if (c === MM_CODE) return { kind: 'metamask', impl: DF.stateless7702 as Hex }
  if (c.startsWith('0xef0100') && c.length === 48) return { kind: 'other', impl: ('0x' + c.slice(8)) as Hex }
  throw new Error(t('这个地址是合约账户，不能开启全自动'))
}
/** On-chain reads: account status, tx nonce, delegation version in the contract. blockNumber: pinned to a block for reads (a just-confirmed tx — the load-balanced node may still lag) */
async function chainState(user: Hex, blockNumber?: bigint) {
  const c = publicClient(CHAIN)
  const at = blockNumber ? { blockNumber } : {}
  const [code, nonce, epoch] = await Promise.all([
    c.getCode({ address: user, ...at }),
    c.getTransactionCount({ address: user, ...(blockNumber ? { blockNumber } : { blockTag: 'latest' as const }) }),
    c.readContract({ address: TRADER_BSC, abi: TRADER_ABI, functionName: 'epoch', args: [user], ...at }) as Promise<bigint>,
  ])
  return { ...kindOf(code), nonce, epoch }
}
/** Wait for the node to catch up: read pinned to a block; if the node doesn't have the block yet (errors) or the result hasn't changed, back off and re-read, up to ~8s (6th round #19) */
async function stateWhen(user: Hex, ok: (s: Awaited<ReturnType<typeof chainState>>) => boolean, blockNumber?: bigint) {
  for (let i = 0; i < 10; i++) {
    const s = await chainState(user, blockNumber).catch(() => null)
    if (s && ok(s)) return s
    await sleep(800)
  }
  return null
}
/** Already upgraded to a smart account by another wallet: the user must see this clearly before deciding whether to overwrite (6th round #17) */
export class ForeignWalletError extends Error { constructor(public impl: Hex) { super(t('这个地址已被别的钱包升级为智能账户')) } }

/** Void all old delegations of this wallet (contract revokeAll; the user sends the tx and pays a little BNB gas). Check BNB balance first — show a Chinese prompt if it's not enough (6th round #16) */
async function revokeAllOnchain(account: Account) {
  const c = publicClient(CHAIN)
  const data = encodeFunctionData({ abi: TRADER_ABI, functionName: 'revokeAll' })
  const [bal, price, gas] = await Promise.all([
    c.getBalance({ address: account.address }),
    c.getGasPrice(),
    c.estimateGas({ account: account.address, to: TRADER_BSC, data }).catch(() => 60_000n),
  ])
  const need = gas * price * 3n / 2n
  if (bal < need) throw new Error(t('作废旧授权需要一点 BNB 付燃料费（约 {amt} BNB），请先转入少量 BNB 再试', { amt: (Number(need) / 1e18).toFixed(6) }))
  const hash = await sendEvmTx(account, CHAIN, { to: TRADER_BSC, data, value: 0 })
  const rc = await c.waitForTransactionReceipt({ hash, timeout: 60_000 })
  if (rc.status !== 'success') throw new Error(t('作废旧授权失败，请稍后再试'))
  return rc
}

// Enable / revoke can only run one at a time: double-tapping won't send two voids or pop two confirmations (6th round #18)
let busy: Promise<unknown> | null = null
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (busy) return Promise.reject(new Error(t('正在处理，请稍候')))
  const run = fn().finally(() => { busy = null })
  busy = run
  return run
}

/**
 * Enable (order adjusted in 6th round #16): check address and allowance → if already on the MetaMask implementation, void old delegations first → sign the two delegations (native confirmation dialog) → if not yet attached, attach 7702 (server pays) → hand to server.
 * Sign delegations before attaching 7702: cancelling in the confirmation dialog leaves nothing changed on chain, and retries cost no BNB. Delegation signatures don't depend on whether the account has code (same key).
 * If upgraded by another wallet without replaceExisting, throw ForeignWalletError so the UI asks the user first. Version and account status are read directly from chain — never trust the server.
 */
export function enableAutoTrade(account: Account, perDayUsd: number, days: number, onStep?: (s: 'authorize' | 'revoke' | 'sign' | 'save') => void, o: { replaceExisting?: boolean } = {}): Promise<AutoStatus> {
  return exclusive(async () => {
    const cfg = await autoConfig()
    if (!cfg.enabled || !cfg.trader) throw new Error(t('全自动交易即将开放'))
    if (cfg.chainId !== CHAIN || lc(cfg.trader) !== lc(TRADER_BSC) || lc(cfg.payToken) !== lc(USDT_BSC)) throw new Error(t('暂时无法开启，请联系客服'))
    // The signed amount must exactly match what the user confirmed: reject and let the user re-pick if out of range — never auto-adjust up or down (2nd review #3)
    if (!Number.isInteger(perDayUsd) || perDayUsd < cfg.minPerDayUsd || perDayUsd > cfg.maxPerDayUsd || perDayUsd > HARD_MAX_PER_DAY) throw new Error(t('每日额度不在允许范围内，请重新选择'))
    if (!(DAY_CHOICES as readonly number[]).includes(days)) throw new Error(t('有效期不对，请重新选择'))
    // Ask the server whether enabling is allowed before the user pays BNB and signs the confirmation (7th recheck: ineligible / banned users shouldn't be rejected only at the last step)
    const pre = await autoStatus()
    if (pre.banned) throw new Error(t('账号封禁期间不能开启全自动'))
    if (pre.eligible === false) throw new Error(pre.whyNot ? t(pre.whyNot) : t('暂时不能开启全自动'))
    // Server doesn't recognize this account's EVM address yet (Solana account never proved): do the proof first; if it can't be done, stop before paying BNB and signing the confirmation (8th, 9th rechecks)
    if (pre.evmOk === false) {
      const { proveEvmIfNeeded } = await import('@/store/social')
      await proveEvmIfNeeded({ interactive: true }).catch(() => false)
      if ((await autoStatus().catch(() => pre)).evmOk === false) throw new Error(t('请先解锁钱包，完成地址验证后再开启'))
    }
    const user = account.address as Hex
    let st = await chainState(user)
    if (st.kind === 'other' && !o.replaceExisting) throw new ForeignWalletError(st.impl!)
    // Cases needing old-delegation void first: already on the MetaMask implementation (decided locally, not via the server); or the server records the last enable was at the current on-chain version (re-attached by another wallet, or 7702 was removed)
    const usedThisEpoch = pre.lastEpoch != null && BigInt(pre.lastEpoch) === st.epoch
    if (st.kind === 'metamask' || usedThisEpoch) {
      // Already upgraded (enabled before, or last attempt unfinished): void old delegations first so old and new allowances can't stack
      onStep?.('revoke')
      const before = st.epoch
      const rc = await revokeAllOnchain(account)
      const after = await stateWhen(user, (s) => s.epoch > before, rc.blockNumber)
      if (!after) throw new Error(t('授权作废已提交，网络确认中，请稍后再试'))
      st = after
    }
    onStep?.('sign')
    const now = Math.floor(Date.now() / 1000), until = now + days * DAY
    const payPerDay = BigInt(perDayUsd) * 10n ** 18n
    const ds = buildDelegations({ user, trader: TRADER_BSC, payToken: USDT_BSC, payPerDay, start: now - 60, until, salt: st.epoch })
    const signed: Record<string, Delegation> = {}
    // Native app: the delegation is assembled natively from a template and signed after the system confirmation dialog (the generic signing entry rejects delegations inside native); web / Android use generic signing
    const nativeSign = (account as Account & { signAutoTrade?: AutoTradeSigner }).signAutoTrade
    const sigs = nativeSign ? await nativeSign({ perDay: payPerDay, start: now - 60, until, salt: st.epoch }) : null
    for (const [k, d] of Object.entries(ds) as [DelegationKind, Delegation][]) {
      if (!sigs) { signed[k] = await signDelegation(account, CHAIN, d); continue }
      signed[k] = { ...d, signature: sigs[k] }
      // The delegation assembled on native and web sides must be byte-identical: verify the signature against the web-side content and refuse to submit on mismatch
      const signer = await recoverTypedDataAddress({ ...delegationTypedData(CHAIN, d), signature: sigs[k] })
      if (lc(signer) !== lc(user)) throw new Error(t('授权签名验证未通过'))
    }
    if (st.kind !== 'metamask') {
      onStep?.('authorize')
      // The user may have sat on the confirmation dialog for a long time: if the allowance signature's start time is over 9 minutes old the server will reject — don't let the server pay for 7702 yet (7th recheck #16)
      if (Math.floor(Date.now() / 1000) - (now - 60) > 9 * 60) throw new Error(t('确认时间太长，这次签名已过期，请重新开启'))
      // The nonce may have changed while the dialog was open (an earlier-sent tx just confirmed): re-read before signing 7702 (7th recheck)
      // Take the larger of the two reads: after voiding, the block-pinned nonce already includes the void tx, while latest may be smaller when the load-balanced node lags (8th recheck)
      const fresh = (await chainState(user)).nonce
      st = { ...st, nonce: fresh > st.nonce ? fresh : st.nonce }
      const auth = await signAuthorization7702(account, CHAIN, st.nonce)
      let r: { ok: boolean; hash?: Hex; already?: boolean } | null = null
      try { r = await api<{ ok: boolean; hash?: Hex; already?: boolean }>('/api/auto/authorize', { method: 'POST', body: JSON.stringify({ chainId: CHAIN, authorization: auth, replaceExisting: st.kind === 'other' }) }) }
      catch (e) {
        // Server says "on-chain but node not synced / result confirming": check the chain ourselves; if it's really attached, continue enabling instead of forcing the user to pay BNB for a void on retry (8th recheck)
        // Since 2026-09-29 the server maps 502s to 503 (Cloudflare swallows 502); accept both
        const st = (e as { status?: number }).status
        if (st !== 502 && st !== 503) throw e
      }
      // Wait for our own node to catch up — don't treat a one-block lag as "not effective"
      const rc = r?.hash ? await publicClient(CHAIN).waitForTransactionReceipt({ hash: r.hash, timeout: 60_000 }).catch(() => null) : null
      if (!(await stateWhen(user, (s) => s.kind === 'metamask', rc?.blockNumber))) throw new Error(t('钱包授权已提交，网络确认中，请稍后再试'))
    }
    onStep?.('save')
    const body = JSON.stringify({ chainId: CHAIN, perDayUsd, until, delegations: signed }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    // If enabling fails after 7702 is already attached, retrying costs BNB for a void: auto-retry network failures a few times first (don't retry explicit server rejections)
    for (let i = 0; ; i++) {
      try { return await api<AutoStatus>('/api/auto/enable', { method: 'POST', body }) }
      catch (e) {
        // The last attempt may have actually succeeded with a lost response: check first — if enabled with this attempt's expiry, count it as success (8th recheck)
        if (i > 0) { const now2 = await autoStatus().catch(() => null); if (now2?.active && now2.until === until * 1000) return now2 }
        const status = (e as { status?: number }).status
        if (i >= 2 || (status && status < 500)) throw e
        await sleep(1500 * (i + 1))
      }
    }
  })
}
/** Pause: the server stops placing orders for you immediately (on-chain delegation stays until expiry; use revokeAutoTrade to void it now) */
export const stopAutoTrade = () => api<AutoStatus>('/api/auto/stop', { method: 'POST' })
/**
 * Revoke on-chain permissions: void all delegations (the user sends the tx). Only the chain and the hardcoded contract address in the app are trusted — no dependence on server switches or APIs (2nd review):
 * users can still revoke when the server is down / APIs error. Then notify the server to stop as a courtesy — failure doesn't affect the revocation
 */
export function revokeAutoTrade(account: Account): Promise<AutoStatus | null> {
  return exclusive(async () => {
    await revokeAllOnchain(account)
    return api<AutoStatus>('/api/auto/stop', { method: 'POST' }).catch(() => null)
  })
}
/**
 * Whether this wallet might still carry on-chain delegations: any 7702 implementation attached counts (read directly from chain, never ask the server).
 * After another wallet re-attached, old delegations are temporarily unusable but recover when switched back, so the revoke entry is still offered (6th round #17); revokeAll is sent by the account itself and succeeds under any implementation
 */
export async function hasOnchainAuthorization(user: Hex): Promise<boolean> {
  const code = await publicClient(CHAIN).getCode({ address: user }).catch(() => undefined)
  return !!code && lc(code).startsWith('0xef0100')
}
