/**
 * Monad testnet helpers for the agent backend.
 * Read-only: prices, portfolios. Writes happen client-side via MetaMask.
 */
import { createPublicClient, http, formatEther, type Address } from 'viem';
import { defineChain } from 'viem';

export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
});

const client = createPublicClient({
  chain: monadTestnet,
  transport: http('https://testnet-rpc.monad.xyz'),
});

export const LAUNCHER = '0x8ca1990c872b9f28f0dedc2ac9024dd6d1d2457f' as Address;

const LAUNCHER_ABI = [
  {
    name: 'tokens',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'exists', type: 'bool' },
      { name: 'supply', type: 'uint256' },
      { name: 'reserve', type: 'uint256' },
      { name: 'name', type: 'string' },
      { name: 'symbol', type: 'string' },
    ],
  },
  {
    name: 'tokenCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'allTokens',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'getPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'quoteBuy',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'monIn', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'quoteSell',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'tokenAmount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export interface TokenInfo {
  id: number;
  address: Address;
  name: string;
  symbol: string;
  reserveMON: string;
  reserveToken: string;
}

/** Find a token by symbol (case-insensitive) or address. */
export async function findToken(query: string): Promise<TokenInfo | null> {
  const tokens = await listTokens(50);
  const q = query.toLowerCase();
  return tokens.find((t) => t.symbol.toLowerCase() === q || t.address.toLowerCase() === q || t.name.toLowerCase() === q) ?? null;
}

export async function listTokens(limit = 20): Promise<TokenInfo[]> {
  const count = (await client.readContract({
    address: LAUNCHER,
    abi: LAUNCHER_ABI as any,
    functionName: 'tokenCount',
  })) as bigint;
  const out: TokenInfo[] = [];
  const start = count > BigInt(limit) ? count - BigInt(limit) : 0n;
  for (let i = count - 1n; i >= start && i >= 0n; i--) {
    const tokenAddr = (await client.readContract({
      address: LAUNCHER,
      abi: LAUNCHER_ABI as any,
      functionName: 'allTokens',
      args: [i],
    })) as Address;
    const r = (await client.readContract({
      address: LAUNCHER,
      abi: LAUNCHER_ABI as any,
      functionName: 'tokens',
      args: [tokenAddr],
    })) as unknown as [boolean, bigint, bigint, string, string];
    const [exists, supply, reserve, name, symbol] = r;
    if (!exists) continue;
    // Get price directly from the contract
    let priceStr = '0';
    try {
      const price = (await client.readContract({
        address: LAUNCHER,
        abi: LAUNCHER_ABI as any,
        functionName: 'getPrice',
        args: [tokenAddr],
      })) as bigint;
      priceStr = formatEther(price);
    } catch {
      /* price unavailable */
    }
    out.push({
      id: Number(i),
      address: tokenAddr,
      name,
      symbol,
      reserveMON: formatEther(reserve),
      reserveToken: formatEther(supply),
    });
  }
  return out;
}

export async function getMonBalance(wallet: Address): Promise<string> {
  const bal = await client.getBalance({ address: wallet });
  return formatEther(bal);
}

export async function getTokenBalance(token: Address, wallet: Address): Promise<string> {
  const bal = (await client.readContract({
    address: token,
    abi: ERC20_ABI as any,
    functionName: 'balanceOf',
    args: [wallet],
  })) as bigint;
  return formatEther(bal);
}

/** Approximate price: MON per token from bonding curve reserves. */
export function priceFromReserves(reserveMON: string, reserveToken: string): number {
  const m = parseFloat(reserveMON);
  const t = parseFloat(reserveToken);
  if (t <= 0) return 0;
  return m / t;
}
