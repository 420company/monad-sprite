// Monad testnet MemeLauncher 交互层（2026-10-07 黑客松新增）
// 合约：0x8ca1990c872b9f28f0dedc2ac9024dd6d1d2457f（chain 10143）
// 读走 evm.ts 的 publicClient，写走 sendEvmTx（0x4 钱包或外部钱包签名）
import { encodeFunctionData, decodeEventLog, type Account, type Hex } from 'viem'
import { publicClient, sendEvmTx } from './evm'
import { MemeLauncherAbi } from '@/abi/MemeLauncher'

export const MONAD_TESTNET_ID = 10143
export const LAUNCHER_ADDRESS = '0x8ca1990c872b9f28f0dedc2ac9024dd6d1d2457f' as Hex

const client = () => publicClient(MONAD_TESTNET_ID)

export interface LauncherToken {
  address: Hex
  exists: boolean
  supply: bigint
  reserve: bigint
  name: string
  symbol: string
}

/** 代币是否为 Launcher 发行的 bonding curve 币 */
export async function isLauncherToken(token: string): Promise<boolean> {
  try {
    const r = (await client().readContract({
      address: LAUNCHER_ADDRESS,
      abi: MemeLauncherAbi,
      functionName: 'tokens',
      args: [token as Hex],
    })) as unknown as { exists: boolean }
    return !!r?.exists
  } catch {
    return false
  }
}

/** 读取代币信息（supply / reserve / name / symbol） */
export async function getLauncherToken(token: string): Promise<LauncherToken | null> {
  try {
    const r = (await client().readContract({
      address: LAUNCHER_ADDRESS,
      abi: MemeLauncherAbi,
      functionName: 'tokens',
      args: [token as Hex],
    })) as unknown as { exists: boolean; supply: bigint; reserve: bigint; name: string; symbol: string }
    if (!r?.exists) return null
    return { address: token as Hex, exists: true, supply: r.supply, reserve: r.reserve, name: r.name, symbol: r.symbol }
  } catch {
    return null
  }
}

/** 当前价格（wei/MON per token unit） */
export async function getLauncherPrice(token: string): Promise<bigint> {
  return client().readContract({
    address: LAUNCHER_ADDRESS,
    abi: MemeLauncherAbi,
    functionName: 'getPrice',
    args: [token as Hex],
  }) as Promise<bigint>
}

/** 花 monWei 个 MON 能买到多少 token */
export async function quoteLauncherBuy(token: string, monWei: bigint): Promise<bigint> {
  return client().readContract({
    address: LAUNCHER_ADDRESS,
    abi: MemeLauncherAbi,
    functionName: 'quoteBuy',
    args: [token as Hex, monWei],
  }) as Promise<bigint>
}

/** 卖 tokenAmount 个 token 能拿回多少 MON（wei） */
export async function quoteLauncherSell(token: string, tokenAmount: bigint): Promise<bigint> {
  return client().readContract({
    address: LAUNCHER_ADDRESS,
    abi: MemeLauncherAbi,
    functionName: 'quoteSell',
    args: [token as Hex, tokenAmount],
  }) as Promise<bigint>
}

/** 发币：name + symbol，成功后返回交易哈希（TokenCreated 事件里拿新币地址） */
export async function createLauncherToken(account: Account, name: string, symbol: string): Promise<Hex> {
  const data = encodeFunctionData({
    abi: MemeLauncherAbi,
    functionName: 'createToken',
    args: [name, symbol],
  })
  return sendEvmTx(account, MONAD_TESTNET_ID, { to: LAUNCHER_ADDRESS, data })
}

/** 买：monWei 为支付的 MON 数量（wei） */
export async function buyLauncherToken(account: Account, token: string, monWei: bigint): Promise<Hex> {
  const data = encodeFunctionData({
    abi: MemeLauncherAbi,
    functionName: 'buy',
    args: [token as Hex],
  })
  return sendEvmTx(account, MONAD_TESTNET_ID, { to: LAUNCHER_ADDRESS, data, value: monWei.toString() })
}

/**
 * 卖：tokenAmount 为卖出的 token 数量。
 * 注意：MemeToken.burnFrom 只校验 onlyLauncher，不查 allowance，无需预先 approve。
 */
export async function sellLauncherToken(account: Account, token: string, tokenAmount: bigint): Promise<Hex> {
  const data = encodeFunctionData({
    abi: MemeLauncherAbi,
    functionName: 'sell',
    args: [token as Hex, tokenAmount],
  })
  return sendEvmTx(account, MONAD_TESTNET_ID, { to: LAUNCHER_ADDRESS, data })
}

/** 从 TokenCreated 事件里查某笔发币交易创建的代币地址 */
export async function findCreatedToken(txHash: Hex): Promise<Hex | null> {
  const c = client()
  const receipt = await c.waitForTransactionReceipt({ hash: txHash })
  for (const log of receipt.logs) {
    try {
      const { eventName, args } = decodeEventLog({ abi: MemeLauncherAbi, data: log.data, topics: log.topics })
      if (eventName === 'TokenCreated') return (args as { token: Hex }).token
    } catch {
      /* 不是本合约的日志，跳过 */
    }
  }
  return null
}

/** 列出 Launcher 发行的前 N 个代币地址 */
export async function listLauncherTokens(limit = 50): Promise<Hex[]> {
  const c = client()
  const count = (await c.readContract({
    address: LAUNCHER_ADDRESS,
    abi: MemeLauncherAbi,
    functionName: 'tokenCount',
  })) as bigint
  const n = Math.min(Number(count), limit)
  const out: Hex[] = []
  for (let i = 0; i < n; i++) {
    const addr = (await c.readContract({
      address: LAUNCHER_ADDRESS,
      abi: MemeLauncherAbi,
      functionName: 'allTokens',
      args: [BigInt(i)],
    })) as Hex
    out.push(addr)
  }
  return out
}
