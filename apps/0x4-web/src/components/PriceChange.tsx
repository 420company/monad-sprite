import { fmtPct } from '@/lib/format'

export default function PriceChange({ value, className = '' }: { value?: number; className?: string }) {
  const color = value === undefined || value === null ? 'text-muted' : value > 0 ? 'text-up' : value < 0 ? 'text-down' : 'text-muted'
  return <span className={`${color} ${className}`}>{fmtPct(value)}</span>
}
