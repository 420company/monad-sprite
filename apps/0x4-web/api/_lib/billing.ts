/**
 * USDT billing: users deposit USDT (BSC) → get USD credit → agent deducts per use.
 *
 * 1 USDT = $1.00 credit. Costs computed from pricing.ts × config.priceMarkup.
 * In-memory on serverless. On VPS product this becomes SQLite.
 */

import { getPrice } from './pricing.js';
import { getConfig } from './config.js';

export interface UsageRecord {
  wallet: string;
  model: string;
  kind: 'chat' | 'image' | 'video' | 'tts';
  cost: number; // USD deducted
  ts: number;
}

// wallet -> balance USD
const balances = new Map<string, number>();
// wallet -> txHash claimed (prevent double-credit)
const claimedTx = new Set<string>();
// recent usage log (last 1000)
const usageLog: UsageRecord[] = [];

export function getBalance(wallet: string): number {
  return balances.get(wallet.toLowerCase()) ?? 0;
}

export function addCredit(wallet: string, usd: number): number {
  const w = wallet.toLowerCase();
  const next = (balances.get(w) ?? 0) + usd;
  balances.set(w, Math.round(next * 10000) / 10000);
  return balances.get(w)!;
}

export function isClaimed(txHash: string): boolean {
  return claimedTx.has(txHash.toLowerCase());
}

export function markClaimed(txHash: string): void {
  claimedTx.add(txHash.toLowerCase());
}

/**
 * Calculate USD cost for a model usage.
 * Chat: (promptTokens × inPrice + completionTokens × outPrice) / 1M × markup
 * Image: costPerImage × markup
 * Video: costPerSecond × seconds × markup
 * TTS: ~$0.0005 per 100 chars × markup (estimate)
 */
export function calcCost(opts: {
  model: string;
  kind: 'chat' | 'image' | 'video' | 'tts';
  promptTokens?: number;
  completionTokens?: number;
  seconds?: number;
  chars?: number;
}): number {
  const markup = getConfig().priceMarkup;
  const price = getPrice(opts.model);

  let base = 0;
  if (opts.kind === 'chat' && price?.unit === '1M') {
    base =
      ((opts.promptTokens || 0) * price.costIn + (opts.completionTokens || 0) * price.costOut) / 1_000_000;
  } else if (opts.kind === 'image') {
    base = price?.unit === 'img' ? price.costIn : 0.036; // fallback
  } else if (opts.kind === 'video') {
    const perSec = price?.unit === 's' ? price.costIn : 0.034;
    base = perSec * (opts.seconds || 5);
  } else if (opts.kind === 'tts') {
    base = ((opts.chars || 100) / 100) * 0.0005;
  }

  return Math.round(base * markup * 10000) / 10000;
}

/**
 * Deduct cost from wallet balance. Returns { ok, cost, balance }.
 * If balance insufficient, returns { ok: false }.
 */
export function deduct(
  wallet: string,
  cost: number,
  meta: { model: string; kind: UsageRecord['kind'] },
): { ok: boolean; cost: number; balance: number } {
  const w = wallet.toLowerCase();
  const bal = balances.get(w) ?? 0;
  if (bal < cost) {
    return { ok: false, cost, balance: bal };
  }
  const next = Math.round((bal - cost) * 10000) / 10000;
  balances.set(w, next);
  usageLog.push({ wallet: w, model: meta.model, kind: meta.kind, cost, ts: Date.now() });
  if (usageLog.length > 1000) usageLog.splice(0, usageLog.length - 1000);
  return { ok: true, cost, balance: next };
}

export function getUsage(wallet: string, limit = 20): UsageRecord[] {
  const w = wallet.toLowerCase();
  return usageLog.filter((r) => r.wallet === w).slice(-limit).reverse();
}

/** Free tier: new wallets get $1 credit to try */
export function ensureFreeTier(wallet: string): number {
  const w = wallet.toLowerCase();
  if (!balances.has(w)) {
    balances.set(w, 1.0);
  }
  return balances.get(w)!;
}
