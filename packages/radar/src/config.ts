import type { Address } from 'viem';

/** Chain config — flip to mainnet (id 143) once the hackathon deploy target is confirmed. */
export const CHAIN_ID = 10143;
export const RPC_URL = 'https://testnet-rpc.monad.xyz';
export const NATIVE_SYMBOL = 'MON';

/** Our MemeLauncher bonding-curve contract (Monad testnet). */
export const LAUNCHER_ADDRESS =
  '0x8ca1990c872b9f28f0dedc2ac9024dd6d1d2457f' as Address;

/** Signal weights for the composite score (see docs/rug-radar-scoring.md §3). */
export const WEIGHTS = {
  contract: 0.3,
  liquidity: 0.25,
  holders: 0.2,
  velocity: 0.15,
  creator: 0.1,
} as const;

/** In-memory cache TTL for score results. */
export const CACHE_TTL_MS = 5 * 60 * 1000;

/** Ring buffer size for GET /recent. */
export const RECENT_LIMIT = 50;

/** getLogs hygiene for Monad's 300ms blocks. */
export const LOG_CHUNK_BLOCKS = 2000n;
export const MAX_SCAN_BLOCKS = 50_000n;

/** HTTP server port (override with PORT env). */
export const PORT = Number(process.env.PORT ?? 8787);
