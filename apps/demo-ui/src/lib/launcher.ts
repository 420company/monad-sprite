import {
  createPublicClient,
  http,
  parseAbiItem,
  formatEther,
  type Abi,
  type AbiEvent,
  type Address,
} from 'viem';
import { ACTIVE_CHAIN, LAUNCHER_ADDRESS } from '../config';
import launcherAbiJson from '../abi/MemeLauncher.json';
import tokenAbiJson from '../abi/MemeToken.json';

const launcherAbi = launcherAbiJson as unknown as Abi;
const tokenAbi = tokenAbiJson as unknown as Abi;

export const publicClient = createPublicClient({
  chain: ACTIVE_CHAIN,
  transport: http(),
});

export const LAUNCHER_ABI = launcherAbi;
export const TOKEN_ABI = tokenAbi;

const buyEvent = parseAbiItem(
  'event Buy(address indexed token, address indexed buyer, uint256 monIn, uint256 tokensOut)'
);
const sellEvent = parseAbiItem(
  'event Sell(address indexed token, address indexed seller, uint256 tokensIn, uint256 monOut)'
);

export interface TokenSummary {
  address: Address;
  name: string;
  symbol: string;
  supply: bigint;
  reserve: bigint;
  price: bigint; // wei per whole token (marginal)
}

export async function getTokenCount(): Promise<bigint> {
  return (await publicClient.readContract({
    address: LAUNCHER_ADDRESS,
    abi: launcherAbi,
    functionName: 'tokenCount',
  })) as bigint;
}

export async function getTokenInfo(token: Address): Promise<TokenSummary | null> {
  const [info, price] = await Promise.all([
    publicClient.readContract({
      address: LAUNCHER_ADDRESS,
      abi: launcherAbi,
      functionName: 'tokens',
      args: [token],
    }),
    publicClient.readContract({
      address: LAUNCHER_ADDRESS,
      abi: launcherAbi,
      functionName: 'getPrice',
      args: [token],
    }),
  ]);
  const [exists, supply, reserve, name, symbol] = info as [
    boolean,
    bigint,
    bigint,
    string,
    string
  ];
  if (!exists) return null;
  return { address: token, name, symbol, supply, reserve, price: price as bigint };
}

export async function getAllTokens(): Promise<TokenSummary[]> {
  const count = Number(await getTokenCount());
  if (count === 0) return [];
  const addrs = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      publicClient.readContract({
        address: LAUNCHER_ADDRESS,
        abi: launcherAbi,
        functionName: 'allTokens',
        args: [BigInt(i)],
      }) as Promise<Address>
    )
  );
  const infos = await Promise.all(addrs.map((a) => getTokenInfo(a)));
  return infos.filter((t): t is TokenSummary => t !== null);
}

export async function quoteBuy(token: Address, monIn: bigint): Promise<bigint> {
  return (await publicClient.readContract({
    address: LAUNCHER_ADDRESS,
    abi: launcherAbi,
    functionName: 'quoteBuy',
    args: [token, monIn],
  })) as bigint;
}

export async function quoteSell(token: Address, tokenAmount: bigint): Promise<bigint> {
  return (await publicClient.readContract({
    address: LAUNCHER_ADDRESS,
    abi: launcherAbi,
    functionName: 'quoteSell',
    args: [token, tokenAmount],
  })) as bigint;
}

export async function getTokenBalance(token: Address, holder: Address): Promise<bigint> {
  return (await publicClient.readContract({
    address: token,
    abi: tokenAbi,
    functionName: 'balanceOf',
    args: [holder],
  })) as bigint;
}

export interface TradePoint {
  blockNumber: bigint;
  timestampMs: number;
  type: 'buy' | 'sell';
  monAmount: number; // MON float
  priceMon: number; // execution price per whole token, MON float
  txHash: string;
}

/** Chunked getLogs helper (Monad's 300ms blocks pile up logs fast). */
async function getLogsChunked(params: {
  event: AbiEvent;
  args: { token: Address };
  fromBlock: bigint;
  toBlock: bigint;
}) {
  const CHUNK = 2000n;
  const chunks: Array<Promise<unknown[]>> = [];
  for (let from = params.fromBlock; from <= params.toBlock; from += CHUNK + 1n) {
    const to = from + CHUNK > params.toBlock ? params.toBlock : from + CHUNK;
    chunks.push(
      publicClient.getLogs({
        address: LAUNCHER_ADDRESS,
        event: params.event,
        args: params.args,
        fromBlock: from,
        toBlock: to,
      }) as Promise<unknown[]>
    );
  }
  return (await Promise.all(chunks)).flat();
}

/**
 * Recent trades for a token (newest first, capped). Price per trade is the
 * execution price: monIn/tokensOut for buys, monOut/tokensIn for sells.
 */
export async function getRecentTrades(
  token: Address,
  maxBlocks = 30000n,
  limit = 120
): Promise<TradePoint[]> {
  const latest = await publicClient.getBlockNumber();
  const fromBlock = latest > maxBlocks ? latest - maxBlocks : 0n;

  const [buys, sells] = await Promise.all([
    getLogsChunked({ event: buyEvent, args: { token }, fromBlock, toBlock: latest }),
    getLogsChunked({ event: sellEvent, args: { token }, fromBlock, toBlock: latest }),
  ]);

  const points: TradePoint[] = [];
  for (const l of buys as Array<{
    blockNumber: bigint;
    transactionHash: string;
    args: { monIn: bigint; tokensOut: bigint };
  }>) {
    const priceWei = (l.args.monIn * 10n ** 18n) / l.args.tokensOut;
    points.push({
      blockNumber: l.blockNumber,
      timestampMs: 0,
      type: 'buy',
      monAmount: parseFloat(formatEther(l.args.monIn)),
      priceMon: parseFloat(formatEther(priceWei)),
      txHash: l.transactionHash,
    });
  }
  for (const l of sells as Array<{
    blockNumber: bigint;
    transactionHash: string;
    args: { monOut: bigint; tokensIn: bigint };
  }>) {
    const priceWei = (l.args.monOut * 10n ** 18n) / l.args.tokensIn;
    points.push({
      blockNumber: l.blockNumber,
      timestampMs: 0,
      type: 'sell',
      monAmount: parseFloat(formatEther(l.args.monOut)),
      priceMon: parseFloat(formatEther(priceWei)),
      txHash: l.transactionHash,
    });
  }

  points.sort((a, b) => (a.blockNumber > b.blockNumber ? -1 : 1));
  const trimmed = points.slice(0, limit);

  // Fill approximate timestamps: 300ms blocks on Monad.
  const now = Date.now();
  for (const p of trimmed) {
    const ageBlocks = Number(latest - p.blockNumber);
    p.timestampMs = now - ageBlocks * 300;
  }
  return trimmed;
}
