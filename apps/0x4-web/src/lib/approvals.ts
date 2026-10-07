// Approval checks and revocation: Solana token-account delegates and EVM ERC20 allowances
import { PublicKey, Transaction } from '@solana/web3.js'
import type { SolanaWallet } from '@/lib/vault/signers'
import { createRevokeInstruction, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import { erc20Abi, type Hex, type Account } from 'viem'
import { confirmSignature, getConnection } from './rpc'
import { publicClient, walletClientFor } from './evm'
import { chainById, CHAINS, SOLANA_CHAIN_ID } from './chains'
import type { Holding } from './types'
import { t } from '@/lib/i18n'

export interface Approval {
  chainId: number
  token: string
  symbol: string
  spender: string
  spenderName: string
  /** Approved amount (decimal; Infinity for EVM unlimited approvals) */
  amount: number
  /** Solana: token account address (for revocation) */
  account?: string
}

/** Common contract addresses: DEX routers, aggregators, Permit2, LI.FI. Mostly the same address across EVM chains */
export const KNOWN_SPENDERS: { address: string; name: string; chains?: number[] }[] = [
  { address: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', name: '跨链兑换路由' },
  { address: '0x000000000022D473030F116dDEE9F6B43aC78BA3', name: 'Permit2（Uniswap）' },
  { address: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD', name: 'Uniswap Universal Router' },
  { address: '0xE592427A0AEce92De3Edee1F18E0157C05861564', name: 'Uniswap V3 Router' },
  { address: '0x1111111254EEB25477B68fb85Ed929f73A960582', name: '1inch v5' },
  { address: '0x111111125421cA6dc452d289314280a0f8842A65', name: '1inch v6' },
  { address: '0xDef1C0ded9bec7F1a1670819833240f027b25EfF', name: '0x Exchange Proxy' },
  { address: '0x6352a56caadC4F1E25CD6c75970Fa768A3304e64', name: 'OpenOcean' },
  { address: '0x10ED43C718714eb63d5aA57B78B54704E256024E', name: 'PancakeSwap V2 Router', chains: [56] },
  { address: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4', name: 'PancakeSwap V3 Router', chains: [56, 1, 8453, 42161] },
  { address: '0x2626664c2603336E57B271c5C0b26F421741e481', name: 'Uniswap V3 Router (Base)', chains: [8453] },
  { address: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5', name: 'KyberSwap', chains: [1, 56, 8453, 42161, 137, 10] },
]

const UNLIMITED = 2n ** 255n

/** Solana: find all token accounts with a delegate set */
export async function scanSolana(rpcUrl: string, owner: string): Promise<Approval[]> {
  const conn = getConnection(rpcUrl)
  const pk = new PublicKey(owner)
  const out: Approval[] = []
  for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const res = await conn.getParsedTokenAccountsByOwner(pk, { programId: program }).catch(() => ({ value: [] }))
    for (const acc of res.value) {
      const info = acc.account.data.parsed?.info
      if (!info?.delegate) continue
      out.push({ chainId: SOLANA_CHAIN_ID, token: info.mint, symbol: String(info.mint).slice(0, 4) + '…', spender: info.delegate, spenderName: '代币委托', amount: Number(info.delegatedAmount?.uiAmount || 0), account: acc.pubkey.toBase58() })
    }
  }
  return out
}

/** EVM: check each held token's allowance against the common contracts */
export async function scanEvm(evmAddress: string, holdings: Holding[], extraSpenders: string[] = []): Promise<Approval[]> {
  const out: Approval[] = []
  const tokens = holdings.filter((h) => h.chainId !== SOLANA_CHAIN_ID && !h.mint.startsWith('0x000000000000000000000000000000000000'))
  const byChain = new Map<number, Holding[]>()
  for (const h of tokens) byChain.set(h.chainId, [...(byChain.get(h.chainId) || []), h])
  await Promise.all([...byChain].map(async ([chainId, list]) => {
    if (!chainById(chainId)?.viem) return
    const spenders = [...KNOWN_SPENDERS.filter((s) => !s.chains || s.chains.includes(chainId)), ...extraSpenders.map((a) => ({ address: a, name: '自定义合约' }))]
    const client = publicClient(chainId)
    const calls = list.flatMap((h) => spenders.map((sp) => ({ address: h.mint as Hex, abi: erc20Abi, functionName: 'allowance' as const, args: [evmAddress as Hex, sp.address as Hex] })))
    const res = await client.multicall({ contracts: calls, allowFailure: true }).catch(() => [])
    res.forEach((r, i) => {
      const h = list[Math.floor(i / spenders.length)]; const sp = spenders[i % spenders.length]
      if (r.status !== 'success' || !(r.result as bigint)) return
      const v = r.result as bigint
      out.push({ chainId, token: h.mint, symbol: h.symbol, spender: sp.address, spenderName: sp.name, amount: v >= UNLIMITED ? Infinity : Number(v) / 10 ** h.decimals })
    })
  }))
  return out
}

export async function revoke(a: Approval, signers: { solana: SolanaWallet | null; evm: Account | null; solanaRpc: string }): Promise<string> {
  if (a.chainId === SOLANA_CHAIN_ID) {
    if (!signers.solana || !a.account) throw new Error(t('缺少 Solana 密钥'))
    const conn = getConnection(signers.solanaRpc)
    const tx = new Transaction().add(createRevokeInstruction(new PublicKey(a.account), signers.solana.publicKey))
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash()
    tx.recentBlockhash = blockhash; tx.feePayer = signers.solana.publicKey; await signers.solana.signTransaction(tx)
    const sig = await conn.sendRawTransaction(tx.serialize())
    await confirmSignature(conn, sig, lastValidBlockHeight)
    return sig
  }
  if (!signers.evm) throw new Error(t('缺少 EVM 密钥'))
  const chain = chainById(a.chainId)!.viem!
  const wallet = await walletClientFor(signers.evm, a.chainId)   // External wallets sign and broadcast themselves (lib/evm.ts)
  const hash = await wallet.writeContract({ chain, address: a.token as Hex, abi: erc20Abi, functionName: 'approve', args: [a.spender as Hex, 0n] })
  await publicClient(a.chainId).waitForTransactionReceipt({ hash })
  return hash
}

export const evmChains = CHAINS.filter((c) => c.type === 'evm')
