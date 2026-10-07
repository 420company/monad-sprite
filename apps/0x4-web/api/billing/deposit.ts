/**
 * POST /api/billing/deposit — claim USDT deposits.
 * Body: { wallet: "0x..." }
 *
 * Scans BSC for USDT transfers to DEPOSIT_ADDRESS from the user's wallet,
 * credits 1 USDT = $1.00. Prevents double-claim via tx hash.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createPublicClient, http, parseAbiItem, type Address } from 'viem';
import { bsc } from 'viem/chains';
import { addCredit, isClaimed, markClaimed, getBalance } from '../_lib/billing.js';

const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955' as Address;

function depositAddress(): Address {
  const a = process.env.DEPOSIT_ADDRESS;
  if (!a || !a.startsWith('0x')) throw new Error('DEPOSIT_ADDRESS not configured');
  return a as Address;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { wallet } = req.body ?? {};
    if (!wallet || !String(wallet).startsWith('0x')) {
      return res.status(400).json({ error: 'wallet required' });
    }
    const user = String(wallet).toLowerCase();
    const deposit = depositAddress();

    const client = createPublicClient({ chain: bsc, transport: http('https://bsc-dataseed.binance.org') });

    // Last ~50k blocks (~2-3 days). For older deposits, user contacts support.
    const latest = await client.getBlockNumber();
    const fromBlock = latest - 50000n;

    const logs = await client.getLogs({
      address: USDT_BSC,
      event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
      args: { from: user as Address, to: deposit },
      fromBlock,
      toBlock: latest,
    });

    let credited = 0;
    const newClaims: string[] = [];
    for (const log of logs) {
      const txHash = log.transactionHash!;
      if (isClaimed(txHash)) continue;
      const usdt = Number(log.args.value!) / 1e18;
      if (usdt <= 0) continue;
      markClaimed(txHash);
      addCredit(user, usdt);
      credited += usdt;
      newClaims.push(txHash);
    }

    return res.status(200).json({
      credited_usd: Math.round(credited * 100) / 100,
      new_claims: newClaims.length,
      balance_usd: getBalance(user),
      deposit_address: deposit,
    });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message.slice(0, 300) });
  }
}
