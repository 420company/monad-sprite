import type { Address } from 'viem';

export type RiskBand = 'LOW' | 'MEDIUM' | 'HIGH';

export interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

/** Output of one risk signal. score === null means "pending" (not enough data). */
export interface SignalResult {
  signal: string;
  score: number | null;
  flags: string[];
  checks: CheckResult[];
}

export interface TransferLog {
  from: Address;
  to: Address;
  value: bigint;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
}

export interface TokenContext {
  token: Address;
  isLauncherToken: boolean;
  creator: Address | null;
  creationBlock: bigint | null;
  totalSupply: bigint | null;
}

export interface ScoreResponse {
  tokenAddress: Address;
  chainId: number;
  score: number | null;
  band: RiskBand | null;
  flags: string[];
  breakdown: Record<string, number | null>;
  verdict: string;
  checksPassed: number;
  checksTotal: number;
  scannedAt: string;
  cached?: boolean;
}
