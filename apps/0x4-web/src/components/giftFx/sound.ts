// Gift sound effects (currently only Hajimi; rules set by goat 2026-09-30):
// - One page (= one live room / meeting) plays one sound effect at most once at a time: arrivals while playing (whoever sent them) don't restart, stack, or queue up;
//   only gifts sent after it finishes restart it. So 10 or 20 rapid taps still play just one full round.
// - One <audio> per sound file, a global singleton — loaded once, kept cached after playing; different sounds never interfere.
// - Default volume 60% (quieter than the live audio); the "gift sounds" toggle is stored locally (0x4.giftSound).
// - Browsers can't autoplay audio before user interaction: just don't play (visuals continue), no error.
// - Stops when the page hides; no catch-up playback on return.

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
  /** Build a player (swapped for a fake in tests); defaults to new Audio() */
  create?: () => AudioLike
  /** Whether the user has interacted with the page (browser autoplay policy); defaults to navigator.userActivation */
  canAutoplay?: () => boolean
  volume?: number
  /** Read / write the "gift sounds" toggle; defaults to localStorage */
  store?: { get(): boolean; set(v: boolean): void }
}

const KEY = '0x4.giftSound'
const localStore = {
  get() { try { return localStorage.getItem(KEY) !== '0' } catch { return true } },
  set(v: boolean) { try { localStorage.setItem(KEY, v ? '1' : '0') } catch { /* Privacy mode */ } },
}
const defaultCanAutoplay = () => {
  const ua = (typeof navigator !== 'undefined' ? (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation : undefined)
  return ua ? ua.hasBeenActive : true   // Old browsers lack this property: try playing, give up if rejected
}

interface Slot { el: AudioLike; playing: boolean }

export class GiftSound {
  private slots = new Map<string, Slot>()
  private enabled: boolean
  private opts: Required<Omit<GiftSoundOptions, 'store'>> & { store: NonNullable<GiftSoundOptions['store']> }
  /** How many times playback actually started (for tests and debugging) */
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

  /** Preload (called when opening the gift panel / entering a room), silent */
  preload(url: string) { this.slot(url) }

  /** A gift with a sound effect arrived. Returns whether it actually started playing */
  play(url: string): boolean {
    if (!url || !this.enabled) return false
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false
    const s = this.slot(url)
    if (s.playing) return false                 // Already playing: no restart, no stacking, no catch-up
    if (!this.opts.canAutoplay()) return false  // User hasn't tapped the page yet: visuals only
    s.playing = true
    s.el.currentTime = 0
    this.starts++
    try {
      const p = s.el.play()
      if (p && typeof p.catch === 'function') p.catch(() => { s.playing = false })  // Browser rejected autoplay: stay silent
    } catch { s.playing = false }
    return true
  }

  isPlaying(url: string) { return !!this.slots.get(url)?.playing }

  stopAll() {
    for (const s of this.slots.values()) {
      if (!s.playing) continue
      s.playing = false
      try { s.el.pause(); s.el.currentTime = 0 } catch { /* Ignore */ }
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
/** One shared instance per page (live rooms, meetings, preview pages all use it) */
export function giftSound(): GiftSound {
  shared ??= new GiftSound()
  return shared
}
