// The detection half of live effects (2026-10-02 goat: background swap, beautify, virtual avatar): MediaPipe person segmentation + face landmarks, all running in the streamer's own browser.
// · The detection engine (wasm) and both models are bundled into our own site (vite's ?url), never downloaded from Google's servers: the site security rules only allow our own origin,
//   and the streamer's video never passes through any third party because of this.
// · Loaded only when effects are enabled (the whole effects directory is lazy-loaded), so regular page opens are unaffected.
// · Detection runs on a downscaled picture (segmentation 256 wide, face 480 wide): results stay good enough while each frame costs much less compute.
import { FaceLandmarker, ImageSegmenter, type FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import MP_DIR from 'virtual:0x4-mediapipe'   // mediapipe-<version>, provided by vite.config.ts's mediapipeWasm plugin
import segModel from './models/selfie_segmenter.tflite?url'
import faceModel from './models/face_landmarker.task?url'

// The detection engine lives under our own site's assets/mediapipe-<version>/ (put there by vite.config.ts's mediapipeWasm plugin)
const MP = `${import.meta.env.BASE_URL}assets/${MP_DIR}/`
const FILESET = { wasmLoaderPath: `${MP}vision_wasm_internal.js`, wasmBinaryPath: `${MP}vision_wasm_internal.wasm` }

let segP: Promise<ImageSegmenter> | null = null
let segCpuP: Promise<ImageSegmenter> | null = null
let faceP: Promise<FaceLandmarker> | null = null
let faceCpuP: Promise<FaceLandmarker> | null = null

// GPU first; on phones / embedded browsers where the GPU path can't be built, fall back to CPU (slower, but works)
async function gpuThenCpu<T>(make: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T> {
  try { return await make('GPU') } catch { return make('CPU') }
}

const segOpts = (delegate: 'GPU' | 'CPU') => ImageSegmenter.createFromOptions(FILESET, {
  baseOptions: { modelAssetPath: segModel, delegate },
  runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false,
})

/** Person segmenter (for backgrounds): built once, reused afterwards */
export function loadSegmenter(): Promise<ImageSegmenter> {
  return (segP ??= gpuThenCpu(segOpts).catch((e) => { segP = null; throw e }))
}

/** CPU-only segmenter: switched to when the GPU path errors as soon as it runs (see processor) */
export function loadSegmenterCpu(): Promise<ImageSegmenter> {
  return (segCpuP ??= segOpts('CPU').catch((e) => { segCpuP = null; throw e }))
}

const faceOpts = (delegate: 'GPU' | 'CPU') => FaceLandmarker.createFromOptions(FILESET, {
  baseOptions: { modelAssetPath: faceModel, delegate },
  runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
})

/** Face landmarks (for the virtual avatar): needs expression coefficients (blink, mouth open…) and the head pose matrix */
export function loadFace(): Promise<FaceLandmarker> {
  return (faceP ??= gpuThenCpu(faceOpts).catch((e) => { faceP = null; throw e }))
}

/**
 * CPU-only face detection: on some phones (and the Android emulator) the GPU path builds fine but never detects a face and errors as soon as segmentation runs (measured 2026-10-02 on the emulator).
 * The processor switches to this when the GPU path proves broken (errors, or never detects a face).
 */
export function loadFaceCpu(): Promise<FaceLandmarker> {
  return (faceCpuP ??= faceOpts('CPU').catch((e) => { faceCpuP = null; throw e }))
}

/** Downscale one video frame to w wide (keeping aspect ratio), for detection */
/** One camera frame: the old path is <video>; Chrome / Edge take the new path — VideoFrames read straight off the camera track (frames keep coming in the background, see processor.ts) */
export type FrameSrc = HTMLVideoElement | VideoFrame
export const srcSize = (s: FrameSrc): { w: number; h: number } => (s instanceof HTMLVideoElement ? { w: s.videoWidth, h: s.videoHeight } : { w: s.displayWidth, h: s.displayHeight })

export class Downscaler {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  constructor(private width: number) {
    this.canvas = document.createElement('canvas')
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false })!
  }
  draw(src: FrameSrc): HTMLCanvasElement {
    const z = srcSize(src)
    const vw = z.w || 640, vh = z.h || 360
    const w = this.width, h = Math.max(1, Math.round(w * vh / vw))
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h }
    this.ctx.drawImage(src, 0, 0, w, h)
    return this.canvas
  }
}

/** Segment one frame: returns a 0–255 person mask (same size as input), for compositing */
/** out.person = the fraction of the frame occupied by the person (0–1) */
export function segment(seg: ImageSegmenter, frame: HTMLCanvasElement, ts: number, out: { data: Uint8Array; w: number; h: number; person?: number }): boolean {
  const r = seg.segmentForVideo(frame, ts)
  const m = r.confidenceMasks?.[0]
  if (!m) { r.close(); return false }
  const f = m.getAsFloat32Array()
  const n = m.width * m.height
  // Blend with the previous frame's mask: where change is small (edge jitter) the new mask only counts 35%, keeping the outline steady;
  // where change is large (the person moving) the new one counts 75%, tracking fast without jumping (2026-10-02 goat: the edges still jittered)
  const keep = out.data.length === n && out.w === m.width
  if (!keep) out.data = new Uint8Array(n)
  let people = 0
  for (let i = 0; i < n; i++) {
    const v = f[i] * 255
    out.data[i] = !keep ? v : Math.abs(v - out.data[i]) < 70 ? v * 0.35 + out.data[i] * 0.65 : v * 0.75 + out.data[i] * 0.25
    if (f[i] > 0.5) people++
  }
  out.w = m.width; out.h = m.height; out.person = people / n
  r.close()
  return true
}

/** What drives the cat head: blink, mouth open, smile, raised brow, head rotation (radians); the face's position in the frame (cx, cy = face-box center; fw = face width, fh = face height — all normalized 0–1 against frame size) */
export interface FacePose { found: boolean; blinkL: number; blinkR: number; jaw: number; smile: number; brow: number; yaw: number; pitch: number; roll: number; cx: number; cy: number; fw: number; fh: number
  /** 478 face landmarks (0–1, origin top-left; for face slimming, eye enlargement) */
  lm?: { x: number; y: number }[] }
export const NO_FACE: FacePose = { found: false, blinkL: 0, blinkR: 0, jaw: 0, smile: 0, brow: 0, yaw: 0, pitch: 0, roll: 0, cx: 0.5, cy: 0.4, fw: 0, fh: 0 }

export function readFace(r: FaceLandmarkerResult): FacePose {
  const bs = r.faceBlendshapes?.[0]?.categories
  const mx = r.facialTransformationMatrixes?.[0]?.data
  if (!bs || !mx) return NO_FACE
  const g = (name: string) => bs.find((c) => c.categoryName === name)?.score ?? 0
  // Face box: the bounding box of all landmarks
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0
  for (const p of r.faceLandmarks?.[0] ?? []) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y }
  if (x1 <= x0) return NO_FACE
  // 4×4 column-major rotation matrix → Euler angles (Y yaw, X pitch, Z roll)
  const m00 = mx[0], m10 = mx[1], m20 = mx[2], m21 = mx[6], m22 = mx[10]
  return {
    found: true,
    blinkL: g('eyeBlinkLeft'), blinkR: g('eyeBlinkRight'),
    jaw: Math.max(g('jawOpen'), g('mouthFunnel') * 0.6),
    smile: (g('mouthSmileLeft') + g('mouthSmileRight')) / 2,
    brow: Math.max(g('browInnerUp'), (g('browOuterUpLeft') + g('browOuterUpRight')) / 2),
    yaw: Math.atan2(-m20, Math.hypot(m21, m22)),
    pitch: Math.atan2(m21, m22),
    roll: Math.atan2(m10, m00),
    cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, fw: x1 - x0, fh: y1 - y0,
    lm: r.faceLandmarks?.[0],
  }
}
