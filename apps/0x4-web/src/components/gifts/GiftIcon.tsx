// Gift sticker icons: inline SVG drawn per gift id, with a white outline ring + a soft shadow ring — legible on light and dark backgrounds
import { useId } from 'react'
import { FALLBACK_ART, GIFT_ART } from './art'

/** Gift display name (simplified-Chinese source, t() at render time). id is the primary key of historical gift records and must not change; names map per id on the frontend */
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

/** Gift name: known ids use the new name; unknown ones fall back to the server's name */
export function giftName(id: string | undefined | null, fallback = '礼物'): string {
  return (id && GIFT_NAMES[id]) || fallback
}

/** Swap the gift name in gifting text to this frontend set of names. Old messages were "emoji+name",
 *  since 2026-09-25 the server sends only the name; both are recognized, and emoji is always stripped */
export function giftText(text: string, meta: { giftId?: unknown; emoji?: unknown; name?: unknown }): string {
  const id = typeof meta.giftId === 'string' ? meta.giftId : ''
  const emoji = typeof meta.emoji === 'string' ? meta.emoji : ''
  if (!GIFT_NAMES[id] || typeof meta.name !== 'string') return emoji ? text.replace(emoji, '') : text
  if (emoji && text.includes(emoji + meta.name)) return text.replace(emoji + meta.name, GIFT_NAMES[id])
  // New format: the name sits right after the measure-word character — anchor on it to avoid colliding with the same text in nicknames
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
