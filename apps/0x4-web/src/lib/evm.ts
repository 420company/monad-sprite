// EVM chain read/write: balances, approvals, sending transactions (viem)
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

/** Per-chain RPC override via env: VITE_EVM_RPC_<chainId> */
function rpcFor(chainId: number): string | undefined {
  const env = import.meta.env as Record<string, string | undefined>
  return env[`VITE_EVM_RPC_${chainId}`]
}

/**
 * Wallet client for sending transactions (2026-09-30 web connects external wallets):
 * 0x4's own wallets (mobile native, web extension): signed locally, broadcast via our nodes (the original flow);
 * external wallets (MetaMask, Phantom, etc. — accounts carry the ox4External marker): switch them to the chain first, then let them sign and send themselves via eth_sendTransaction.
 * rpcUrl only affects the 0x4 Wallet path (external wallets broadcast through their own nodes)
 */
export async function walletClientFor(account: Account, chainId: number, rpcUrl?: string) {
  const info = chainById(chainId)
  const chain = info?.viem
  if (!chain) throw new Error(t('不支持的链 {chainId}', { chainId }))
  const ext = externalOf(account)
  if (!ext) return createWalletClient({ account, chain, transport: http(rpcUrl ?? rpcFor(chainId)) })
  await ensureChain(ext.provider, { chainId, name: info.name, rpcUrl: rpcFor(chainId) || chain.rpcUrls.default.http[0], nativeSymbol: info.native.symbol, explorer: chain.blockExplorers?.default.url })
  // Address-as-account = a "JSON-RPC account": viem calls eth_sendTransaction when sending, and the external wallet pops up to confirm, sign, and broadcast
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
 * Scan EVM chain balances: native coin + common tokens + the user's favorited tokens (extra).
 * Only scans "main chains that have common tokens" and "chains appearing in favorites" to avoid full requests across dozens of chains; one chain failing doesn't affect the others
 */
export async function getEvmBalances(address: string, extra: ChainToken[] = [], extraChainIds: readonly number[] = [], scanned?: Set<number>): Promise<EvmBalance[]> {
  // extraChainIds: chains the user added on the gas page (2026-09-29) — their native coin is scanned even without common tokens, otherwise gas would forever show 0 and auto-top-up would keep topping up
  // scanned: chains whose balances were successfully read this round (failed reads don't count); auto-top-up only judges "gas is 0" for successfully-read chains
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

/** A single ERC20 / native balance (smallest unit) */
export async function getEvmTokenBalance(chainId: number, address: string, token: string): Promise<bigint> {
  const client = publicClient(chainId)
  if (isNative(token)) return client.getBalance({ address: address as Hex })
  return client.readContract({ address: token as Hex, abi: erc20Abi, functionName: 'balanceOf', args: [address as Hex] })
}

/** Ensure sufficient allowance for the spender; fire an approve and wait for it on-chain when short */
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

/** Send a transaction and wait for the receipt */
/** onBroadcast: fires when the tx is on-chain (hash in hand) but unconfirmed — the UI switches from "confirm in the window" to "sent, awaiting on-chain confirmation" (2026-10-05) */
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

/** Read an ERC20's decimals */
export async function getErc20Decimals(chainId: number, token: string): Promise<number> {
  if (isNative(token)) return 18
  return publicClient(chainId).readContract({ address: token as Hex, abi: erc20Abi, functionName: 'decimals' })
}
