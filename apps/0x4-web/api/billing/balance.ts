/**
 * GET /api/billing/balance?wallet=0x... — get credit balance + recent usage.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBalance, getUsage, ensureFreeTier } from '../_lib/billing.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const wallet = String(req.query.wallet || '');
  if (!wallet.startsWith('0x')) return res.status(400).json({ error: 'wallet required' });

  // New users get $1 free trial credit
  const balance = ensureFreeTier(wallet);

  return res.status(200).json({
    balance_usd: balance,
    usage: getUsage(wallet, 20),
    deposit_address: process.env.DEPOSIT_ADDRESS || null,
  });
}
