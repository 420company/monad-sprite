import { RADAR_API_URL } from '../config';

export type Band = 'LOW' | 'MEDIUM' | 'HIGH';

export interface RadarScore {
  tokenAddress: string;
  chainId: number;
  score: number;
  band: Band;
  flags: string[];
  breakdown: Record<string, number | null>;
  verdict: string;
  checksPassed: number;
  checksTotal: number;
  scannedAt: string;
}

export async function fetchScore(tokenAddress: string): Promise<RadarScore> {
  const res = await fetch(`${RADAR_API_URL}/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tokenAddress }),
  });
  if (!res.ok) throw new Error(`Radar API ${res.status}`);
  return (await res.json()) as RadarScore;
}

export async function fetchRecentScores(): Promise<RadarScore[]> {
  const res = await fetch(`${RADAR_API_URL}/recent`);
  if (!res.ok) throw new Error(`Radar API ${res.status}`);
  return (await res.json()) as RadarScore[];
}

export async function radarHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${RADAR_API_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
