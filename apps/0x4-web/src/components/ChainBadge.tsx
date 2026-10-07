// Chain identifier badge
import { chainById } from '@/lib/chains'

export default function ChainBadge({ chainId, className = '' }: { chainId: number; className?: string }) {
  const c = chainById(chainId)
  if (!c) return null
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-card2 px-1.5 py-0.5 text-[10px] text-muted ${className}`}>
      <img src={c.logo} alt="" className="h-3 w-3 rounded-full" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
      {c.name}
    </span>
  )
}
