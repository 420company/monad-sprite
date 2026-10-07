'use strict';
/**
 * launcher.js — MemeLauncher contract read/write wrapper (reads via publicClient, writes via walletClient)
 *
 * Verified details:
 *  - sell() needs no pre-approve: MemeToken.burnFrom only checks onlyLauncher
 *  - buy() dust refunds are handled by the contract automatically
 */
const { formatEther, parseEther } = require('viem');
const { publicClient, walletClient, LAUNCHER_ADDRESS } = require('./chain');
const launcherAbi = require('./launcherAbi.json');
const tokenAbi = require('./tokenAbi.json');

const L = () => LAUNCHER_ADDRESS;

// ---------- reads ----------
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

// ---------- writes (live only) ----------
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
