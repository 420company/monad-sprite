// 直播特效的处理管：摄像头原始画面 → 识别 + 合成 → 新的视频轨道交给 LiveKit 发出去（2026-10-02）。
// · 用 LiveKit 的 TrackProcessor 接口：开摄像头时就把它带上（VideoCaptureOptions.processor），画面在发出去之前就已经处理好；
//   直播中途打开 / 关闭用 setProcessor / stopProcessor。主播自己的预览看到的就是观众看到的。
// · 猫头模式（2026-10-02 goat：背景和身体照旧，只用猫头挡住脸，不要猫身子）：
//   底下一层 = 摄像头画面（换背景 / 虚化照常）；
//   上面一层 = 猫头，按这一帧脸的位置和大小贴上去（你靠近摄像头猫头就变大，往旁边挪跟着挪）。
//   不露脸的保证：还没认到脸、或脸丢了超过 0.6 秒，整幅画面大幅虚化，认到了再恢复；出错时输出深色底和一句话，绝不退回真人画面。
// · 换背景要等人像分割模型加载好（第一次大约 1~2 秒），这之前先只做美颜。
// · 切到别的标签页 / 窗口时观众那边卡住（2026-10-03 goat）：原来每一帧靠 <video> 的画面回调驱动、输出靠 canvas.captureStream，
//   Chrome 会把后台标签页的画面刷新停掉，回调不来就不出帧。现在 Chrome / Edge 走新路：MediaStreamTrackProcessor 直接从摄像头轨道读帧，
//   算完用 MediaStreamTrackGenerator 直接写进发出去的轨道，整个过程不依赖页面刷新，切到后台照样出帧。没有这两样的浏览器（Safari 等）走老路。
// · 手机（2026-10-02 goat：手机 App 主播也要有）走省电模式：识别用更小的画面、隔一帧识别一次（中间帧沿用上一帧的结果，
//   猫头本来就有平滑，看不出来），输出最高 720p。连续直播不至于烫手；电脑照旧每帧都算。
import type { Track, TrackProcessor, VideoProcessorOptions } from 'livekit-client'
import type { FaceLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision'
import { Compositor, type Warp } from './compositor'
import { CatAvatar } from './catAvatar'
import { Downscaler, NO_FACE, loadFace, loadFaceCpu, loadSegmenter, loadSegmenterCpu, readFace, segment, srcSize, type FacePose, type FrameSrc } from './engine'
import { beautyOn, bgImage, type FxSettings } from './settings'
import { t } from '@/lib/i18n'
import { WEB_SURFACE } from '@/lib/surface'

/** 手机（App、手机网页版）：网页版构建以外的都算；网页版在手机浏览器里打开（触屏为主）也算 */
function isPhone() {
  if (!WEB_SURFACE) return true
  try { return matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches } catch { return false }
}

export type FxStatus = 'loading' | 'ready' | 'noFace' | 'error'

// Chrome / Edge 才有的两个接口（TypeScript 自带的类型里没有）
type TrackReaderCtor = new (init: { track: MediaStreamTrack; maxBufferSize?: number }) => { readable: ReadableStream<VideoFrame> }
type TrackWriterCtor = new (init: { kind: 'video' }) => MediaStreamTrack & { writable: WritableStream<VideoFrame> }
/** 能不能走「不依赖页面刷新」的新路（测试时设 window.__fxLegacy = true 强制走老路） */
function directPipe(): { Reader: TrackReaderCtor; Writer: TrackWriterCtor } | null {
  const w = window as unknown as { MediaStreamTrackProcessor?: TrackReaderCtor; MediaStreamTrackGenerator?: TrackWriterCtor; __fxLegacy?: boolean }
  if (w.__fxLegacy) return null
  return w.MediaStreamTrackProcessor && w.MediaStreamTrackGenerator && typeof VideoFrame !== 'undefined' ? { Reader: w.MediaStreamTrackProcessor, Writer: w.MediaStreamTrackGenerator } : null
}

export class FxProcessor implements TrackProcessor<Track.Kind.Video, VideoProcessorOptions> {
  name = '0x4-fx'
  processedTrack?: MediaStreamTrack
  status: FxStatus = 'loading'
  onStatus?: (s: FxStatus) => void

  private video: HTMLVideoElement | null = null
  // 新路：从摄像头读帧 / 往输出轨道写帧
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null
  private writer: WritableStreamDefaultWriter<VideoFrame> | null = null
  private lastOutTs = -1
  /** 处理过的帧数（走查测试用来确认切到后台还在出帧） */
  frames = 0
  private out = document.createElement('canvas')
  private ctx = this.out.getContext('2d', { alpha: false })!
  private comp: Compositor | null = null
  private cat: CatAvatar | null = null
  private seg: ImageSegmenter | null = null
  private face: FaceLandmarker | null = null
  private lite = isPhone()
  private segDown = new Downscaler(this.lite ? 192 : 256)
  private faceDown = new Downscaler(this.lite ? 320 : 480)
  private tick = 0
  private mask: { data: Uint8Array; w: number; h: number; person?: number } = { data: new Uint8Array(0), w: 0, h: 0 }
  private faceMiss = 0           // 连续认不出脸的次数
  private missSince = 0          // 画面里有人、却认不出脸，从什么时候开始
  private faceErr = 0            // 认脸报错次数
  private faceReadyAt = 0        // 认脸模型加载好的时间
  private everFound = false      // 这次开播认到过脸没有
  private warpPrev: Warp | null = null
  private faceCpu = false        // 已经换成 CPU 认脸
  private segCpu = false         // 已经换成 CPU 分割
  private segErr = 0             // 分割连续报错次数
  private lastErr = ''
  private pose: FacePose = NO_FACE
  // 猫贴在哪（输出画面的像素）：跟着脸平滑移动；还没见过脸时放在画面中间偏上
  private place = { x: 0, y: 0, fw: 0, seen: false }
  private faceAt = 0     // 最近一次认到脸的时间
  private noFaceSince = 0
  private running = false
  private lastTs = 0
  private bgKey = ''
  private gen = 0

  constructor(private s: FxSettings) {}

  async init(opts: VideoProcessorOptions) {
    const gen = ++this.gen
    const pipe = directPipe()
    if (pipe) {
      const st = opts.track.getSettings()
      let ow = st.width || 1280, oh = st.height || 720
      const cap = this.lite ? Math.min(1, 720 / Math.min(ow, oh)) : 1
      ow = Math.round(ow * cap); oh = Math.round(oh * cap)
      this.out.width = ow; this.out.height = oh
      this.paintCover('')
      const outTrack = new pipe.Writer({ kind: 'video' })
      this.writer = outTrack.writable.getWriter()
      this.reader = new pipe.Reader({ track: opts.track, maxBufferSize: 1 }).readable.getReader()
      this.processedTrack = outTrack
      this.running = true
      this.update(this.s)
      void this.emit(0)                        // 第一帧先发深色底，等真正的画面
      void this.pump(gen)
      return
    }
    const v = document.createElement('video')
    v.muted = true; v.playsInline = true; v.autoplay = true
    // 放进页面但看不见：苹果手机上不在页面里的视频元素可能不出新画面
    v.setAttribute('aria-hidden', 'true')
    Object.assign(v.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' })
    document.body.appendChild(v)
    v.srcObject = new MediaStream([opts.track])
    await v.play().catch(() => { /* 有的浏览器要等第一帧，下面 loop 会等 */ })
    if (gen !== this.gen) return
    this.video = v
    const st = opts.track.getSettings()
    let ow = st.width || v.videoWidth || 1280, oh = st.height || v.videoHeight || 720
    // 手机输出最高 720p（短边 720），省显卡和上传带宽
    const cap = this.lite ? Math.min(1, 720 / Math.min(ow, oh)) : 1
    ow = Math.round(ow * cap); oh = Math.round(oh * cap)
    this.out.width = ow; this.out.height = oh
    this.paintCover('')                      // 第一帧先铺深色，等真正的画面
    this.processedTrack = this.out.captureStream(30).getVideoTracks()[0]
    this.running = true
    this.update(this.s)
    this.loop(gen)
  }

  async restart(opts: VideoProcessorOptions) { await this.destroy(); await this.init(opts) }

  async destroy() {
    this.gen++
    this.running = false
    const r = this.reader, w = this.writer
    this.reader = null; this.writer = null; this.lastOutTs = -1
    r?.cancel().catch(() => {})
    w?.close().catch(() => {})
    this.processedTrack?.stop(); this.processedTrack = undefined
    if (this.video) { this.video.pause(); this.video.srcObject = null; this.video.remove(); this.video = null }
    this.comp?.destroy(); this.comp = null
    this.cat?.destroy(); this.cat = null
  }

  /** 改设置（不用重开摄像头）：需要的模型现加载，背景图现换 */
  update(s: FxSettings) {
    this.s = s
    if (!this.comp) { try { this.comp = new Compositor(); if (this.lite) this.comp.refineRadius = 1 } catch { this.setStatus('error') } }
    const needSeg = s.bg !== 'none' || (beautyOn(s) && (s.beauty > 0 || s.white > 0))   // 换背景要分割；磨皮美白也用分割限定在人身上
    const needFace = s.avatar === 'cat' || (beautyOn(s) && (s.slim > 0 || s.eyes > 0))   // 猫头、瘦脸、大眼要认脸
    if (needFace && !this.face) { this.everFound = false; this.faceReadyAt = 0 }
    if (s.avatar === 'cat' && !this.cat) { try { this.cat = new CatAvatar(this.lite ? 420 : 600) } catch { this.setStatus('error') } }
    const waits: Promise<unknown>[] = []
    if (needSeg && !this.seg) waits.push(loadSegmenter().then((g) => { this.seg = g }))
    if (needFace && !this.face) waits.push(loadFace().then((f) => { this.face = f; this.faceReadyAt = performance.now() }))
    if (waits.length) { this.setStatus('loading'); Promise.all(waits).then(() => this.setStatus('ready'), () => this.setStatus('error')) }
    else if (this.status !== 'error') this.setStatus('ready')
    void this.applyBackground()
  }

  private async applyBackground() {
    const key = this.s.bg
    if (key === this.bgKey) return
    this.bgKey = key
    const img = key.startsWith('img:') ? await bgImage(key.slice(4)).catch(() => null) : null
    if (key !== this.bgKey) return
    this.comp?.setBackground(img)
  }

  private setStatus(s: FxStatus) { if (s !== this.status) { this.status = s; this.onStatus?.(s) } }

  /** 新路：摄像头每来一帧就算一帧、写一帧。不看页面在不在前台 */
  private async pump(gen: number) {
    const r = this.reader
    if (!r) return
    while (gen === this.gen && this.running) {
      let res: ReadableStreamReadResult<VideoFrame>
      try { res = await r.read() } catch { break }
      if (res.done || !res.value) break
      const f = res.value
      const ts = f.timestamp
      if (gen !== this.gen || !this.running) { f.close(); break }
      try { this.frame(f) } catch { /* 单帧出错不中断，下一帧再来 */ } finally { f.close() }
      await this.emit(ts)
    }
  }

  /** 把输出画布当前的样子写进发出去的轨道（时间戳只增不减） */
  private async emit(ts: number) {
    const w = this.writer
    if (!w) return
    const t2 = Math.max(ts, this.lastOutTs + 1); this.lastOutTs = t2
    let vf: VideoFrame | null = null
    try { vf = new VideoFrame(this.out, { timestamp: t2 }); await w.write(vf); this.frames++ } catch { vf?.close() }
  }

  private loop(gen: number) {
    const v = this.video
    if (!v || gen !== this.gen || !this.running) return
    const next = () => this.loop(gen)
    try { this.frame(v); this.frames++ } catch { /* 单帧出错不中断，下一帧再来 */ }
    if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(next)
    else setTimeout(next, 33)
  }

  private frame(v: FrameSrc) {
    if (!srcSize(v).w) return
    const w = this.out.width, h = this.out.height
    const ts = Math.max(this.lastTs + 1, performance.now()); this.lastTs = ts
    const tick = this.tick++
    const detect = !this.lite || (tick & 1) === 0   // 手机隔一帧识别一次
    const bg = this.s.bg === 'none' ? 'none' : this.s.bg === 'blur' ? 'blur' : 'image'
    if (this.s.avatar === 'cat') {
      if (!this.cat || !this.comp) { this.paintCover(t('虚拟形象暂时不可用')); return }   // 绝不退回真人画面
      // 手机上人脸和分割错开帧算（一帧只算一样）；电脑每帧都算
      const doFace = this.lite ? (tick & 1) === 0 : true, doSeg = this.lite ? (tick & 1) === 1 : true
      if (this.face && doFace) this.detectFace(v, ts)
      if (this.seg && doSeg) this.runSeg(v, ts)
      else if (!this.seg) this.comp.setMask(null)
      this.placeCat(w, h)
      const a = this.cat.anchor, p = this.place
      const R = p.fw * 0.9                                 // 猫头半径 ≈ 0.9 个「脸宽」
      const veil = !p.seen || ts - this.faceAt > 600
      this.comp.render(v, { smooth: 0, white: 0, bg, veil })
      this.ctx.drawImage(this.comp.canvas, 0, 0, w, h)
      this.cat.render(this.pose, ts)
      const k = R / a.r
      const cw = this.cat.canvas.width * k, ch = this.cat.canvas.height * k
      this.ctx.drawImage(this.cat.canvas, p.x - a.x * k, p.y - a.y * k, cw, ch)
      return
    }
    if (!this.comp) { this.ctx.drawImage(v, 0, 0, w, h); return }
    const s = this.s, on = beautyOn(s)
    const wantFace = on && (s.slim > 0 || s.eyes > 0) && !!this.face
    const wantMask = (s.bg !== 'none' || (on && (s.beauty > 0 || s.white > 0))) && this.seg
    // 手机：要认脸时人脸和分割错开帧算，不要认脸就隔一帧分割；不识别的那一帧沿用上一帧的结果
    if (wantFace && (!this.lite || (tick & 1) === 0)) this.detectFace(v, ts)
    if (!wantMask) this.comp.setMask(null)
    else if (wantFace ? (!this.lite || (tick & 1) === 1) : detect) this.runSeg(v, ts)
    this.comp.render(v, { smooth: on ? s.beauty : 0, white: on ? s.white : 0, bg, warp: wantFace ? this.warpFor(w, h, ts) : null, skinR: this.skinR(w, h) })
    this.ctx.drawImage(this.comp.canvas, 0, 0, w, h)
  }

  /** 磨皮半径（像素）：按脸的大小走，脸大（离摄像头近）磨得开一点 */
  private skinR(w: number, h: number) {
    const f = this.pose
    return f.found && f.fw > 0 ? Math.min(16, Math.max(3, f.fw * w * 0.02)) : Math.max(3, h / 110)
  }

  /**
   * 瘦脸 / 大眼的变形点（人脸关键点编号是 MediaPipe 478 点那一套）：
   *   瘦脸 = 左右脸颊（234 / 454）、左右下颌（172 / 397）四个点往鼻尖（1）方向收，主要是横向；
   *   大眼 = 两只瞳孔（468 / 473）为中心放大，半径约一只眼的宽度（33-133 / 362-263）。
   * 前后两次结果平滑一下（不抖）；脸丢了超过 0.4 秒就不变形。
   */
  private warpFor(w: number, h: number, ts: number): Warp | null {
    const lm = this.pose.lm, s = this.s
    if (!lm || lm.length < 468 || ts - this.faceAt > 400) { this.warpPrev = null; return null }
    const A = w / h
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot((a.x - b.x) * A, a.y - b.y)
    const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    const nose = lm[1], faceW = dist(lm[234], lm[454])
    const slimP: number[] = [], slimM: number[] = []
    ;([[234, 0.16], [454, 0.16], [172, 0.22], [397, 0.22]] as const).forEach(([i, k]) => {
      const p = lm[i]
      slimP.push(p.x, p.y)
      slimM.push((nose.x - p.x) * k * s.slim, (nose.y - p.y) * k * s.slim * 0.3)
    })
    const eyes = lm.length >= 478 ? [lm[468], lm[473]] : [mid(lm[33], lm[133]), mid(lm[362], lm[263])]
    const next: Warp = {
      slimP, slimM, slimR: faceW * 0.42,
      eyeC: [eyes[0].x, eyes[0].y, eyes[1].x, eyes[1].y],
      eyeR: Math.max(dist(lm[33], lm[133]), dist(lm[362], lm[263])) * 1.05,
      eyeS: s.eyes * 0.22,
    }
    const p = this.warpPrev
    if (p) {
      const ease = (a: number, b: number) => a + (b - a) * 0.5
      next.slimP = next.slimP.map((v, i) => ease(p.slimP[i], v)); next.slimM = next.slimM.map((v, i) => ease(p.slimM[i], v))
      next.eyeC = next.eyeC.map((v, i) => ease(p.eyeC[i], v)); next.slimR = ease(p.slimR, next.slimR); next.eyeR = ease(p.eyeR, next.eyeR)
    }
    this.warpPrev = next
    return next
  }

  /** 认一帧脸；显卡认脸不灵时自动换 CPU（见 useFaceCpu） */
  private detectFace(v: FrameSrc, ts: number) {
    const face = this.face
    if (!face) return
    try { this.pose = readFace(face.detectForVideo(this.faceDown.draw(v), ts)) } catch (e) { this.pose = NO_FACE; this.lastErr = String(e).slice(0, 120); if (++this.faceErr > 3) this.useFaceCpu() }   // 显卡认脸一跑就报错：换 CPU
    if (this.pose.found) { this.faceAt = ts; this.faceMiss = 0; this.missSince = 0; this.everFound = true }
    else {
      this.faceMiss++
      // 显卡认脸在这台机器上不灵：画面里看得到人、却连续 4 秒认不出脸 → 换 CPU 再试，只换一次。
      // 只看「有人」的时候：主播离开镜头不算（2026-10-02 线上实测：以前离开 1.5 秒就换，电脑上没必要）
      if ((this.mask.person ?? 0) > 0.04) { if (!this.missSince) this.missSince = ts; if (ts - this.missSince > 4000) this.useFaceCpu() }
      else this.missSince = 0
      // 没开分割（原背景）时看不到「有没有人」：模型好了 6 秒一次脸都没认到，也换 CPU 试一次
      if (!this.everFound && this.faceReadyAt && ts - this.faceReadyAt > 6000) this.useFaceCpu()
    }
    if (!this.pose.found) { if (!this.noFaceSince) this.noFaceSince = ts; if (ts - this.noFaceSince > 1500) this.setStatus('noFace') }
    else { this.noFaceSince = 0; if (this.status === 'noFace') this.setStatus('ready') }
  }

  /** 认脸换成 CPU（只换一次）；换不了就保持虚化，不露脸 */
  private useFaceCpu() {
    if (this.faceCpu) return
    this.faceCpu = true
    loadFaceCpu().then((f) => { this.face = f; this.faceMiss = 0 }, () => { /* 保持虚化 */ })
  }

  /** 分割一帧；显卡那条路连续报错就换 CPU（只换一次），报错的这几帧不换背景 */
  private runSeg(v: FrameSrc, ts: number) {
    try {
      this.comp!.setMask(segment(this.seg!, this.segDown.draw(v), ts, this.mask) ? this.mask : null)
      this.segErr = 0
    } catch (e) {
      this.comp!.setMask(null)
      this.lastErr = String(e).slice(0, 120)
      if (++this.segErr > 3 && !this.segCpu) {
        this.segCpu = true
        const old = this.seg
        this.seg = null
        loadSegmenterCpu().then((g) => { this.seg = g }, () => { this.seg = old })
        this.useFaceCpu()   // 显卡这条路坏了，认脸多半也不灵，一起换
      }
    }
  }

  /** 猫跟着脸走：位置和大小平滑过去（不抖）；脸丢了就停在最后的位置 */
  private placeCat(w: number, h: number) {
    const p = this.place, f = this.pose
    if (!p.seen) { p.x = w / 2; p.y = h * 0.42; p.fw = Math.min(w, h) * (w > h ? 0.26 : 0.36) }
    if (f.found && f.fw > 0) {
      // 猫头要把整张脸连头发一起盖住（2026-10-02 goat：不要头发那块虚影，猫头往上放）：
      // 大小按脸宽、脸高取大的；中心从脸框中心往上挪 0.2 个脸高（goat：0.12 时还露头发），上沿盖到头发；
      // 猫头相应放大一点，下沿仍盖住下巴
      const tx = f.cx * w, ty = f.cy * h - f.fh * h * 0.2, tf = Math.max(f.fw * w, f.fh * h * 0.9)
      const k = p.seen ? 0.6 : 1   // 跟得快一点：慢了脸会从猫头边上露出来
      p.x += (tx - p.x) * k; p.y += (ty - p.y) * k; p.fw += (tf - p.fw) * k
      p.seen = true
    }
  }

  /** 运行状况（给测试用）：认脸换没换 CPU、连续认不到几次、画面里人占多少 */
  get diag() { return { faceCpu: this.faceCpu, segCpu: this.segCpu, faceMiss: this.faceMiss, person: this.mask.person ?? -1, hasFace: !!this.face, hasSeg: !!this.seg, lastErr: this.lastErr } }

  /** 是不是手机省电模式（给测试用） */
  get liteMode() { return this.lite }

  private paintCover(text: string) {
    const g = this.ctx, w = this.out.width, h = this.out.height
    g.fillStyle = '#0e0d16'; g.fillRect(0, 0, w, h)
    if (text) { g.fillStyle = 'rgba(255,255,255,.7)'; g.font = `500 ${Math.round(h / 24)}px -apple-system,"PingFang SC",sans-serif`; g.textAlign = 'center'; g.fillText(text, w / 2, h / 2) }
  }
}
