import { CACHE_TTL_MS, RECENT_LIMIT } from './config.js';
import type { ScoreResponse } from './types.js';

interface CacheEntry {
  result: ScoreResponse;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const recent: ScoreResponse[] = [];

function key(address: string): string {
  return address.toLowerCase();
}

export function getCached(address: string): ScoreResponse | null {
  const entry = cache.get(key(address));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key(address));
    return null;
  }
  return { ...entry.result, cached: true };
}

export function setCached(result: ScoreResponse): void {
  cache.set(key(result.tokenAddress), {
    result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  recent.unshift(result);
  if (recent.length > RECENT_LIMIT) recent.length = RECENT_LIMIT;
}

export function getRecent(): ScoreResponse[] {
  return recent;
}

export function cacheSize(): number {
  return cache.size;
}
