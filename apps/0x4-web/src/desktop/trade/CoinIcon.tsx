// 合约币种图标（网页版合约终端）：先试两家公开图标库，都没有就用首字母 + 按币名算的固定颜色。
// 原来依次试四家（2026-09-29 实测其中一家域名在国内解析不了、一家大多 404），每个币最多报 4 条加载失败，
// 合约列表一展开控制台几十条红字。现在只留实测覆盖最多的两家，并且记住失败过的，同一个币不再重试。
import { useEffect, useMemo, useState } from 'react'

const BRAND: Record<string, string> = { BTC: '#f7931a', ETH: '#627eea', BNB: '#f3ba2f', SOL: '#14f195', XRP: '#9aa4ad', DOGE: '#c2a633', ASTER: '#8cff4d' }
/** 这一次打开网页里已经确认没有图标的币：直接画首字母，不再发请求 */
const missing = new Set<string>()
/** 已经成功加载过的地址：列表来回滚动时直接用 */
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
