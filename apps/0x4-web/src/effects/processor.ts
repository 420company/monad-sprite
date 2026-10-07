// Livestream effects pipeline: raw camera frames → detection + compositing → new video track handed to LiveKit for publishing (2026-10-02).
// · Uses LiveKit's TrackProcessor interface: attached when the camera opens (VideoCaptureOptions.processor), so frames are processed before publishing;
//   toggling mid-stream uses setProcessor / stopProcessor. The host's own preview is exactly what viewers see.
// · Cat-head mode (2026-10-02 goat: background and body stay as-is, only the cat head covers the face — no cat body):
//   bottom layer = camera frame (background swap / blur as usual);
//   top layer = the cat head, pasted per this frame's face position and size (move closer and it grows, move aside and it follows).
//   no-face guarantee: if no face detected yet, or the face lost for over 0.6s, the whole frame gets heavily blurred until a face is found again; on error output a dark background with a message — never fall back to the real face.
// · Background swap waits for the person-segmentation model to load (about 1–2s the first time); beauty filters only until then.
// · Viewers froze when switching to another tab/window (2026-10-03 goat): previously each frame was driven by the <video> frame callback and output via canvas.captureStream,
//   and Chrome pauses frame rendering for background tabs — no callback, no frames. Now Chrome/Edge take the new path: MediaStreamTrackProcessor reads frames straight from the camera track,
//   and processed frames go straight into the published track via MediaStreamTrackGenerator — the whole path no longer depends on page rendering, so frames keep flowing in the background. Browsers without these two APIs (Safari etc.) take the old path.
// · Mobile (2026-10-02 goat: mobile-app hosts need it too) uses power-saving mode: detection runs on a smaller frame, every other frame (frames in between reuse the previous result,
//   the cat head already has smoothing so it's invisible), output capped at 720p. Long streams won't overheat the phone; desktop still processes every frame.
import type { Track, TrackProcessor, VideoProcessorOptions } from 'livekit-client'
import type { FaceLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision'
import { Compositor, type Warp } from './compositor'
import { CatAvatar } from './catAvatar'
import { Downscaler, NO_FACE, loadFace, loadFaceCpu, loadSegmenter, loadSegmenterCpu, readFace, segment, srcSize, type FacePose, type FrameSrc } from './engine'
import { beautyOn, bgImage, type FxSettings } from './settings'
import { t } from '@/lib/i18n'
import { WEB_SURFACE } from '@/lib/surface'

/** Mobile (app, mobile web): everything except the web build counts; web opened in a phone browser (touch-first) counts too */
function isPhone() {
  if (!WEB_SURFACE) return true
  try { return matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches } catch { return false }
}

export type FxStatus = 'loading' | 'ready' | 'noFace' | 'error'

// Two Chrome/Edge-only interfaces (missing from TypeScript's built-in types)
type TrackReaderCtor = new (init: { track: MediaStreamTrack; maxBufferSize?: number }) => { readable: ReadableStream<VideoFrame> }
type TrackWriterCtor = new (init: { kind: 'video' }) => MediaStreamTrack & { writable: WritableStream<VideoFrame> }
/** Whether the "no page-render dependency" new path can be used (set window.__fxLegacy = true in tests to force the old path) */
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
  // New path: read frames from the camera / write frames into the output track
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null
  private writer: WritableStreamDefaultWriter<VideoFrame> | null = null
  private lastOutTs = -1
  /** Processed frame count (walkthrough tests use it to confirm frames keep flowing in the background) */
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
  private faceMiss = 0           // Consecutive frames without a detected face
  private missSince = 0          // When the "person visible but no face detected" state started
  private faceErr = 0            // Face-detection error count
  private faceReadyAt = 0        // When the face model finished loading
  private everFound = false      // Whether a face has been detected at all this stream
  private warpPrev: Warp | null = null
  private faceCpu = false        // Face detection already switched to CPU
  private segCpu = false         // Segmentation already switched to CPU
  private segErr = 0             // Consecutive segmentation errors
  private lastErr = ''
  private pose: FacePose = NO_FACE
  // Where the cat head sits (output-frame pixels): follows the face smoothly; placed slightly above center before any face is seen
  private place = { x: 0, y: 0, fw: 0, seen: false }
  private faceAt = 0     // Last time a face was detected
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
      void this.emit(0)                        // Send a dark background first, wait for the real frames
      void this.pump(gen)
      return
    }
    const v = document.createElement('video')
    v.muted = true; v.playsInline = true; v.autoplay = true
    // In the page but invisible: on iPhones a video element outside the page may stop producing frames
    v.setAttribute('aria-hidden', 'true')
    Object.assign(v.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' })
    document.body.appendChild(v)
    v.srcObject = new MediaStream([opts.track])
    await v.play().catch(() => { /* Some browsers need the first frame; the loop below waits */ })
    if (gen !== this.gen) return
    this.video = v
    const st = opts.track.getSettings()
    let ow = st.width || v.videoWidth || 1280, oh = st.height || v.videoHeight || 720
    // Mobile output capped at 720p (short side 720), saving GPU and upload bandwidth
    const cap = this.lite ? Math.min(1, 720 / Math.min(ow, oh)) : 1
    ow = Math.round(ow * cap); oh = Math.round(oh * cap)
    this.out.width = ow; this.out.height = oh
    this.paintCover('')                      // Lay a dark background for the first frame, wait for the real frames
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

  /** Change settings (no camera restart needed): needed models load on demand, background image swaps on demand */
  update(s: FxSettings) {
    this.s = s
    if (!this.comp) { try { this.comp = new Compositor(); if (this.lite) this.comp.refineRadius = 1 } catch { this.setStatus('error') } }
    const needSeg = s.bg !== 'none' || (beautyOn(s) && (s.beauty > 0 || s.white > 0))   // Background swap needs segmentation; skin smoothing/whitening also uses segmentation to stay on the person
    const needFace = s.avatar === 'cat' || (beautyOn(s) && (s.slim > 0 || s.eyes > 0))   // Cat head, face slimming, eye enlarging need face detection
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

  /** New path: process and write one frame per camera frame. Doesn't care whether the page is in the foreground */
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
      try { this.frame(f) } catch { /* A single bad frame doesn't break the loop; the next frame comes */ } finally { f.close() }
      await this.emit(ts)
    }
  }

  /** Write the output canvas' current state into the published track (timestamps only ever increase) */
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
    try { this.frame(v); this.frames++ } catch { /* A single bad frame doesn't break the loop; the next frame comes */ }
    if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(next)
    else setTimeout(next, 33)
  }

  private frame(v: FrameSrc) {
    if (!srcSize(v).w) return
    const w = this.out.width, h = this.out.height
    const ts = Math.max(this.lastTs + 1, performance.now()); this.lastTs = ts
    const tick = this.tick++
    const detect = !this.lite || (tick & 1) === 0   // Mobile detects every other frame
    const bg = this.s.bg === 'none' ? 'none' : this.s.bg === 'blur' ? 'blur' : 'image'
    if (this.s.avatar === 'cat') {
      if (!this.cat || !this.comp) { this.paintCover(t('虚拟形象暂时不可用')); return }   // Never fall back to the real face
      // On mobile, face and segmentation run on alternating frames (one per frame); desktop computes both every frame
      const doFace = this.lite ? (tick & 1) === 0 : true, doSeg = this.lite ? (tick & 1) === 1 : true
      if (this.face && doFace) this.detectFace(v, ts)
      if (this.seg && doSeg) this.runSeg(v, ts)
      else if (!this.seg) this.comp.setMask(null)
      this.placeCat(w, h)
      const a = this.cat.anchor, p = this.place
      const R = p.fw * 0.9                                 // Cat-head radius ≈ 0.9 "face widths"
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
    // Mobile: face and segmentation alternate when face detection is on; segmentation every other frame when it's off; the skipped frame reuses the previous result
    if (wantFace && (!this.lite || (tick & 1) === 0)) this.detectFace(v, ts)
    if (!wantMask) this.comp.setMask(null)
    else if (wantFace ? (!this.lite || (tick & 1) === 1) : detect) this.runSeg(v, ts)
    this.comp.render(v, { smooth: on ? s.beauty : 0, white: on ? s.white : 0, bg, warp: wantFace ? this.warpFor(w, h, ts) : null, skinR: this.skinR(w, h) })
    this.ctx.drawImage(this.comp.canvas, 0, 0, w, h)
  }

  /** Skin-smoothing radius (px): scales with face size — bigger face (closer to camera) smooths more */
  private skinR(w: number, h: number) {
    const f = this.pose
    return f.found && f.fw > 0 ? Math.min(16, Math.max(3, f.fw * w * 0.02)) : Math.max(3, h / 110)
  }

  /**
   * Warp points for face slimming / eye enlarging (landmark indices follow MediaPipe's 478-point set):
   *   slimming = left/right cheeks (234 / 454) and left/right jaw (172 / 397) pulled toward the nose tip (1), mostly horizontally;
   *   enlarging = eyes scaled around each pupil (468 / 473), radius ≈ one eye width (33-133 / 362-263).
   * Smooth consecutive results (no jitter); stop warping once the face has been lost for over 0.4s.
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

  /** Detect a face in one frame; auto-switch to CPU when GPU detection misbehaves (see useFaceCpu) */
  private detectFace(v: FrameSrc, ts: number) {
    const face = this.face
    if (!face) return
    try { this.pose = readFace(face.detectForVideo(this.faceDown.draw(v), ts)) } catch (e) { this.pose = NO_FACE; this.lastErr = String(e).slice(0, 120); if (++this.faceErr > 3) this.useFaceCpu() }   // GPU face detection errors as soon as it runs: switch to CPU
    if (this.pose.found) { this.faceAt = ts; this.faceMiss = 0; this.missSince = 0; this.everFound = true }
    else {
      this.faceMiss++
      // GPU face detection misbehaves on this machine: a person is visible but no face detected for 4s straight → switch to CPU and retry, only once.
      // Only count "person visible" frames: host stepping out of frame doesn't count (2026-10-02 live test: previously it switched after 1.5s away — unnecessary on desktop)
      if ((this.mask.person ?? 0) > 0.04) { if (!this.missSince) this.missSince = ts; if (ts - this.missSince > 4000) this.useFaceCpu() }
      else this.missSince = 0
      // Without segmentation (original background) there's no "person visible" signal: if the model is ready and still sees no face after 6s, try CPU once
      if (!this.everFound && this.faceReadyAt && ts - this.faceReadyAt > 6000) this.useFaceCpu()
    }
    if (!this.pose.found) { if (!this.noFaceSince) this.noFaceSince = ts; if (ts - this.noFaceSince > 1500) this.setStatus('noFace') }
    else { this.noFaceSince = 0; if (this.status === 'noFace') this.setStatus('ready') }
  }

  /** Switch face detection to CPU (only once); if it can't switch, stay blurred — never show the face */
  private useFaceCpu() {
    if (this.faceCpu) return
    this.faceCpu = true
    loadFaceCpu().then((f) => { this.face = f; this.faceMiss = 0 }, () => { /* Stay blurred */ })
  }

  /** Segment one frame; if the GPU path errors consecutively, switch to CPU (only once) — keep the background unchanged for the bad frames */
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
        this.useFaceCpu()   // If the GPU path is broken, face detection is probably broken too — switch both
      }
    }
  }

  /** Cat head follows the face: position and size ease over (no jitter); when the face is lost, stay at the last position */
  private placeCat(w: number, h: number) {
    const p = this.place, f = this.pose
    if (!p.seen) { p.x = w / 2; p.y = h * 0.42; p.fw = Math.min(w, h) * (w > h ? 0.26 : 0.36) }
    if (f.found && f.fw > 0) {
      // The cat head must cover the whole face including hair (2026-10-02 goat: no ghosting on the hair — move the cat head up):
      // size takes the larger of face width/height; center shifted up 0.2 face-heights from the face-box center (goat: 0.12 still showed hair), top edge covering the hair;
      // cat head enlarged accordingly, bottom edge still covering the chin
      const tx = f.cx * w, ty = f.cy * h - f.fh * h * 0.2, tf = Math.max(f.fw * w, f.fh * h * 0.9)
      const k = p.seen ? 0.6 : 1   // Follow a bit faster: too slow and the face peeks out from the cat head's edge
      p.x += (tx - p.x) * k; p.y += (ty - p.y) * k; p.fw += (tf - p.fw) * k
      p.seen = true
    }
  }

  /** Health (for tests): whether face detection switched to CPU, consecutive miss count, person coverage ratio */
  get diag() { return { faceCpu: this.faceCpu, segCpu: this.segCpu, faceMiss: this.faceMiss, person: this.mask.person ?? -1, hasFace: !!this.face, hasSeg: !!this.seg, lastErr: this.lastErr } }

  /** Whether in mobile power-saving mode (for tests) */
  get liteMode() { return this.lite }

  private paintCover(text: string) {
    const g = this.ctx, w = this.out.width, h = this.out.height
    g.fillStyle = '#0e0d16'; g.fillRect(0, 0, w, h)
    if (text) { g.fillStyle = 'rgba(255,255,255,.7)'; g.font = `500 ${Math.round(h / 24)}px -apple-system,"PingFang SC",sans-serif`; g.textAlign = 'center'; g.fillText(text, w / 2, h / 2) }
  }
}
