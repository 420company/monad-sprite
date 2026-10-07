// 直播房间卡片的封面（2026-10-02 goat：官网首页的配图不合适，专门生成一组）：直播没有画面截图，
// 封面用 11 张图（加上「自动」正好 3 列 4 行）（BytePlus 生成，没有人、文字和品牌，中间留空放主播头像），960 宽 webp。
// 2026-10-02 goat：第一版 8 张都是同一种紫色霓虹风格太单调 → 换成各种风格颜色（咖啡馆、樱花、雪山、像素、海滩、星云、糖果、霓虹街），留 3 张原来的。
// 主播可以在开播检查页自己选（2026-10-02 goat）；没选按房间 id 固定挑一张，同一个房间刷新多少次都是同一张。
import cafe from '../assets/livecards/cafe.webp'
import sakura from '../assets/livecards/sakura.webp'
import snow from '../assets/livecards/snow.webp'
import arcade from '../assets/livecards/arcade.webp'
import beach from '../assets/livecards/beach.webp'
import space from '../assets/livecards/space.webp'
import studio from '../assets/livecards/studio.webp'
import city from '../assets/livecards/city.webp'
import stage from '../assets/livecards/stage.webp'
import trading from '../assets/livecards/trading.webp'
import lofi from '../assets/livecards/lofi.webp'

import { t } from '@/lib/i18n'

/** 可选的封面（编号和服务器 server/src/rooms.ts 的 ROOM_COVERS 一一对应）。主播在开播检查页选，没选按房间 id 自动配 */
export const COVER_LIST: { id: string; url: string; label: () => string }[] = [
  { id: 'cafe', url: cafe, label: () => t('咖啡馆') },
  { id: 'sakura', url: sakura, label: () => t('樱花') },
  { id: 'snow', url: snow, label: () => t('雪山小屋') },
  { id: 'arcade', url: arcade, label: () => t('像素街机') },
  { id: 'beach', url: beach, label: () => t('海滩') },
  { id: 'space', url: space, label: () => t('星云') },
  { id: 'studio', url: studio, label: () => t('糖果') },
  { id: 'city', url: city, label: () => t('霓虹街') },
  { id: 'stage', url: stage, label: () => t('舞台') },
  { id: 'trading', url: trading, label: () => t('看盘') },
  { id: 'lofi', url: lofi, label: () => t('书桌') },
]

/** 房间封面：主播选过的用选的，没选按房间 id 固定挑一张 */
export function coverOf(id: string, cover?: string | null): string {
  const picked = cover && COVER_LIST.find((c) => c.id === cover)
  if (picked) return picked.url
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return COVER_LIST[h % COVER_LIST.length].url
}
