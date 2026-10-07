import { defineChain } from 'viem';

/**
 * Chain config — single place to flip networks.
 * Currently Monad testnet (10143). When the hackathon confirms the deploy
 * target, set ACTIVE_CHAIN = monadMainnet and add the mainnet launcher address.
 */
export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { decimals: 18, name: 'MON', symbol: 'MON' },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: {
    default: { name: 'MonadVision', url: 'https://testnet.monadexplorer.com' },
  },
  testnet: true,
});

export const monadMainnet = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { decimals: 18, name: 'MON', symbol: 'MON' },
  rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } },
  blockExplorers: {
    default: { name: 'MonadVision', url: 'https://monadvision.com' },
  },
});

export const ACTIVE_CHAIN = monadTestnet;

export const LAUNCHER_ADDRESSES: Record<number, `0x${string}`> = {
  10143: '0x8ca1990c872b9f28f0dedc2ac9024dd6d1d2457f',
  // 143: '0x…', // mainnet MemeLauncher deploy TBD
};

export const LAUNCHER_ADDRESS = LAUNCHER_ADDRESSES[ACTIVE_CHAIN.id];

/** Rug Radar scoring API (the ../radar service). */
export const RADAR_API_URL =
  process.env.NEXT_PUBLIC_RADAR_API_URL ?? 'http://localhost:8787';

export const explorerTx = (hash: string) =>
  `${ACTIVE_CHAIN.blockExplorers!.default.url}/tx/${hash}`;

export const explorerAddress = (addr: string) =>
  `${ACTIVE_CHAIN.blockExplorers!.default.url}/address/${addr}`;
