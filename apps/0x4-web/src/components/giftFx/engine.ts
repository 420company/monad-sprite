// 礼物动画引擎（网页版直播间、会议、手机 App 共用；不依赖 React / Tailwind，会议工程 meet/ 可以直接引用）。
// 规矩：只动 transform / opacity，礼花用一块 canvas；每个效果 ≤ 3 秒，播完整块 DOM 删掉、定时器清掉；
// 页面隐藏时全部停掉、回来不补播；系统开了「减少动态效果」只显示静态图 + 说明；低端机粒子数减半。
// 哈基米 = 猫咪币雨：正在下时再来的不重开，合并成「哈基米 ×N」并继续下；音效由 sound.ts 保证同时只播一遍。
import { injectGiftFxCss } from './styles'
import { giftSound, type GiftSound } from './sound'

export type GiftFxKind = 'pop' | 'heart' | 'coinrain' | 'kline' | 'rose' | 'rocket' | 'car' | 'yacht' | 'fireworks' | 'satoshi'
export const GIFT_FX_KINDS: GiftFxKind[] = ['pop', 'heart', 'coinrain', 'kline', 'rose', 'rocket', 'car', 'yacht', 'fireworks', 'satoshi']

export interface GiftFxGift {
  id: string
  nameZh: string
  nameEn: string
  icon: string | null
  /** 后台上传的动画文件（动图 / 视频），有就优先播它 */
  anim?: string | null
  fx?: string | null
  sound?: string | null
}
export interface GiftFxEvent {
  gift: GiftFxGift
  /** 送礼人 */
  from?: { id?: string; nickname?: string | null; avatar?: string | null }
  count?: number
}
export interface GiftFxOptions {
  lang?: 'zh' | 'en'
  /** 把 /files/xxx 变成能直接加载的地址（原生 App 要拼 API 域名）；默认原样 */
  resolve?: (url: string) => string
  /** 没图标时用的通用礼盒图 */
  fallbackIcon?: string
  sound?: GiftSound | null
  reducedMotion?: boolean
  lowEnd?: boolean
}

/** 每种效果的时长（毫秒，都 ≤ 3 秒） */
export const FX_MS: Record<GiftFxKind, number> = { pop: 2200, heart: 2600, coinrain: 3000, kline: 2800, rose: 2800, rocket: 2800, car: 2400, yacht: 3000, fireworks: 3000, satoshi: 2600 }
const MEDIA_MS = 4000
const STILL_MS = 1600
const QUEUE_MAX = 30

interface Job { key: string; ev: GiftFxEvent; count: number }

const rnd = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
const kindOf = (g: GiftFxGift): GiftFxKind => (GIFT_FX_KINDS as string[]).includes(g.fx || '') ? g.fx as GiftFxKind : 'pop'
const PETAL = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 24"><path d="M10 1C15 5 19 10 17 16C15 21 11 23 10 23C9 23 5 21 3 16C1 10 5 5 10 1Z" fill="#d61f3c"/><path d="M10 3C12 8 12 15 10 21" stroke="#ff6b81" stroke-width="1.2" fill="none" opacity=".6"/></svg>')
const WAVE = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 36" preserveAspectRatio="none"><path d="M0 18Q15 6 30 18T60 18T90 18T120 18T150 18T180 18T210 18T240 18" fill="none" stroke="#bff3ff" stroke-width="3" stroke-linecap="round" opacity=".8"/><path d="M0 28Q15 18 30 28T60 28T90 28T120 28T150 28T180 28T210 28T240 28" fill="none" stroke="#7fd9f5" stroke-width="2" stroke-linecap="round" opacity=".6"/></svg>')

function detectLowEnd(): boolean {
  if (typeof navigator === 'undefined') return false
  const n = navigator as Navigator & { deviceMemory?: number }
  const narrow = typeof window !== 'undefined' && window.innerWidth < 640
  return narrow || (n.hardwareConcurrency || 8) <= 4 || (n.deviceMemory || 8) <= 4
}
function detectReduced(): boolean {
  try { return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

export class GiftFxEngine {
  readonly stage: HTMLDivElement
  private o: Required<Omit<GiftFxOptions, 'sound'>> & { sound: GiftSound | null }
  private queue: Job[] = []
  private busy = false
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private rafs = new Set<number>()
  private hearts = 0
  private rain: { layer: HTMLDivElement; count: number; combo: HTMLDivElement; endAt: number; timer: ReturnType<typeof setTimeout> | null; coins: number; cap: HTMLDivElement | null } | null = null
  private dead = false

  constructor(container: HTMLElement, opts: GiftFxOptions = {}) {
    injectGiftFxCss()
    this.o = {
      lang: opts.lang ?? 'zh',
      resolve: opts.resolve ?? ((u) => u),
      fallbackIcon: opts.fallbackIcon ?? '/files/gift-giftbox.webp',
      sound: opts.sound === undefined ? giftSound() : opts.sound,
      reducedMotion: opts.reducedMotion ?? detectReduced(),
      lowEnd: opts.lowEnd ?? detectLowEnd(),
    }
    this.stage = document.createElement('div')
    this.stage.className = 'gfx-stage'
    this.stage.setAttribute('aria-hidden', 'true')
    container.appendChild(this.stage)
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  setLang(l: 'zh' | 'en') { this.o.lang = l }

  /** 有人送了礼物（服务器确认后才调用：先扣后播，永远不会播了又收回） */
  play(ev: GiftFxEvent) {
    if (this.dead || document.visibilityState === 'hidden') return
    const g = ev.gift
    const n = Math.max(1, Math.floor(ev.count || 1))
    if (g.sound) this.o.sound?.play(this.o.resolve(g.sound))
    const kind = kindOf(g)
    if (!this.o.reducedMotion && !g.anim) {
      if (kind === 'coinrain') return this.coinRain(ev, n)
      if (kind === 'heart' && this.hearts < 3) return this.heartBurst(ev, n)
    }
    this.enqueue(ev, n)
  }

  /** 正在排队 / 正在播的数量（测试用） */
  get pending() { return this.queue.length + (this.busy ? 1 : 0) }
  get rainCount() { return this.rain?.count ?? 0 }

  clear() {
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
    for (const r of this.rafs) cancelAnimationFrame(r)
    this.rafs.clear()
    this.queue = []
    this.busy = false
    this.hearts = 0
    if (this.rain?.timer) clearTimeout(this.rain.timer)
    this.rain = null
    this.stage.replaceChildren()
  }

  destroy() {
    this.dead = true
    this.clear()
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.stage.remove()
  }

  // ---------------------------------------------------------------- 排队（一次放一个大效果）

  private enqueue(ev: GiftFxEvent, n: number) {
    const key = `${ev.gift.id}|${ev.from?.id || ''}`
    const last = this.queue[this.queue.length - 1]
    if (last && last.key === key) { last.count += n; return }        // 同一个人连送同一个：合并成 ×N
    if (this.queue.length >= QUEUE_MAX) {
      const same = this.queue.find((j) => j.ev.gift.id === ev.gift.id)
      if (same) same.count += n                                    // 排满了：并进同一种礼物
      return
    }
    this.queue.push({ key, ev, count: n })
    this.next()
  }

  private next() {
    if (this.busy || this.dead) return
    const job = this.queue.shift()
    if (!job) return
    this.busy = true
    const ms = this.render(job)
    this.later(() => { this.busy = false; this.next() }, ms)
  }

  private render(job: Job): number {
    const { ev, count } = job
    const g = ev.gift
    const layer = this.layer()
    let ms: number
    if (this.o.reducedMotion) {
      ms = STILL_MS
      const c = this.center(layer, g, 160)
      c.classList.add('gfx-still')
      c.style.setProperty('--d', `${ms}ms`)
    } else if (g.anim) {
      ms = MEDIA_MS
      this.media(layer, g.anim, ms)
    } else {
      const kind = kindOf(g)
      ms = FX_MS[kind]
      const fx = FX_RENDER[kind] ?? FX_RENDER.pop
      fx.call(this, layer, g, ms)
    }
    this.caption(layer, ev, count, ms)
    this.later(() => layer.remove(), ms + 50)
    return ms
  }

  // ---------------------------------------------------------------- 小工具

  private later(fn: () => void, ms: number) {
    const t = setTimeout(() => { this.timers.delete(t); fn() }, ms)
    this.timers.add(t)
    return t
  }
  private layer(): HTMLDivElement {
    const l = document.createElement('div')
    l.className = 'gfx-layer'
    this.stage.appendChild(l)
    return l
  }
  private icon(g: GiftFxGift) { return this.o.resolve(g.icon || this.o.fallbackIcon) }
  private img(src: string, cls = ''): HTMLImageElement {
    const i = document.createElement('img')
    i.alt = ''
    i.decoding = 'async'
    i.draggable = false
    if (cls) i.className = cls
    i.src = src
    return i
  }
  private center(layer: HTMLElement, g: GiftFxGift, size: number): HTMLDivElement {
    const c = document.createElement('div')
    c.className = 'gfx-center'
    c.style.setProperty('--s', `min(${size}px, 46vw)`)
    c.appendChild(this.img(this.icon(g)))
    layer.appendChild(c)
    return c
  }
  private n(full: number) { return this.o.lowEnd ? Math.max(1, Math.round(full / 2)) : full }
  private vars(el: HTMLElement, v: Record<string, string | number>) { for (const [k, x] of Object.entries(v)) el.style.setProperty(`--${k}`, String(x)) }

  private caption(layer: HTMLElement, ev: GiftFxEvent, count: number, ms: number): HTMLDivElement {
    const cap = document.createElement('div')
    cap.className = 'gfx-cap'
    cap.style.setProperty('--d', `${ms}ms`)
    if (ev.from?.avatar) cap.appendChild(this.img(this.o.resolve(ev.from.avatar)))
    cap.appendChild(this.img(this.icon(ev.gift), 'gfx-gi'))
    const text = document.createElement('span')
    const name = this.o.lang === 'en' ? ev.gift.nameEn : ev.gift.nameZh
    const who = ev.from?.nickname || (this.o.lang === 'en' ? 'Someone' : '有人')
    text.textContent = this.o.lang === 'en' ? `${who} sent ${name}` : `${who} 送出 ${name}`
    cap.appendChild(text)
    if (count > 1) { const b = document.createElement('b'); b.textContent = `×${count}`; cap.appendChild(b) }
    layer.appendChild(cap)
    return cap
  }

  private media(layer: HTMLElement, url: string, ms: number) {
    const src = this.o.resolve(url)
    const el = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)
      ? Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true, loop: false, preload: 'auto' })
      : this.img(src)
    el.className = 'gfx-media'
    el.style.setProperty('--d', `${ms}ms`)
    if (el instanceof HTMLVideoElement) { el.src = src; el.setAttribute('playsinline', ''); void el.play?.()?.catch?.(() => { /* 静音也放不了就算了 */ }) }
    layer.appendChild(el)
  }

  // ---------------------------------------------------------------- 爱心 / 猫咪币雨（可以和排队的大效果同时出现）

  private heartBurst(ev: GiftFxEvent, count: number) {
    this.hearts++
    const layer = this.layer()
    const src = this.icon(ev.gift)
    const n = this.n(10)
    for (let i = 0; i < n; i++) {
      const f = document.createElement('div')
      f.className = 'gfx-float'
      const w = rnd(34, 72)
      this.vars(f, { x: `${rnd(20, 80).toFixed(1)}%`, w: `${w.toFixed(0)}px`, t: `${rnd(1.6, 2.4).toFixed(2)}s`, dl: `${rnd(0, 0.35).toFixed(2)}s`, dx: `${rnd(-60, 60).toFixed(0)}px`, r0: `${rnd(-25, 25).toFixed(0)}deg`, r1: `${rnd(-30, 30).toFixed(0)}deg` })
      f.appendChild(this.img(src))
      layer.appendChild(f)
    }
    this.caption(layer, ev, count, FX_MS.heart)
    this.later(() => { layer.remove(); this.hearts-- }, FX_MS.heart + 50)
  }

  private coinRain(ev: GiftFxEvent, count: number) {
    const src = this.icon(ev.gift)
    const now = Date.now()
    if (this.rain) {
      // 正在下：不重开，计数 +N，再补几枚、往后延 3 秒
      const r = this.rain
      r.count += count
      r.combo.replaceWith(r.combo = this.comboEl(ev.gift, r.count))
      r.endAt = now + FX_MS.coinrain
      this.addCoins(r.layer, src, this.n(6), 0)
      if (r.timer) clearTimeout(r.timer)
      r.timer = this.later(() => this.endRain(), FX_MS.coinrain + 1200)
      return
    }
    const layer = this.layer()
    const combo = this.comboEl(ev.gift, count)
    layer.appendChild(combo)
    this.rain = { layer, count, combo, endAt: now + FX_MS.coinrain, timer: null, coins: 0, cap: this.caption(layer, ev, 1, FX_MS.coinrain) }
    this.addCoins(layer, src, this.n(18), 0.9)
    this.rain.timer = this.later(() => this.endRain(), FX_MS.coinrain + 1200)
  }

  private endRain() {
    const r = this.rain
    if (!r) return
    this.rain = null
    r.layer.remove()
  }

  private comboEl(g: GiftFxGift, n: number): HTMLDivElement {
    const d = document.createElement('div')
    d.className = 'gfx-combo'
    if (n < 2) d.style.visibility = 'hidden'   // 只有一枚时不显示 ×1
    const s = document.createElement('small')
    s.textContent = this.o.lang === 'en' ? g.nameEn : g.nameZh
    d.appendChild(s)
    d.appendChild(document.createTextNode(`×${n}`))
    return d
  }

  /** 加几枚币（同一张图反复用）；最多同时 24 枚，旧的落完自己删 */
  private addCoins(layer: HTMLElement, src: string, n: number, spread: number) {
    const r = this.rain
    for (let i = 0; i < n; i++) {
      if (r && r.coins >= 24) break
      const c = this.img(src, 'gfx-coin')
      const near = Math.random() < 0.25
      const w = near ? rnd(70, 110) : rnd(28, 58)
      const t = near ? rnd(1.6, 2.2) : rnd(2.2, 3)
      this.vars(c, { x: `${rnd(0, 96).toFixed(1)}%`, w: `${w.toFixed(0)}px`, t: `${t.toFixed(2)}s`, dl: `${rnd(0, spread).toFixed(2)}s`, dx: `${rnd(-60, 60).toFixed(0)}px`, r0: `${rnd(0, 360).toFixed(0)}deg`, r1: `${(rnd(0, 360) + (Math.random() < 0.5 ? -540 : 540)).toFixed(0)}deg`, o: near ? '.95' : rnd(0.55, 0.85).toFixed(2) })
      layer.appendChild(c)
      if (r) r.coins++
      const life = (t + spread) * 1000 + 100
      this.later(() => { c.remove(); if (this.rain === r && r) r.coins-- }, life)
    }
  }

  // ---------------------------------------------------------------- 礼花（一块 canvas，粒子数封顶）

  fireworks(layer: HTMLElement, ms: number) {
    const cv = document.createElement('canvas')
    cv.className = 'gfx-canvas'
    layer.appendChild(cv)
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 1.5)
    const W = Math.max(1, this.stage.clientWidth || (typeof innerWidth === 'number' ? innerWidth : 400))
    const H = Math.max(1, this.stage.clientHeight || (typeof innerHeight === 'number' ? innerHeight : 700))
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr)
    ctx.scale(dpr, dpr)
    const COLORS = ['#ffd66b', '#ff5fd2', '#5fe8ff', '#ffffff', '#ff9d3d', '#9dff7a']
    const bursts = this.n(5), per = this.n(70)
    const R = W >= 900 ? 4.5 : 3.5   // 粒子边长（CSS 像素）
    type P = { x: number; y: number; vx: number; vy: number; c: string; born: number; life: number }
    const ps: P[] = []
    for (let b = 0; b < bursts; b++) {
      const cx = rnd(0.18, 0.82) * W, cy = rnd(0.18, 0.5) * H, at = b * (ms * 0.55 / bursts), c1 = pick(COLORS), c2 = pick(COLORS)
      for (let i = 0; i < per; i++) {
        const a = (i / per) * Math.PI * 2 + rnd(-0.05, 0.05), sp = rnd(1.2, 3) * (W >= 900 ? 1.3 : 1)
        ps.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, c: i % 3 ? c1 : c2, born: at, life: rnd(1100, 1500) })
      }
    }
    const t0 = performance.now()
    let raf = 0
    const frame = (now: number) => {
      this.rafs.delete(raf)
      const el = now - t0
      if (el > ms || !cv.isConnected) return
      ctx.clearRect(0, 0, W, H)
      ctx.globalCompositeOperation = 'lighter'
      for (const p of ps) {
        const age = el - p.born
        if (age < 0 || age > p.life) continue
        const k = age / 16.7
        const x = p.x + p.vx * k * 1.6, y = p.y + p.vy * k * 1.6 + 0.018 * k * k   // 往外散 + 一点重力
        const a = 1 - age / p.life
        ctx.fillStyle = p.c
        ctx.globalAlpha = a * 0.45
        ctx.fillRect(x - p.vx * 5 - R / 2, y - p.vy * 5 - R / 2, R, R)   // 拖尾：往回一点再画一个淡的
        ctx.globalAlpha = a
        ctx.fillRect(x - R / 2, y - R / 2, R, R)
      }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(frame)
      this.rafs.add(raf)
    }
    raf = requestAnimationFrame(frame)
    this.rafs.add(raf)
  }

  private onVisibility = () => { if (document.visibilityState === 'hidden') this.clear() }
}

// ---------------------------------------------------------------- 每种效果怎么画（this = 引擎）

type Render = (this: GiftFxEngine, layer: HTMLElement, g: GiftFxGift, ms: number) => void
const FX_RENDER: Record<GiftFxKind, Render> = {
  pop(layer, g, ms) {
    const c = this['center'](layer, g, 180)
    c.classList.add('gfx-pop'); c.style.setProperty('--d', `${ms}ms`)
  },
  heart(layer, g, ms) { FX_RENDER.pop.call(this, layer, g, ms) },
  coinrain(layer, g, ms) { FX_RENDER.pop.call(this, layer, g, ms) },
  kline(layer, g, ms) {
    const n = this['n'](16)
    for (let i = 0; i < n; i++) {
      const d = document.createElement('div')
      d.className = 'gfx-candle'
      this['vars'](d, { x: `${((i + 0.5) / n * 100 + rnd(-2, 2)).toFixed(1)}%`, w: `${rnd(10, 18).toFixed(0)}px`, h: `${rnd(60, 160).toFixed(0)}px`, t: `${rnd(2.1, 2.4).toFixed(2)}s`, dl: `${(i / n * 0.3 + rnd(0, 0.08)).toFixed(2)}s` })
      layer.appendChild(d)
    }
    const c = this['center'](layer, g, 150)
    c.classList.add('gfx-pop'); c.style.setProperty('--d', `${ms}ms`)
    const pct = document.createElement('div')
    pct.className = 'gfx-pct'
    pct.style.setProperty('--d', `${ms}ms`)
    pct.textContent = '+0%'
    layer.appendChild(pct)
    // 涨幅跳到 +420.69%（goat 定），最后一跳正好落在这个数
    const target = 420.69, steps = 20
    for (let s = 1; s <= steps; s++) this['later'](() => { pct.textContent = `+${(target * (s / steps) ** 1.6).toFixed(2)}%` }, (s / steps) * ms * 0.6)
  },
  rose(layer, g, ms) {
    const c = this['center'](layer, g, 180)
    c.classList.add('gfx-pop'); c.style.setProperty('--d', `${ms}ms`)
    const n = this['n'](14)
    for (let i = 0; i < n; i++) {
      const p = this['img'](PETAL, 'gfx-petal')
      this['vars'](p, { x: `${rnd(0, 96).toFixed(1)}%`, w: `${rnd(14, 26).toFixed(0)}px`, t: `${rnd(1.8, 2.6).toFixed(2)}s`, dl: `${rnd(0, 0.4).toFixed(2)}s`, dx: `${rnd(-80, 80).toFixed(0)}px`, r0: `${rnd(0, 360).toFixed(0)}deg`, r1: `${rnd(180, 720).toFixed(0)}deg` })
      layer.appendChild(p)
    }
  },
  rocket(layer, g, ms) {
    const f = document.createElement('div')
    f.className = 'gfx-fly gfx-rocket'
    this['vars'](f, { s: 'min(200px, 44vw)', d: `${ms}ms` })
    f.appendChild(this['img'](this['icon'](g)))
    layer.appendChild(f)
    const n = this['n'](8)
    for (let i = 0; i < n; i++) {
      const p = document.createElement('div')
      p.className = 'gfx-puff'
      this['vars'](p, { x: `${(8 + i * 3 + rnd(-3, 3)).toFixed(1)}%`, y: `${(2 + i * 4).toFixed(0)}%`, w: `${rnd(50, 90).toFixed(0)}px`, dl: `${(0.15 + i * 0.12).toFixed(2)}s` })
      layer.appendChild(p)
    }
  },
  car(layer, g, ms) {
    const n = this['n'](6)
    for (let i = 0; i < n; i++) {
      const s = document.createElement('div')
      s.className = 'gfx-streak'
      this['vars'](s, { y: `${(56 + rnd(0, 14)).toFixed(1)}%`, dl: `${(0.1 + i * 0.12).toFixed(2)}s` })
      layer.appendChild(s)
    }
    const f = document.createElement('div')
    f.className = 'gfx-fly gfx-car'
    this['vars'](f, { s: 'min(300px, 62vw)', d: `${ms}ms` })
    f.appendChild(this['img'](this['icon'](g)))
    layer.appendChild(f)
  },
  yacht(layer, g, ms) {
    const w = this['img'](WAVE, 'gfx-wave')
    w.style.top = '64%'; w.style.setProperty('--d', `${ms}ms`)
    layer.appendChild(w)
    const f = document.createElement('div')
    f.className = 'gfx-fly gfx-yacht'
    this['vars'](f, { s: 'min(300px, 62vw)', d: `${ms}ms` })
    f.appendChild(this['img'](this['icon'](g)))
    layer.appendChild(f)
  },
  fireworks(layer, g, ms) {
    this.fireworks(layer, ms)
    const c = this['center'](layer, g, 150)
    c.classList.add('gfx-pop'); c.style.setProperty('--d', `${ms}ms`)
  },
  satoshi(layer, g, ms) {
    const dim = document.createElement('div')
    dim.className = 'gfx-dim'; dim.style.setProperty('--d', `${ms}ms`)
    layer.appendChild(dim)
    const c = this['center'](layer, g, 220)
    c.classList.add('gfx-glitch'); c.style.setProperty('--d', `${ms}ms`)
    const n = this['n'](10)
    for (let i = 0; i < n; i++) {
      const s = document.createElement('div')
      s.className = 'gfx-spark'
      const a = (i / n) * Math.PI * 2, r = rnd(120, 220)
      this['vars'](s, { w: `${rnd(10, 22).toFixed(0)}px`, dx: `${(Math.cos(a) * r).toFixed(0)}px`, dy: `${(Math.sin(a) * r).toFixed(0)}px`, dl: `${rnd(0.15, 0.5).toFixed(2)}s` })
      layer.appendChild(s)
    }
  },
}
