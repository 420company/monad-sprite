// 燃料费油量表图标（2026-09-29 goat：「像汽车仪表盘显示汽油余量那样」，三档 low / middle / high）。
// 半圆表盘分三段（左红、中黄、右绿），指针指向当前档位，当前那段点亮，其余两段调暗；表心一个小圆（指针细、表盘粗，偏低档竖直时也不像字母）。
// 不传 level 时是单色的中间档，给菜单这类只表示「燃料费」的地方用。
import type { FuelLevel } from '@/lib/gas'
import { t } from '@/lib/i18n'

const COLOR: Record<FuelLevel, string> = { low: 'var(--color-down)', middle: 'var(--color-warning)', high: 'var(--color-up)' }
// 三段在表盘上的范围（从正上方起算的角度，左负右正），中间留 4 度空隙
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
