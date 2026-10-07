// Token icon: show an initial placeholder on load failure
import { useEffect, useState } from 'react'
import { resolveSolanaLogo } from '@/lib/logos'

/** src can be multiple candidate URLs joined by |: on load failure try the next one, show the first letter only when all fail */
export default function TokenLogo({ src, symbol, size = 40, chain, address }: { src?: string; symbol: string; size?: number; /** Chain and address given: after all static candidates fail, one more lookup by address is possible (Solana only for now) */ chain?: string; address?: string }) {
  const [resolved, setResolved] = useState<string | null>(null)
  const candidates = [...(src || '').split('|').map((x) => x.trim()).filter(Boolean), ...(resolved ? [resolved] : [])]
  const [idx, setIdx] = useState(0)
  const cur = candidates[idx]
  const exhausted = !cur
  useEffect(() => {
    if (!exhausted || resolved !== null || chain !== 'solana' || !address) return
    let alive = true
    resolveSolanaLogo(address).then((u) => { if (alive && u) setResolved(u) })
    return () => { alive = false }
  }, [exhausted, resolved, chain, address])
  if (!cur) {
    return (
      <div className="flex shrink-0 items-center justify-center rounded-full bg-card2 font-bold text-muted" style={{ width: size, height: size, fontSize: size * 0.4 }}>
        {symbol.slice(0, 1).toUpperCase()}
      </div>
    )
  }
  return <img key={cur} src={cur} alt={symbol} width={size} height={size} onError={() => setIdx((i) => i + 1)} className="shrink-0 rounded-full bg-card2 object-cover" style={{ width: size, height: size }} />
}
