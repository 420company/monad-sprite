// EVM 链读写：余额、授权、发送交易（viem）
import {
  createPublicClient,
  createWalletClient,
  custom,
  erc20Abi,
  http,
  type Hex,
  type PublicClient,
  type Account,
} from 'viem'
import { CHAINS, chainById, isNative, type ChainToken } from './chains'
import { t } from '@/lib/i18n'
import { ensureChain, externalOf } from './vault/external'

const clients = new Map<number, PublicClient>()

/** 允许通过环境变量覆盖每条链的 RPC：VITE_EVM_RPC_<chainId> */
function rpcFor(chainId: number): string | undefined {
  const env = import.meta.env as Record<string, string | undefined>
  return env[`VITE_EVM_RPC_${chainId}`]
}

/**
 * 发交易用的 wallet client（2026-09-30 网页版连外部钱包）：
 * 0x4 自己的钱包（手机原生、网页版插件）：本地签好、经我们的节点广播（原来的做法）；
 * 外部钱包（MetaMask、Phantom 等，账户上有 ox4External 标记）：先让它切到这条链，再用 eth_sendTransaction 交给它自己签、自己发。
 * rpcUrl 只影响 0x4 Wallet 那条路（外部钱包用它自己的节点广播）
 */
export async function walletClientFor(account: Account, chainId: number, rpcUrl?: string) {
  const info = chainById(chainId)
  const chain = info?.viem
  if (!chain) throw new Error(t('不支持的链 {chainId}', { chainId }))
  const ext = externalOf(account)
  if (!ext) return createWalletClient({ account, chain, transport: http(rpcUrl ?? rpcFor(chainId)) })
  await ensureChain(ext.provider, { chainId, name: info.name, rpcUrl: rpcFor(chainId) || chain.rpcUrls.default.http[0], nativeSymbol: info.native.symbol, explorer: chain.blockExplorers?.default.url })
  // 地址当账户 = 「JSON-RPC 账户」：viem 发交易时调 eth_sendTransaction，由外部钱包弹窗确认、签名、广播
  return createWalletClient({ account: account.address, chain, transport: custom(ext.provider) })
}

export function publicClient(chainId: number): PublicClient {
  let c = clients.get(chainId)
  if (!c) {
    const chain = chainById(chainId)?.viem
    if (!chain) throw new Error(t('不支持的链 {chainId}', { chainId }))
    c = createPublicClient({ chain, transport: http(rpcFor(chainId)) })
    clients.set(chainId, c)
  }
  return c
}

export interface EvmBalance extends ChainToken {
  amount: number
}

/**
 * 扫描 EVM 链余额：原生币 + 常用代币 + 用户收藏的代币（extra）。
 * 只扫「有常用代币的主链」和「收藏里出现过的链」，避免几十条链全量请求；单条链失败不影响其它链
 */
export async function getEvmBalances(address: string, extra: ChainToken[] = [], extraChainIds: readonly number[] = [], scanned?: Set<number>): Promise<EvmBalance[]> {
  // extraChainIds：燃料费页用户添加的链（2026-09-29），没有常用代币也要扫原生币，否则燃料费永远显示 0、自动补充会一直补
  // scanned：这次成功读到余额的链（读失败的不算），自动补充只对读成功的链判断「燃料费为 0」
  const extraChains = new Set([...extra.map((t) => t.chainId), ...extraChainIds])
  const evmChains = CHAINS.filter((c) => c.type === 'evm' && (c.tokens.length > 0 || extraChains.has(c.id)))
  const results = await Promise.all(
    evmChains.map(async (chain) => {
      try {
        const client = publicClient(chain.id)
        const known = new Set(chain.tokens.map((t) => t.address.toLowerCase()))
        const tokens = [...chain.tokens, ...extra.filter((t) => t.chainId === chain.id && !isNative(t.address) && !known.has(t.address.toLowerCase()))]
        const [native, erc20s] = await Promise.all([
          client.getBalance({ address: address as Hex }),
          tokens.length
            ? client.multicall({
                contracts: tokens.map((t) => ({ address: t.address as Hex, abi: erc20Abi, functionName: 'balanceOf' as const, args: [address as Hex] })),
                allowFailure: true,
              })
            : Promise.resolve([]),
        ])
        scanned?.add(chain.id)
        const out: EvmBalance[] = []
        if (native > 0n) out.push({ ...chain.native, amount: Number(native) / 1e18 })
        erc20s.forEach((r, i) => {
          const t = tokens[i]
          if (r.status === 'success' && (r.result as bigint) > 0n) out.push({ ...t, amount: Number(r.result as bigint) / 10 ** t.decimals })
        })
        return out
      } catch {
        return [] as EvmBalance[]
      }
    }),
  )
  return results.flat()
}

/** 单个 ERC20 / 原生余额（最小单位） */
export async function getEvmTokenBalance(chainId: number, address: string, token: string): Promise<bigint> {
  const client = publicClient(chainId)
  if (isNative(token)) return client.getBalance({ address: address as Hex })
  return client.readContract({ address: token as Hex, abi: erc20Abi, functionName: 'balanceOf', args: [address as Hex] })
}

/** 确保对 spender 的授权额度足够，不够则发起 approve 并等待上链 */
export async function ensureAllowance(account: Account, chainId: number, token: string, spender: string, amount: bigint, onApproving?: () => void): Promise<void> {
  if (isNative(token)) return
  const client = publicClient(chainId)
  const allowance = await client.readContract({ address: token as Hex, abi: erc20Abi, functionName: 'allowance', args: [account.address, spender as Hex] })
  if (allowance >= amount) return
  onApproving?.()
  const chain = chainById(chainId)!.viem!
  const wallet = await walletClientFor(account, chainId)
  const hash = await wallet.writeContract({ chain, address: token as Hex, abi: erc20Abi, functionName: 'approve', args: [spender as Hex, amount] })
  const receipt = await client.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(t('授权交易失败'))
}

export interface EvmTxRequest {
  to: string
  data?: string
  value?: string | number
  gasLimit?: string | number
}

/** 发送交易并等待回执 */
/** onBroadcast：交易已经发到链上（拿到哈希）、还没确认时回调，界面据此从「请在窗口里确认」换成「已发出，等待链上确认」（2026-10-05） */
export async function sendEvmTx(account: Account, chainId: number, tx: EvmTxRequest, onBroadcast?: (hash: Hex) => void): Promise<Hex> {
  const chain = chainById(chainId)!.viem!
  const wallet = await walletClientFor(account, chainId)
  const hash = await wallet.sendTransaction({
    chain,
    to: tx.to as Hex,
    data: tx.data as Hex | undefined,
    value: tx.value !== undefined ? BigInt(tx.value) : undefined,
    gas: tx.gasLimit !== undefined ? BigInt(tx.gasLimit) : undefined,
  })
  onBroadcast?.(hash)
  const receipt = await publicClient(chainId).waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(t('链上交易执行失败'))
  return hash
}

/** 读取 ERC20 精度 */
export async function getErc20Decimals(chainId: number, token: string): Promise<number> {
  if (isNative(token)) return 18
  return publicClient(chainId).readContract({ address: token as Hex, abi: erc20Abi, functionName: 'decimals' })
}
