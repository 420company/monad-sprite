// MemeLauncher interaction layer — Monad testnet (added 2026-10-07 for hackathon)
// Contract: 0x8ca1990c872b9f28f0dedc2ac9024dd6d1d2457f (chain 10143)
// Reads go through evm.ts publicClient; writes go through sendEvmTx (signed by 0x4 wallet or external wallet)
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

/** Whether a token was issued by the Launcher (bonding curve) */
export async function isLauncherToken(token: string): Promise<boolean> {
  try {
    const r = (await client().readContract({
      address: LAUNCHER_ADDRESS,
      abi: MemeLauncherAbi,
      functionName: 'tokens',
      args: [token as Hex],
    })) as unknown as readonly [boolean, bigint, bigint, string, string]
    // NOTE (2026-10-07): this viem version returns structs as positional arrays
    // only (no named props), so read exists/supply/etc. by index, not by name.
    return !!r?.[0]
  } catch {
    return false
  }
}

/** Read token info (supply / reserve / name / symbol) */
export async function getLauncherToken(token: string): Promise<LauncherToken | null> {
  try {
    const r = (await client().readContract({
      address: LAUNCHER_ADDRESS,
      abi: MemeLauncherAbi,
      functionName: 'tokens',
      args: [token as Hex],
    })) as unknown as readonly [boolean, bigint, bigint, string, string]
    // NOTE (2026-10-07): positional array, see isLauncherToken.
    if (!r?.[0]) return null
    return { address: token as Hex, exists: true, supply: r[1], reserve: r[2], name: r[3], symbol: r[4] }
  } catch {
    return null
  }
}

/** Current price (wei MON per token unit) */
export async function getLauncherPrice(token: string): Promise<bigint> {
  return client().readContract({
    address: LAUNCHER_ADDRESS,
    abi: MemeLauncherAbi,
    functionName: 'getPrice',
    args: [token as Hex],
  }) as Promise<bigint>
}

/** How many tokens monWei MON buys */
export async function quoteLauncherBuy(token: string, monWei: bigint): Promise<bigint> {
  return client().readContract({
    address: LAUNCHER_ADDRESS,
    abi: MemeLauncherAbi,
    functionName: 'quoteBuy',
    args: [token as Hex, monWei],
  }) as Promise<bigint>
}

/** How much MON (wei) selling tokenAmount tokens returns */
export async function quoteLauncherSell(token: string, tokenAmount: bigint): Promise<bigint> {
  return client().readContract({
    address: LAUNCHER_ADDRESS,
    abi: MemeLauncherAbi,
    functionName: 'quoteSell',
    args: [token as Hex, tokenAmount],
  }) as Promise<bigint>
}

/** Launch a token: name + symbol. Returns tx hash on success (new token address comes from the TokenCreated event) */
export async function createLauncherToken(account: Account, name: string, symbol: string): Promise<Hex> {
  const data = encodeFunctionData({
    abi: MemeLauncherAbi,
    functionName: 'createToken',
    args: [name, symbol],
  })
  return sendEvmTx(account, MONAD_TESTNET_ID, { to: LAUNCHER_ADDRESS, data })
}

/** Buy: monWei is the MON amount (wei) to spend */
export async function buyLauncherToken(account: Account, token: string, monWei: bigint): Promise<Hex> {
  const data = encodeFunctionData({
    abi: MemeLauncherAbi,
    functionName: 'buy',
    args: [token as Hex],
  })
  return sendEvmTx(account, MONAD_TESTNET_ID, { to: LAUNCHER_ADDRESS, data, value: monWei.toString() })
}

/**
 * Sell: tokenAmount is the number of tokens to sell.
 * Note: MemeToken.burnFrom only checks onlyLauncher, not allowance — no pre-approve needed.
 */
export async function sellLauncherToken(account: Account, token: string, tokenAmount: bigint): Promise<Hex> {
  const data = encodeFunctionData({
    abi: MemeLauncherAbi,
    functionName: 'sell',
    args: [token as Hex, tokenAmount],
  })
  return sendEvmTx(account, MONAD_TESTNET_ID, { to: LAUNCHER_ADDRESS, data })
}

/** Find the token address created by a launch tx, via the TokenCreated event */
export async function findCreatedToken(txHash: Hex): Promise<Hex | null> {
  const c = client()
  const receipt = await c.waitForTransactionReceipt({ hash: txHash })
  for (const log of receipt.logs) {
    try {
      const { eventName, args } = decodeEventLog({ abi: MemeLauncherAbi, data: log.data, topics: log.topics })
      if (eventName === 'TokenCreated') return (args as { token: Hex }).token
    } catch {
      /* Not our contract's log — skip */
    }
  }
  return null
}

/** List the first N token addresses issued by the Launcher */
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
