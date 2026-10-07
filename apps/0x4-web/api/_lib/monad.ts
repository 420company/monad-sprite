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
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'token', type: 'address' },
      { name: 'name', type: 'string' },
      { name: 'symbol', type: 'string' },
      { name: 'reserveMON', type: 'uint256' },
      { name: 'reserveToken', type: 'uint256' },
      { name: 'exists', type: 'bool' },
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
    name: 'getBuyQuote',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'monIn', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getSellQuote',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'tokenIn', type: 'uint256' },
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
  const count = (await client.readContract({
    address: LAUNCHER,
    abi: LAUNCHER_ABI as any,
    functionName: 'tokenCount',
  })) as bigint;
  const q = query.toLowerCase();
  for (let i = 1n; i <= count; i++) {
    const r = (await client.readContract({
      address: LAUNCHER,
      abi: LAUNCHER_ABI as any,
      functionName: 'tokens',
      args: [i],
    })) as unknown as [Address, string, string, bigint, bigint, boolean];
    const [token, name, symbol, reserveMON, reserveToken, exists] = r;
    if (!exists) continue;
    if (symbol.toLowerCase() === q || token.toLowerCase() === q || name.toLowerCase() === q) {
      return {
        id: Number(i),
        address: token,
        name,
        symbol,
        reserveMON: formatEther(reserveMON),
        reserveToken: formatEther(reserveToken),
      };
    }
  }
  return null;
}

export async function listTokens(limit = 20): Promise<TokenInfo[]> {
  const count = (await client.readContract({
    address: LAUNCHER,
    abi: LAUNCHER_ABI as any,
    functionName: 'tokenCount',
  })) as bigint;
  const out: TokenInfo[] = [];
  const start = count > BigInt(limit) ? count - BigInt(limit) + 1n : 1n;
  for (let i = count; i >= start && i >= 1n; i--) {
    const r = (await client.readContract({
      address: LAUNCHER,
      abi: LAUNCHER_ABI as any,
      functionName: 'tokens',
      args: [i],
    })) as unknown as [Address, string, string, bigint, bigint, boolean];
    const [token, name, symbol, reserveMON, reserveToken, exists] = r;
    if (!exists) continue;
    out.push({
      id: Number(i),
      address: token,
      name,
      symbol,
      reserveMON: formatEther(reserveMON),
      reserveToken: formatEther(reserveToken),
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
