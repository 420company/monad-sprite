// 礼物音效（目前只有哈基米，2026-09-30 goat 定的规则）：
// · 同一个页面（= 同一个直播间 / 会议）同一时刻同一个音效只播一遍：正在播时再来的（不管谁送的）不重头播、不叠加、不排队补播；
//   播完以后再送的才重新开始。所以连点 10 次、20 次只会听到一遍完整的。
// · 每个音效文件一个 <audio>，全局单例，只加载一次、播完也留着缓存；两个不同音效互不影响。
// · 默认音量 60%（比直播声小）；「礼物音效」开关记在本机（0x4.giftSound）。
// · 浏览器还没被用户点过时不能自动出声：直接不播（画面照常），不报错。
// · 页面隐藏时停掉，回来不补播。

export interface AudioLike {
  src: string
  volume: number
  currentTime: number
  preload: string
  play(): Promise<void> | void
  pause(): void
  addEventListener(type: 'ended' | 'error', fn: () => void): void
}

export interface GiftSoundOptions {
  /** 造一个播放器（测试时换成假的）；默认 new Audio() */
  create?: () => AudioLike
  /** 用户是不是已经和页面交互过（浏览器自动播放规则）；默认看 navigator.userActivation */
  canAutoplay?: () => boolean
  volume?: number
  /** 读 / 写「礼物音效」开关；默认 localStorage */
  store?: { get(): boolean; set(v: boolean): void }
}

const KEY = '0x4.giftSound'
const localStore = {
  get() { try { return localStorage.getItem(KEY) !== '0' } catch { return true } },
  set(v: boolean) { try { localStorage.setItem(KEY, v ? '1' : '0') } catch { /* 隐私模式 */ } },
}
const defaultCanAutoplay = () => {
  const ua = (typeof navigator !== 'undefined' ? (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation : undefined)
  return ua ? ua.hasBeenActive : true   // 老浏览器没有这个属性：试着播，被拒就算了
}

interface Slot { el: AudioLike; playing: boolean }

export class GiftSound {
  private slots = new Map<string, Slot>()
  private enabled: boolean
  private opts: Required<Omit<GiftSoundOptions, 'store'>> & { store: NonNullable<GiftSoundOptions['store']> }
  /** 实际开始播放的次数（给测试和调试看） */
  starts = 0

  constructor(o: GiftSoundOptions = {}) {
    this.opts = {
      create: o.create ?? (() => new Audio() as unknown as AudioLike),
      canAutoplay: o.canAutoplay ?? defaultCanAutoplay,
      volume: o.volume ?? 0.6,
      store: o.store ?? localStore,
    }
    this.enabled = this.opts.store.get()
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility)
  }

  get on() { return this.enabled }
  setEnabled(v: boolean) {
    this.enabled = v
    this.opts.store.set(v)
    if (!v) this.stopAll()
  }

  /** 预先加载（打开礼物面板 / 进房间时调用），不出声 */
  preload(url: string) { this.slot(url) }

  /** 送来一个带音效的礼物。返回这次有没有真的开始播 */
  play(url: string): boolean {
    if (!url || !this.enabled) return false
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false
    const s = this.slot(url)
    if (s.playing) return false                 // 正在播：不重头、不叠加、不补播
    if (!this.opts.canAutoplay()) return false  // 用户还没点过页面：只播画面
    s.playing = true
    s.el.currentTime = 0
    this.starts++
    try {
      const p = s.el.play()
      if (p && typeof p.catch === 'function') p.catch(() => { s.playing = false })  // 浏览器拒绝自动播放：静默
    } catch { s.playing = false }
    return true
  }

  isPlaying(url: string) { return !!this.slots.get(url)?.playing }

  stopAll() {
    for (const s of this.slots.values()) {
      if (!s.playing) continue
      s.playing = false
      try { s.el.pause(); s.el.currentTime = 0 } catch { /* 忽略 */ }
    }
  }

  destroy() {
    this.stopAll()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility)
  }

  private onVisibility = () => { if (document.visibilityState === 'hidden') this.stopAll() }

  private slot(url: string): Slot {
    let s = this.slots.get(url)
    if (s) return s
    const el = this.opts.create()
    el.preload = 'auto'
    el.volume = this.opts.volume
    el.src = url
    const slot: Slot = { el, playing: false }
    el.addEventListener('ended', () => { slot.playing = false })
    el.addEventListener('error', () => { slot.playing = false })
    this.slots.set(url, slot)
    return slot
  }
}

let shared: GiftSound | null = null
/** 整个页面共用一个（直播间、会议、预览页都用它） */
export function giftSound(): GiftSound {
  shared ??= new GiftSound()
  return shared
}
