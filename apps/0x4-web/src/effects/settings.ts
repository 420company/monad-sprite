// Live-effect settings (stored locally, auto-reused next stream) and the background-image list. This file is tiny and never imports the recognition engine:
// the live-room page uses it to decide whether to open the camera with effects; the real processing code (processor.ts) loads only when needed.
import { t } from '@/lib/i18n'
import cozy from './bg/cozy.webp'
import city from './bg/city.webp'
import space from './bg/space.webp'
import neon from './bg/neon.webp'
import forest from './bg/forest.webp'
import beach from './bg/beach.webp'
import studio from './bg/studio.webp'
import desk from './bg/desk.webp'

export type FxBg = 'none' | 'blur' | `img:${string}`
export interface FxSettings {
  /** Virtual persona: none = real person; cat = 0x4 cat head */
  avatar: 'none' | 'cat'
  /** The four beauty controls (2026-10-02 goat: TikTok-style separate sliders), all 0–1, 0 = off. beauty = smoothing (field name keeps the old "beauty intensity" so old settings carry over) */
  beauty: number
  /** Whitening */
  white: number
  /** Face slimming */
  slim: number
  /** Eye enlarging */
  eyes: number
  bg: FxBg
}
export const FX_OFF: FxSettings = { avatar: 'none', beauty: 0, white: 0, slim: 0, eyes: 0, bg: 'none' }
export type BeautyKey = 'beauty' | 'white' | 'slim' | 'eyes'
export const BEAUTY_ITEMS: { key: BeautyKey; label: () => string }[] = [
  { key: 'beauty', label: () => t('磨皮') },
  { key: 'white', label: () => t('美白') },
  { key: 'slim', label: () => t('瘦脸') },
  { key: 'eyes', label: () => t('大眼') },
]

// Stream-only background images (2026-10-02 goat: the website's illustrations don't fit here — regenerated): BytePlus-generated, no people, no text, no branding,
// center kept clear for the host, usable cropped to the middle on portrait phones. Source 2560×1440, compressed to 1600px-wide webp.
export const BACKGROUNDS: { id: string; url: string; label: () => string }[] = [
  { id: 'cozy', url: cozy, label: () => t('温馨房间') },
  { id: 'city', url: city, label: () => t('城市夜景') },
  { id: 'space', url: space, label: () => t('太空舱') },
  { id: 'neon', url: neon, label: () => t('霓虹') },
  { id: 'forest', url: forest, label: () => t('森林') },
  { id: 'beach', url: beach, label: () => t('海边') },
  { id: 'studio', url: studio, label: () => t('摄影棚') },
  { id: 'desk', url: desk, label: () => t('交易台') },
]

const KEY = '0x4.liveFx'
export function loadFx(): FxSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<FxSettings> | null
    if (!v) return FX_OFF
    const bg = v.bg === 'blur' || (typeof v.bg === 'string' && v.bg.startsWith('img:') && BACKGROUNDS.some((b) => `img:${b.id}` === v.bg)) ? v.bg as FxBg : 'none'
    const n = (x: unknown) => Math.min(1, Math.max(0, Number(x) || 0))
    return { avatar: v.avatar === 'cat' ? 'cat' : 'none', beauty: n(v.beauty), white: n(v.white), slim: n(v.slim), eyes: n(v.eyes), bg }
  } catch { return FX_OFF }
}
export function saveFx(s: FxSettings) { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* Can't persist: just means re-picking next time */ } }
/** Any beauty control on in person mode (cat-head mode skips beauty) */
export const beautyOn = (s: FxSettings) => s.avatar !== 'cat' && (s.beauty > 0 || s.white > 0 || s.slim > 0 || s.eyes > 0)
export const fxActive = (s: FxSettings) => s.avatar !== 'none' || beautyOn(s) || s.bg !== 'none'

const imgs = new Map<string, Promise<HTMLImageElement>>()
/** Background image (decoded); each loaded once */
export function bgImage(id: string): Promise<HTMLImageElement> {
  let p = imgs.get(id)
  if (!p) {
    const b = BACKGROUNDS.find((x) => x.id === id)
    p = new Promise((res, rej) => { if (!b) return rej(new Error('no bg')); const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = b.url })
    p.catch(() => imgs.delete(id))
    imgs.set(id, p)
  }
  return p
}
