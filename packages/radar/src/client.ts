import { createPublicClient, defineChain, http } from 'viem';
import { CHAIN_ID, NATIVE_SYMBOL, RPC_URL } from './config.js';

export const monadChain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 10143 ? 'Monad Testnet' : 'Monad',
  nativeCurrency: { name: NATIVE_SYMBOL, symbol: NATIVE_SYMBOL, decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

/** Shared read-only public client. No wallet, no signing — never. */
export const publicClient = createPublicClient({
  chain: monadChain,
  transport: http(RPC_URL, { timeout: 30_000 }),
});

export type PublicClient = typeof publicClient;
