import { zeroAddress, type Address } from 'viem';
import { erc20Abi, launcherAbi } from '../abi.js';
import { publicClient, type PublicClient } from '../client.js';
import {
  LAUNCHER_ADDRESS,
  LOG_CHUNK_BLOCKS,
  MAX_SCAN_BLOCKS,
} from '../config.js';
import type { TokenContext, TransferLog } from '../types.js';

const tokenCreatedEvent = {
  type: 'event',
  name: 'TokenCreated',
  inputs: [
    { indexed: true, name: 'token', type: 'address' },
    { indexed: true, name: 'creator', type: 'address' },
    { indexed: false, name: 'name', type: 'string' },
    { indexed: false, name: 'symbol', type: 'string' },
  ],
} as const;

const transferEvent = {
  type: 'event',
  name: 'Transfer',
  inputs: [
    { indexed: true, name: 'from', type: 'address' },
    { indexed: true, name: 'to', type: 'address' },
    { indexed: false, name: 'value', type: 'uint256' },
  ],
} as const;

/**
 * Resolve what we know about a token before scoring:
 * - whether it was launched by our MemeLauncher (first-class path)
 * - creator + creation block (from the TokenCreated event)
 * - totalSupply
 */
export async function resolveTokenContext(
  client: PublicClient,
  token: Address,
): Promise<TokenContext> {
  let isLauncherToken = false;
  let creator: Address | null = null;
  let creationBlock: bigint | null = null;

  try {
    const info = await client.readContract({
      address: LAUNCHER_ADDRESS,
      abi: launcherAbi,
      functionName: 'tokens',
      args: [token],
    });
    isLauncherToken = info[0] === true;
  } catch {
    isLauncherToken = false;
  }

  if (isLauncherToken) {
    try {
      const events = await client.getLogs({
        address: LAUNCHER_ADDRESS,
        event: tokenCreatedEvent,
        args: { token },
        fromBlock: 0n,
        toBlock: 'latest',
      });
      if (events.length > 0) {
        creator = (events[0].args.creator ?? null) as Address | null;
        creationBlock = events[0].blockNumber;
      }
    } catch {
      // leave creator/creationBlock null — downstream signals go "pending"
    }
  }

  let totalSupply: bigint | null = null;
  try {
    totalSupply = await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'totalSupply',
    });
  } catch {
    totalSupply = null;
  }

  return { token, isLauncherToken, creator, creationBlock, totalSupply };
}

/**
 * Fetch Transfer logs for a token, chunked for Monad's fast blocks.
 */
export async function fetchTransferLogs(
  client: PublicClient,
  token: Address,
  fromBlock: bigint,
): Promise<TransferLog[]> {
  const latest = await client.getBlockNumber();
  const endBlock =
    fromBlock + MAX_SCAN_BLOCKS < latest ? fromBlock + MAX_SCAN_BLOCKS : latest;

  const logs: TransferLog[] = [];
  for (let start = fromBlock; start <= endBlock; start += LOG_CHUNK_BLOCKS) {
    const chunkEnd =
      start + LOG_CHUNK_BLOCKS - 1n > endBlock
        ? endBlock
        : start + LOG_CHUNK_BLOCKS - 1n;
    const chunk = await client.getLogs({
      address: token,
      event: transferEvent,
      fromBlock: start,
      toBlock: chunkEnd,
    });
    for (const l of chunk) {
      logs.push({
        from: (l.args.from ?? zeroAddress) as Address,
        to: (l.args.to ?? zeroAddress) as Address,
        value: l.args.value ?? 0n,
        blockNumber: l.blockNumber,
        transactionHash: l.transactionHash,
      });
    }
  }
  return logs;
}

export { publicClient, zeroAddress };
