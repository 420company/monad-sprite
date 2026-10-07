// Formatting utilities for numbers, amounts and addresses
import { t } from '@/lib/i18n'

/** USD amounts: large numbers use K/M/B shorthand, decimals show per precision */
/** Wallet amounts: balances, margins, fees, P&L. Always two decimals.
 *
 *  Don't display these with fmtUsd — for numbers under 1 it takes the "token price" branch,
 *  designed to render tiny prices like BONK's $0.00001234 clearly. On account balances it would show
 *  "available margin $0.036576", which looks unprofessional at a glance. */
export function fmtMoney(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '--'
  if (n === 0) return '$0.00'
  // Balances under a cent: the exact value is meaningless, it reads as "basically nothing"
  if (Math.abs(n) < 0.005) return n > 0 ? '<$0.01' : '>-$0.01'
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtUsd(n: number | undefined | null, opts: { compact?: boolean } = {}): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '--'
  const abs = Math.abs(n)
  if (opts.compact) {
    if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
    if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
    if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  }
  if (abs >= 1) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (abs === 0) return '$0.00'
  // Token prices under $1: show enough significant digits; ultra-small prices use the subscript form 0.0₅123
  if (abs < 0.0001) {
    const s = abs.toExponential(3) // e.g. 1.234e-7
    const [mant, exp] = s.split('e')
    const zeros = Math.abs(Number(exp)) - 1
    const digits = mant.replace('.', '').slice(0, 4)
    const sub = String(zeros).replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)])
    return `${n < 0 ? '-' : ''}$0.0${sub}${digits}`
  }
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`
}

/** Token amounts */
export function fmtAmount(n: number | undefined | null, maxDigits = 4): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '--'
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e4) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return n.toLocaleString('en-US', { maximumFractionDigits: maxDigits })
}

/** Percentage change, with sign */
export function fmtPct(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '--'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

/** Address shorthand: AbCd…WxYz */
/** Short form for addresses shown as names: first 5 + last 3 (e.g. 0x420…000, goat's call 2026-09-25). Fallback only when the profile has no nickname; the server's default nickname since 2026-09-29 is User + number (server/src/userSeq.ts) */
export function shortId(addr: string): string {
  if (!addr) return ''
  return addr.length <= 9 ? addr : `${addr.slice(0, 5)}…${addr.slice(-3)}`
}

export function shortAddr(addr: string, n = 4): string {
  if (!addr) return ''
  if (addr.length <= n * 2 + 1) return addr
  return `${addr.slice(0, n)}…${addr.slice(-n)}`
}

/** Relative time: minutes / hours / days ago */
export function timeAgo(ts?: number | null): string {
  if (!ts) return '--'
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return t('刚刚')
  if (m < 60) return t('{n} 分钟前', { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('{n} 小时前', { n: h })
  const d = Math.floor(h / 24)
  if (d < 30) return t('{n} 天前', { n: d })
  const mo = Math.floor(d / 30)
  if (mo < 12) return t('{n} 个月前', { n: mo })
  return t('{n} 年前', { n: Math.floor(mo / 12) })
}

/** Convert user-entered decimal amounts to smallest units (avoiding float error) */
export function toBaseUnits(amount: string | number, decimals: number): bigint {
  const s = String(amount).trim()
  if (!s || Number.isNaN(Number(s))) return 0n
  const [int, frac = ''] = s.split('.')
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals)
  return BigInt(int || '0') * 10n ** BigInt(decimals) + BigInt(fracPadded || '0')
}

/** Smallest units back to decimal amounts */
export function fromBaseUnits(raw: bigint | number | string, decimals: number): number {
  return Number(raw) / 10 ** decimals
}

/** Token names in perp feed / trade records are assembled at write time as "<SYM> <direction> <lev>" (stored on the server); swap the direction word per the current language at display time */
export function sideLabel(symbol: string): string {
  return symbol.replace(/(^|\s)(多|空)(?=\s|$)/g, (_m, pre: string, side: string) => pre + t(side))
}
