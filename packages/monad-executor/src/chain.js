'use strict';
/**
 * chain.js — Monad chain definitions and viem client factory
 *
 * testnet (10143) is the default execution chain; mainnet (143) reserved behind a flag.
 * RPC can be overridden with MONAD_TESTNET_RPC.
 */
const { createPublicClient, createWalletClient, http, defineChain } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');

const LAUNCHER_ADDRESS = '0x8ca1990c872b9f28f0dedc2ac9024dd6d1d2457f'; // Monad testnet, deployed

const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Testnet MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [process.env.MONAD_TESTNET_RPC || 'https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'MonadExplorer', url: 'https://testnet.monadexplorer.com' } },
  testnet: true,
});

const monadMainnet = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [process.env.MONAD_MAINNET_RPC || 'https://rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'MonadExplorer', url: 'https://monadexplorer.com' } },
});

function publicClient(chainId = 10143) {
  const chain = chainId === 143 ? monadMainnet : monadTestnet;
  return createPublicClient({ chain, transport: http() });
}

/**
 * Only called in live mode. The private key is read from the MONAD_PRIVATE_KEY
 * environment variable only — never written into code, logs, or the repo.
 */
function walletClient(chainId = 10143) {
  const pk = process.env.MONAD_PRIVATE_KEY;
  if (!pk) throw new Error('live mode requires the MONAD_PRIVATE_KEY environment variable');
  const chain = chainId === 143 ? monadMainnet : monadTestnet;
  const account = privateKeyToAccount(pk.startsWith('0x') ? pk : '0x' + pk);
  return { client: createWalletClient({ chain, transport: http(), account }), account };
}

module.exports = { monadTestnet, monadMainnet, LAUNCHER_ADDRESS, publicClient, walletClient };
