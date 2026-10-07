// 小精灵现货全自动（B 方案，2026-09-27；按 GPT-6 审查和第六轮内部审查改过）：App 端
// 开启流程（都只签名；只有「已升级过的钱包重新开启 / 撤销」要用户自己付一点点 BNB 燃料费）：
//   1. 合约地址用 App 里写死的 TRADER_BSC，服务器给的不一致就拒绝（审查 #2）
//   2. 钱包已挂 MetaMask 实现（以前开过，或上次没开完）：先调合约 revokeAll() 作废旧授权，保证新旧额度不会叠加（审查 #4）
//   3. 签 2 个委托：USDT 买入（每日额度，一份预算，审查 #3）+ 卖出（只能卖小精灵买到的数量），salt = 链上当前版本号
//   4. 还没挂的再挂 EIP-7702：钱包地址不变，挂上 MetaMask 审计过的无状态实现（服务器代发、代付燃料费）；已被别家钱包升级的先问用户
// 版本号、7702 状态都直接读链，不信服务器。
import { encodeFunctionData, recoverTypedDataAddress, type Account, type Hex } from 'viem'
import { publicClient, sendEvmTx } from './evm'
import { api } from './social'
import { t } from './i18n'

export { DF, TRADER_BSC, USDT_BSC, buildDelegations, delegationTypedData, delegationDigest, signDelegation, type Caveat, type Delegation, type DelegationKind } from './autoTradeCore'
import { buildDelegations, delegationTypedData, signDelegation, DF, TRADER_ABI, TRADER_BSC, USDT_BSC, type Delegation, type DelegationKind } from './autoTradeCore'
import type { AutoTradeSigner } from './vault/signers'
const DAY = 86400
/** App 自己的硬上限（不管服务器下发什么）：每天最多 10 万 USDT（goat 2026-09-28 定）、最长 90 天；原生签名模块还有一道同样的上限（第二轮审查 #3） */
export const HARD_MAX_PER_DAY = 100_000
export const DAY_CHOICES = [7, 30, 90] as const

/**
 * EIP-7702 授权签名：把账户挂到 MetaMask 的无状态智能账户实现上。原生钱包只签摘要（私钥不出原生模块）。
 * nonce 是用户 EOA 当前的交易 nonce（由服务器代发交易，所以就是当前值）
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

// ---------- 和服务器交互 ----------
export interface AutoConfig { enabled: boolean; chainId: number; trader: Hex | null; payToken: Hex; payDecimals: number; payPrice: number; nativePrice: number; minPerDayUsd: number; maxPerDayUsd: number }
export interface AutoStatus {
  active: boolean; chainId: number; perDayUsd: number; until: number | null; delegated7702: boolean; stoppedAt?: number | null
  /** 已经进入发送阶段、还没有最终结果的笔数（暂停管不到它们） */ inflight?: number
  /** 封禁中：服务器不替你交易，但仍可以暂停 */ banned?: boolean
  /** 能不能开启；不能时 whyNot 是原因 */ eligible?: boolean; whyNot?: string | null
  /** 上次在哪个授权版本开过（和链上当前版本一样就要先作废再开） */ lastEpoch?: number | null
  /** 开着，但链上授权已被别家钱包换掉（服务器执行前发现会停用） */ replaced?: boolean
  /** 链上授权已经作废，服务器已停用 */ revoked?: boolean
  /** 账号换绑了别的钱包，原来的全自动服务器已停用 */ evmChanged?: boolean
  /** 旧版本开启的记录，要重新开启 */ outdated?: boolean
  /** 有开启记录但已暂停 */ stopped?: boolean
  /** 服务器认不认这个账号的 EVM 地址（EVM 账号天然认；Solana 账号要签名证明过） */ evmOk?: boolean
}
export const autoConfig = () => api<AutoConfig>('/api/auto/config')
export const autoStatus = () => api<AutoStatus>('/api/auto/status')

const CHAIN = 56
const lc = (x: string) => x.toLowerCase()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const MM_CODE = lc('0xef0100' + DF.stateless7702.slice(2))
/** 账户在 BNB Chain 上的状态：none 普通账户 / metamask 已挂 MetaMask 无状态实现 / other 已被别家钱包升级（impl = 那个实现的地址） */
export type WalletKind = 'none' | 'metamask' | 'other'
function kindOf(code: string | undefined): { kind: WalletKind; impl: Hex | null } {
  const c = lc(code || '0x')
  if (c === '0x' || c === '') return { kind: 'none', impl: null }
  if (c === MM_CODE) return { kind: 'metamask', impl: DF.stateless7702 as Hex }
  if (c.startsWith('0xef0100') && c.length === 48) return { kind: 'other', impl: ('0x' + c.slice(8)) as Hex }
  throw new Error(t('这个地址是合约账户，不能开启全自动'))
}
/** 链上读：账户状态、交易 nonce、合约里的授权版本号。blockNumber：锁定到某个区块读（刚上链的交易，负载均衡节点可能还落后） */
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
/** 等节点跟上：按区块读，节点还没有这个块（报错）或结果还没变就退避重读，最多约 8 秒（第六轮 #19） */
async function stateWhen(user: Hex, ok: (s: Awaited<ReturnType<typeof chainState>>) => boolean, blockNumber?: bigint) {
  for (let i = 0; i < 10; i++) {
    const s = await chainState(user, blockNumber).catch(() => null)
    if (s && ok(s)) return s
    await sleep(800)
  }
  return null
}
/** 已被别家钱包升级为智能账户：要用户看清楚再决定要不要覆盖（第六轮 #17） */
export class ForeignWalletError extends Error { constructor(public impl: Hex) { super(t('这个地址已被别的钱包升级为智能账户')) } }

/** 作废这个钱包所有旧授权（合约 revokeAll，用户自己发交易、付一点 BNB 燃料费）。先查 BNB 够不够，不够给中文提示（第六轮 #16） */
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

// 开启 / 撤销同一时间只能跑一个：连点两下不会发两笔作废、弹两次确认（第六轮 #18）
let busy: Promise<unknown> | null = null
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (busy) return Promise.reject(new Error(t('正在处理，请稍候')))
  const run = fn().finally(() => { busy = null })
  busy = run
  return run
}

/**
 * 开启（第六轮 #16 调了顺序）：检查地址和额度 → 已挂 MetaMask 实现的先作废旧授权 → 签两个委托（原生确认框）→ 还没挂的再挂 7702（服务器代付）→ 交给服务器。
 * 先签委托再挂 7702：在确认框点取消时链上什么都没改，重试也不用付 BNB。委托签名不依赖账户有没有代码（同一把钥匙）。
 * 已被别家钱包升级的，没有 replaceExisting 就抛 ForeignWalletError，让界面先问用户。版本号、账户状态都直接读链，不信服务器。
 */
export function enableAutoTrade(account: Account, perDayUsd: number, days: number, onStep?: (s: 'authorize' | 'revoke' | 'sign' | 'save') => void, o: { replaceExisting?: boolean } = {}): Promise<AutoStatus> {
  return exclusive(async () => {
    const cfg = await autoConfig()
    if (!cfg.enabled || !cfg.trader) throw new Error(t('全自动交易即将开放'))
    if (cfg.chainId !== CHAIN || lc(cfg.trader) !== lc(TRADER_BSC) || lc(cfg.payToken) !== lc(USDT_BSC)) throw new Error(t('暂时无法开启，请联系客服'))
    // 签名金额必须正好是用户确认的金额：不在允许范围就拒绝、让用户重新选，绝不自动调大调小（第二轮审查 #3）
    if (!Number.isInteger(perDayUsd) || perDayUsd < cfg.minPerDayUsd || perDayUsd > cfg.maxPerDayUsd || perDayUsd > HARD_MAX_PER_DAY) throw new Error(t('每日额度不在允许范围内，请重新选择'))
    if (!(DAY_CHOICES as readonly number[]).includes(days)) throw new Error(t('有效期不对，请重新选择'))
    // 先问服务器能不能开，再让用户付 BNB、签确认框（第七轮复核：没资格 / 封禁的人别走到最后一步才被拒）
    const pre = await autoStatus()
    if (pre.banned) throw new Error(t('账号封禁期间不能开启全自动'))
    if (pre.eligible === false) throw new Error(pre.whyNot ? t(pre.whyNot) : t('暂时不能开启全自动'))
    // 服务器还不认这个账号的 EVM 地址（Solana 账号没证明过）：先补一次证明；证明不了就在付 BNB、签确认框之前停下（第八、九轮复核）
    if (pre.evmOk === false) {
      const { proveEvmIfNeeded } = await import('@/store/social')
      await proveEvmIfNeeded({ interactive: true }).catch(() => false)
      if ((await autoStatus().catch(() => pre)).evmOk === false) throw new Error(t('请先解锁钱包，完成地址验证后再开启'))
    }
    const user = account.address as Hex
    let st = await chainState(user)
    if (st.kind === 'other' && !o.replaceExisting) throw new ForeignWalletError(st.impl!)
    // 要先作废旧授权的情况：已挂 MetaMask 实现（不信服务器，自己判断）；或者服务器记着上次就在链上当前这个版本开过（被别家钱包改挂、或 7702 被撤掉过）
    const usedThisEpoch = pre.lastEpoch != null && BigInt(pre.lastEpoch) === st.epoch
    if (st.kind === 'metamask' || usedThisEpoch) {
      // 已经升级过（以前开启过，或上次开启没完成）：先作废旧授权，保证新旧额度不会叠加
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
    // 原生 App：委托由原生按模板组装、弹系统确认框后签（通用签名入口在原生里拒签委托）；网页版 / Android 走通用签名
    const nativeSign = (account as Account & { signAutoTrade?: AutoTradeSigner }).signAutoTrade
    const sigs = nativeSign ? await nativeSign({ perDay: payPerDay, start: now - 60, until, salt: st.epoch }) : null
    for (const [k, d] of Object.entries(ds) as [DelegationKind, Delegation][]) {
      if (!sigs) { signed[k] = await signDelegation(account, CHAIN, d); continue }
      signed[k] = { ...d, signature: sigs[k] }
      // 原生和网页两边各自组装的委托必须完全一样：用网页这边的内容验签，对不上就不提交
      const signer = await recoverTypedDataAddress({ ...delegationTypedData(CHAIN, d), signature: sigs[k] })
      if (lc(signer) !== lc(user)) throw new Error(t('授权签名验证未通过'))
    }
    if (st.kind !== 'metamask') {
      onStep?.('authorize')
      // 用户可能在确认框停了很久：额度签名的开始时间离现在超过 9 分钟，服务器会拒，先别让服务器代付 7702（第七轮复核 #16）
      if (Math.floor(Date.now() / 1000) - (now - 60) > 9 * 60) throw new Error(t('确认时间太长，这次签名已过期，请重新开启'))
      // nonce 在确认框期间可能变了（之前发出的交易刚上链）：签 7702 之前重新读（第七轮复核）
      // 取两次读数里大的：作废之后按区块读到的 nonce 已经算上作废那笔，负载均衡节点落后时 latest 可能更小（第八轮复核）
      const fresh = (await chainState(user)).nonce
      st = { ...st, nonce: fresh > st.nonce ? fresh : st.nonce }
      const auth = await signAuthorization7702(account, CHAIN, st.nonce)
      let r: { ok: boolean; hash?: Hex; already?: boolean } | null = null
      try { r = await api<{ ok: boolean; hash?: Hex; already?: boolean }>('/api/auto/authorize', { method: 'POST', body: JSON.stringify({ chainId: CHAIN, authorization: auth, replaceExisting: st.kind === 'other' }) }) }
      catch (e) {
        // 服务器说「已上链但节点没同步 / 结果确认中」：自己查链，确实挂上了就接着开，不让用户重试时被迫付 BNB 作废（第八轮复核）
        // 服务器 2026-09-29 起把 502 统一改回 503（Cloudflare 会吞掉 502），两个都认
        const st = (e as { status?: number }).status
        if (st !== 502 && st !== 503) throw e
      }
      // 等自己的节点跟上，别因为晚一个块就当成没生效
      const rc = r?.hash ? await publicClient(CHAIN).waitForTransactionReceipt({ hash: r.hash, timeout: 60_000 }).catch(() => null) : null
      if (!(await stateWhen(user, (s) => s.kind === 'metamask', rc?.blockNumber))) throw new Error(t('钱包授权已提交，网络确认中，请稍后再试'))
    }
    onStep?.('save')
    const body = JSON.stringify({ chainId: CHAIN, perDayUsd, until, delegations: signed }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    // 7702 已经挂上以后开启失败，重试就要付 BNB 作废：网络问题先自动重试几次（服务器明确拒绝的不重试）
    for (let i = 0; ; i++) {
      try { return await api<AutoStatus>('/api/auto/enable', { method: 'POST', body }) }
      catch (e) {
        // 上一次其实已经开好、只是响应丢了：先查一下，已开启且是这次的到期时间就当成功（第八轮复核）
        if (i > 0) { const now2 = await autoStatus().catch(() => null); if (now2?.active && now2.until === until * 1000) return now2 }
        const status = (e as { status?: number }).status
        if (i >= 2 || (status && status < 500)) throw e
        await sleep(1500 * (i + 1))
      }
    }
  })
}
/** 暂停：服务器立刻不再替你下单（链上授权仍在，到期作废；要立刻作废用 revokeAutoTrade） */
export const stopAutoTrade = () => api<AutoStatus>('/api/auto/stop', { method: 'POST' })
/**
 * 撤销链上权限：作废所有授权（用户自己发交易）。只靠链和 App 里写死的合约地址，不依赖服务器开关和接口（第二轮审查）：
 * 服务器关了 / 接口出错时用户照样能撤。之后顺手通知服务器停止，失败也不影响撤销结果
 */
export function revokeAutoTrade(account: Account): Promise<AutoStatus | null> {
  return exclusive(async () => {
    await revokeAllOnchain(account)
    return api<AutoStatus>('/api/auto/stop', { method: 'POST' }).catch(() => null)
  })
}
/**
 * 这个钱包在链上有没有可能还挂着授权：挂了任何 7702 实现都当有（直接读链，不问服务器）。
 * 被别家钱包改挂以后旧委托暂时用不了，但改回来就恢复，所以也给撤销入口（第六轮 #17）；revokeAll 是账户自己发交易，挂什么实现都能成功
 */
export async function hasOnchainAuthorization(user: Hex): Promise<boolean> {
  const code = await publicClient(CHAIN).getCode({ address: user }).catch(() => undefined)
  return !!code && lc(code).startsWith('0xef0100')
}
