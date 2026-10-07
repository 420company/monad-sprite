// Perp coin icons (web perp terminal): try two public icon libraries first, fall back to first letter + a deterministic color derived from the coin name.
// It used to try four providers in order (2026-09-29 measured: one domain doesn't resolve in China, another mostly 404s), each coin reporting up to 4 load failures,
// Expanding the perp list used to flood the console with errors. Now only the two best-tested providers remain, and failed ones are remembered — no retry for the same coin.
import { useEffect, useMemo, useState } from 'react'

const BRAND: Record<string, string> = { BTC: '#f7931a', ETH: '#627eea', BNB: '#f3ba2f', SOL: '#14f195', XRP: '#9aa4ad', DOGE: '#c2a633', ASTER: '#8cff4d' }
/** Coins already confirmed icon-less in this web session: draw the initial directly, no more requests */
const missing = new Set<string>()
/** Addresses already loaded successfully: reuse directly when the list scrolls back and forth */
const found = new Map<string, string>()

function urlsOf(coin: string): string[] {
  const base = coin.replace(/^(1000000|10000|1000|1M|K)(?=[A-Z])/, '')
  const names = [...new Set([coin, base])].filter((n) => /^[A-Z0-9]+$/.test(n))
  return [
    ...names.map((n) => `https://bin.bnbstatic.com/static/assets/logos/${n}.png`),
    ...names.map((n) => `https://app.hyperliquid.xyz/coins/${n}.svg`),
  ]
}

export default function CoinIcon({ coin, size }: { coin: string; size: number }) {
  const urls = useMemo(() => (missing.has(coin) ? [] : found.has(coin) ? [found.get(coin)!] : urlsOf(coin)), [coin])
  const [i, setI] = useState(0)
  useEffect(() => setI(0), [coin])
  if (i < urls.length) {
    return <img src={urls[i]} alt="" aria-hidden="true" width={size} height={size} className="tx-coin" style={{ width: size, height: size }}
      onLoad={() => found.set(coin, urls[i])}
      onError={() => { if (i + 1 >= urls.length) missing.add(coin); setI((n) => n + 1) }} />
  }
  let h = 0
  for (const ch of coin) h = (h * 31 + ch.charCodeAt(0)) % 360
  const color = BRAND[coin] || `hsl(${h} 55% 62%)`
  return <span className="tx-coin tx-coin-txt" style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: `color-mix(in srgb, ${color} 16%, transparent)`, color }} aria-hidden="true">{coin.slice(0, 2)}</span>
}
