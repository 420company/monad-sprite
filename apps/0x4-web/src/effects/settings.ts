// 直播特效的设置（存本机，下次开播自动沿用）和背景图清单。这个文件很小、不引用识别引擎：
// 直播间页面靠它判断要不要带特效开摄像头，真正的处理代码（processor.ts）只在需要时才加载。
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
  /** 虚拟形象：none = 真人；cat = 0x4 猫头 */
  avatar: 'none' | 'cat'
  /** 美颜四项（2026-10-02 goat：要像抖音那样分开调），都是 0~1，0 = 关。beauty = 磨皮（字段名沿用以前的「美颜强度」，老设置直接接上） */
  beauty: number
  /** 美白 */
  white: number
  /** 瘦脸 */
  slim: number
  /** 大眼 */
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

// 直播专用背景图（2026-10-02 goat：官网的配图放这里不合适，重新专门生成）：BytePlus 生成，没有人、没有文字和品牌，
// 中间留空给主播，手机竖屏裁中间一截也能用。原图 2560×1440，压成 1600 宽 webp。
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
export function saveFx(s: FxSettings) { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* 存不了：只是下次要重新选 */ } }
/** 真人模式下开了任何一项美颜（猫头模式不做美颜） */
export const beautyOn = (s: FxSettings) => s.avatar !== 'cat' && (s.beauty > 0 || s.white > 0 || s.slim > 0 || s.eyes > 0)
export const fxActive = (s: FxSettings) => s.avatar !== 'none' || beautyOn(s) || s.bg !== 'none'

const imgs = new Map<string, Promise<HTMLImageElement>>()
/** 背景图（解码好的），同一张只加载一次 */
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
