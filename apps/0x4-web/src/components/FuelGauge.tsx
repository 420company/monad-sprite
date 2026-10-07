// Gas-fee fuel gauge icon (2026-09-29 goat: "like a car dashboard showing remaining fuel", three levels low / middle / high).
// A half-dial split into three arcs (left red, middle yellow, right green); the needle points at the current level, the current arc lit and the other two dimmed; a small circle at the dial's heart (thin needle, thick dial — never looks like a letter even when vertical at the low end).
// Without level it's a monochrome middle level, for menu-like spots that only stand for "gas fees".
import type { FuelLevel } from '@/lib/gas'
import { t } from '@/lib/i18n'

const COLOR: Record<FuelLevel, string> = { low: 'var(--color-down)', middle: 'var(--color-warning)', high: 'var(--color-up)' }
// The three arcs' spans on the dial (angles from straight up, negative left / positive right), with a 4-degree gap between them
const SEG: Record<FuelLevel, [number, number]> = { low: [-78, -30], middle: [-26, 26], high: [30, 78] }
const NEEDLE: Record<FuelLevel, number> = { low: -54, middle: 0, high: 54 }
const CX = 12, CY = 16, R = 9

const at = (deg: number, r = R) => {
  const a = (deg * Math.PI) / 180
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)] as const
}
const arc = ([from, to]: [number, number]) => {
  const [x1, y1] = at(from), [x2, y2] = at(to)
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

export function fuelLabel(level: FuelLevel): string {
  return level === 'low' ? t('燃料费不足') : level === 'middle' ? t('燃料费偏低') : t('燃料费充足')
}

export default function FuelGauge({ level, size = 22, className = '' }: { level?: FuelLevel; size?: number; className?: string }) {
  const active = level ?? 'middle'
  const [nx, ny] = at(NEEDLE[active], R - 2.4)
  const label = level ? fuelLabel(level) : t('燃料费')
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-label={label} data-fuel-level={level ?? 'none'} className={`shrink-0 ${className}`}>
      <title>{label}</title>
      {(Object.keys(SEG) as FuelLevel[]).map((k) => (
        <path key={k} d={arc(SEG[k])} strokeWidth={2.6} strokeLinecap="round"
          style={{ stroke: level ? COLOR[k] : 'currentColor', opacity: k === active ? 1 : 0.22 }} />
      ))}
      <path d={`M ${CX} ${CY} L ${nx.toFixed(2)} ${ny.toFixed(2)}`} strokeWidth={1.5} strokeLinecap="round" style={{ stroke: level ? COLOR[active] : 'currentColor' }} />
      <circle cx={CX} cy={CY} r={1.7} style={{ fill: level ? COLOR[active] : 'currentColor' }} />
    </svg>
  )
}
