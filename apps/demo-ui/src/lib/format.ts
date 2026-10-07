import { formatEther } from 'viem';

/** wei -> human MON string, trimmed. */
export function fmtMon(wei: bigint, digits = 4): string {
  const s = formatEther(wei);
  const [i, f = ''] = s.split('.');
  const frac = f.slice(0, digits).replace(/0+$/, '');
  return frac ? `${i}.${frac}` : i;
}

/** Token base units (18dp) -> human string. */
export function fmtTokens(units: bigint, digits = 2): string {
  const s = formatEther(units);
  const [i, f = ''] = s.split('.');
  const withCommas = Number(i).toLocaleString('en-US');
  const frac = f.slice(0, digits).replace(/0+$/, '');
  return frac ? `${withCommas}.${frac}` : withCommas;
}

/** 0x1234…abcd */
export function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

/** "2m ago", "3h ago" … */
export function timeAgo(tsMs: number): string {
  const s = Math.max(1, Math.floor((Date.now() - tsMs) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
