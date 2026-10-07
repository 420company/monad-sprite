// Official community gold verification badge: modeled on X's gold verification (gold serrated circular badge + white checkmark).
// Only for official communities created by platform admins in the backend (API field official === true); regular groups never show it.
// Placed right of the group name: group lists, group chat titles, token detail page community rankings, search results, community rankings.
import { useId } from 'react'
import { t } from '@/lib/i18n'

/** A serrated circle with 12 points (outer radius 12, inner radius 10.3, center 12,12) — the same silhouette as X's verification seal */
const SEAL = (() => {
  const pts: string[] = []
  for (let i = 0; i < 24; i++) {
    const r = i % 2 === 0 ? 11.6 : 9.9
    const a = (Math.PI / 12) * i - Math.PI / 2
    pts.push(`${(12 + r * Math.cos(a)).toFixed(2)},${(12 + r * Math.sin(a)).toFixed(2)}`)
  }
  return pts.join(' ')
})()

// label: the name screen readers announce (default: official-community label); the official announcement session passes its certified label
export default function OfficialBadge({ size = 16, className = '', label: labelProp }: { size?: number; className?: string; label?: string }) {
  const id = useId().replace(/:/g, '')
  const label = labelProp ?? t('官方社区')
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={label} className={`inline-block shrink-0 align-[-0.125em] ${className}`} data-official-badge="">
      <title>{label}</title>
      <defs>
        <linearGradient id={`ob-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F8D66A" />
          <stop offset="0.55" stopColor="#E2A93B" />
          <stop offset="1" stopColor="#C98A1E" />
        </linearGradient>
      </defs>
      <polygon points={SEAL} fill={`url(#ob-${id})`} stroke="#B97D17" strokeWidth="0.6" strokeLinejoin="round" />
      <path d="M7.4 12.3l3 3 6.2-6.4" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
