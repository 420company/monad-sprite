// Live room card covers (2026-10-02 goat: the official site's homepage art didn't fit, so a dedicated set was generated): live has no video screenshots,
// covers use 11 images (12 with "auto" = exactly 3 columns × 4 rows) (BytePlus-generated; no people, text, or branding; center left empty for the streamer avatar), 960px-wide webp.
// 2026-10-02 goat: the first 8 were all the same purple-neon style — too monotonous → switched to varied styles/colors (café, cherry blossom, snowy mountain, pixel, beach, nebula, candy, neon street), keeping 3 originals.
// Streamers can pick on the go-live check page (2026-10-02 goat); unpicked rooms get a deterministic cover by room id — same room, same cover, however many refreshes.
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

/** Selectable covers (ids one-to-one with the server's server/src/rooms.ts ROOM_COVERS). Streamers pick on the go-live check page; unpicked rooms auto-match by room id */
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

/** Room cover: the streamer's pick when chosen; otherwise a deterministic pick by room id */
export function coverOf(id: string, cover?: string | null): string {
  const picked = cover && COVER_LIST.find((c) => c.id === cover)
  if (picked) return picked.url
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return COVER_LIST[h % COVER_LIST.length].url
}
