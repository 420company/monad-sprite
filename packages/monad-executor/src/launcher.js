'use strict';
/**
 * launcher.js —— MemeLauncher 合约读写封装（只读走 publicClient，写走 walletClient）
 *
 * 关键细节（已核实）：
 *  - sell() 无需预先 approve：MemeToken.burnFrom 只校验 onlyLauncher
 *  - buy() 的 dust refund 合约自动处理
 */
const { formatEther, parseEther } = require('viem');
const { publicClient, walletClient, LAUNCHER_ADDRESS } = require('./chain');
const launcherAbi = require('./launcherAbi.json');
const tokenAbi = require('./tokenAbi.json');

const L = () => LAUNCHER_ADDRESS;

// ---------- 读 ----------
async function getTokenCount(chainId = 10143) {
  return publicClient(chainId).readContract({ address: L(), abi: launcherAbi, functionName: 'tokenCount' });
}

async function getTokenInfo(token, chainId = 10143) {
  const c = publicClient(chainId);
  const [info, price] = await Promise.all([
    c.readContract({ address: L(), abi: launcherAbi, functionName: 'tokens', args: [token] }),
    c.readContract({ address: L(), abi: launcherAbi, functionName: 'getPrice', args: [token] }),
  ]);
  const [exists, supply, reserve, name, symbol] = info;
  if (!exists) return null;
  return { address: token, name, symbol, supply, reserve, price };
}

async function getAllTokens(chainId = 10143) {
  const count = Number(await getTokenCount(chainId));
  const out = [];
  for (let i = 0; i < count; i++) {
    const addr = await publicClient(chainId).readContract({
      address: L(), abi: launcherAbi, functionName: 'allTokens', args: [BigInt(i)],
    });
    const info = await getTokenInfo(addr, chainId);
    if (info) out.push(info);
  }
  return out;
}

async function quoteBuy(token, monInWei, chainId = 10143) {
  return publicClient(chainId).readContract({
    address: L(), abi: launcherAbi, functionName: 'quoteBuy', args: [token, monInWei],
  });
}

async function quoteSell(token, tokenAmountWei, chainId = 10143) {
  return publicClient(chainId).readContract({
    address: L(), abi: launcherAbi, functionName: 'quoteSell', args: [token, tokenAmountWei],
  });
}

async function tokenBalance(token, holder, chainId = 10143) {
  return publicClient(chainId).readContract({
    address: token, abi: tokenAbi, functionName: 'balanceOf', args: [holder],
  });
}

// ---------- 写（仅 live） ----------
async function buyTx(token, monInWei, chainId = 10143) {
  const { client } = walletClient(chainId);
  const hash = await client.writeContract({
    address: L(), abi: launcherAbi, functionName: 'buy', args: [token], value: monInWei,
  });
  const receipt = await publicClient(chainId).waitForTransactionReceipt({ hash });
  return { hash, receipt };
}

async function sellTx(token, tokenAmountWei, chainId = 10143) {
  const { client } = walletClient(chainId);
  const hash = await client.writeContract({
    address: L(), abi: launcherAbi, functionName: 'sell', args: [token, tokenAmountWei],
  });
  const receipt = await publicClient(chainId).waitForTransactionReceipt({ hash });
  return { hash, receipt };
}

module.exports = {
  LAUNCHER_ADDRESS, getTokenCount, getTokenInfo, getAllTokens,
  quoteBuy, quoteSell, tokenBalance, buyTx, sellTx, formatEther, parseEther,
};
