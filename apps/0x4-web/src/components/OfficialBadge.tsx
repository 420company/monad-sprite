// 官方社区金色认证标：参考 X 的金色认证（金色锯齿圆形徽章 + 白色对勾）。
// 只给平台管理员在后台建的官方社区用（接口字段 official === true），普通群永远不显示。
// 放在群名右边：群列表、群聊标题、币详情页社区榜单、搜索结果、社区排行。
import { useId } from 'react'
import { t } from '@/lib/i18n'

/** 12 个尖角的锯齿圆（外半径 12、内半径 10.3，中心 12,12），和 X 的认证章同一个轮廓 */
const SEAL = (() => {
  const pts: string[] = []
  for (let i = 0; i < 24; i++) {
    const r = i % 2 === 0 ? 11.6 : 9.9
    const a = (Math.PI / 12) * i - Math.PI / 2
    pts.push(`${(12 + r * Math.cos(a)).toFixed(2)},${(12 + r * Math.sin(a)).toFixed(2)}`)
  }
  return pts.join(' ')
})()

// label：读屏念的名字，默认「官方社区」；「0x4 官方」公告会话传「0x4 官方认证」
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
