// 礼物贴纸图标：按礼物 id 画内联 SVG，外面一圈白边 + 一圈淡投影，亮 / 暗背景都看得清
import { useId } from 'react'
import { FALLBACK_ART, GIFT_ART } from './art'

/** 礼物显示名（简体原文，渲染时再 t()）。id 是历史送礼记录的主键，不能改，名字在前端按 id 映射 */
export const GIFT_NAMES: Record<string, string> = {
  rose: '韭菜',
  beer: '大阳线',
  fire: '冲',
  rocket: '火箭',
  moon: '登月',
  diamond: '钻石手',
  whale: '巨鲸',
  lambo: '兰博',
}

/** 礼物名：已知 id 用新名字，未知的退回服务器给的名字 */
export function giftName(id: string | undefined | null, fallback = '礼物'): string {
  return (id && GIFT_NAMES[id]) || fallback
}

/** 送礼文字里的礼物名换成前端这套名字。旧消息是「emoji+名字」（比如「🌹玫瑰」），
 *  2026-09-25 起服务器只发名字，两种都认；emoji 一律去掉 */
export function giftText(text: string, meta: { giftId?: unknown; emoji?: unknown; name?: unknown }): string {
  const id = typeof meta.giftId === 'string' ? meta.giftId : ''
  const emoji = typeof meta.emoji === 'string' ? meta.emoji : ''
  if (!GIFT_NAMES[id] || typeof meta.name !== 'string') return emoji ? text.replace(emoji, '') : text
  if (emoji && text.includes(emoji + meta.name)) return text.replace(emoji + meta.name, GIFT_NAMES[id])
  // 新格式：名字紧跟在「个」后面，锚住它，免得撞到昵称里的同名字样
  return text.replace(`个${meta.name}`, `个${GIFT_NAMES[id]}`)
}

export function GiftIcon({ id, size = 32, className, title }: { id?: string | null; size?: number; className?: string; title?: string }) {
  const p = 'g' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const { sil, art } = ((id && GIFT_ART[id]) || FALLBACK_ART)(p)
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} role="img" aria-label={title} aria-hidden={title ? undefined : true} style={{ flexShrink: 0, overflow: 'visible' }}>
      {title && <title>{title}</title>}
      <g transform="translate(0 1.3)" fill="#1a1b20" stroke="#1a1b20" opacity=".22" strokeWidth={8.5} strokeLinejoin="round" strokeLinecap="round">{sil(8.5)}</g>
      <g fill="#fff" stroke="#fff" strokeWidth={6} strokeLinejoin="round" strokeLinecap="round">{sil(6)}</g>
      {art}
    </svg>
  )
}

export default GiftIcon
