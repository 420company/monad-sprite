'use strict';
/**
 * chain.js —— Monad 链定义与 viem 客户端工厂
 *
 * testnet (10143) 是默认执行链；mainnet (143) 仅作开关预留。
 * RPC 可用环境变量 MONAD_TESTNET_RPC 覆盖。
 */
const { createPublicClient, createWalletClient, http, defineChain } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');

const LAUNCHER_ADDRESS = '0x8ca1990c872b9f28f0dedc2ac9024dd6d1d2457f'; // Monad testnet，已部署

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
 * 只有 live 模式才调。私钥只从环境变量 MONAD_PRIVATE_KEY 读，
 * 绝不写进代码/日志/仓库。
 */
function walletClient(chainId = 10143) {
  const pk = process.env.MONAD_PRIVATE_KEY;
  if (!pk) throw new Error('live 模式需要 MONAD_PRIVATE_KEY 环境变量');
  const chain = chainId === 143 ? monadMainnet : monadTestnet;
  const account = privateKeyToAccount(pk.startsWith('0x') ? pk : '0x' + pk);
  return { client: createWalletClient({ chain, transport: http(), account }), account };
}

module.exports = { monadTestnet, monadMainnet, LAUNCHER_ADDRESS, publicClient, walletClient };
