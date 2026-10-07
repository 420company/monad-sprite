// 直播特效的识别部分（2026-10-02 goat：换背景、美颜、虚拟形象）：MediaPipe 人像分割 + 人脸关键点，全在主播自己的浏览器里跑。
// · 识别引擎（wasm）和两个模型都打包进我们自己的站点（vite 的 ?url），不从谷歌的服务器下载：站点安全规则只放行自己的地址，
//   主播的画面也不会因为这个经过任何第三方。
// · 只在打开特效时才加载（整个 effects 目录都是按需加载的），普通用户打开网页不受影响。
// · 送进识别的是缩小的画面（分割 256 宽、人脸 480 宽）：结果一样够用，每帧省很多算力。
import { FaceLandmarker, ImageSegmenter, type FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import MP_DIR from 'virtual:0x4-mediapipe'   // mediapipe-<版本>，vite.config.ts 的 mediapipeWasm 插件给
import segModel from './models/selfie_segmenter.tflite?url'
import faceModel from './models/face_landmarker.task?url'

// 识别引擎放在我们自己站点的 assets/mediapipe-<版本>/（vite.config.ts 的 mediapipeWasm 插件放进去）
const MP = `${import.meta.env.BASE_URL}assets/${MP_DIR}/`
const FILESET = { wasmLoaderPath: `${MP}vision_wasm_internal.js`, wasmBinaryPath: `${MP}vision_wasm_internal.wasm` }

let segP: Promise<ImageSegmenter> | null = null
let segCpuP: Promise<ImageSegmenter> | null = null
let faceP: Promise<FaceLandmarker> | null = null
let faceCpuP: Promise<FaceLandmarker> | null = null

// 先用显卡算；有的手机 / 内置浏览器显卡这条路建不起来，就退回 CPU（慢一点，但能用）
async function gpuThenCpu<T>(make: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T> {
  try { return await make('GPU') } catch { return make('CPU') }
}

const segOpts = (delegate: 'GPU' | 'CPU') => ImageSegmenter.createFromOptions(FILESET, {
  baseOptions: { modelAssetPath: segModel, delegate },
  runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false,
})

/** 人像分割器（背景用）：只建一次，后面复用 */
export function loadSegmenter(): Promise<ImageSegmenter> {
  return (segP ??= gpuThenCpu(segOpts).catch((e) => { segP = null; throw e }))
}

/** 只用 CPU 的分割器：显卡那条路一跑就报错时换这个（见 processor） */
export function loadSegmenterCpu(): Promise<ImageSegmenter> {
  return (segCpuP ??= segOpts('CPU').catch((e) => { segCpuP = null; throw e }))
}

const faceOpts = (delegate: 'GPU' | 'CPU') => FaceLandmarker.createFromOptions(FILESET, {
  baseOptions: { modelAssetPath: faceModel, delegate },
  runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
})

/** 人脸关键点（虚拟形象用）：要表情系数（眨眼、张嘴……）和头部姿态矩阵 */
export function loadFace(): Promise<FaceLandmarker> {
  return (faceP ??= gpuThenCpu(faceOpts).catch((e) => { faceP = null; throw e }))
}

/**
 * 只用 CPU 的人脸识别：有的手机（还有安卓模拟器）显卡这条路能建起来、却永远认不出脸、分割一跑就报错（2026-10-02 模拟器实测）。
 * processor 发现显卡这条路不灵（报错、或一直认不到脸）时换成这个。
 */
export function loadFaceCpu(): Promise<FaceLandmarker> {
  return (faceCpuP ??= faceOpts('CPU').catch((e) => { faceCpuP = null; throw e }))
}

/** 把一帧画面缩小到 w 宽（保持比例），给识别用 */
/** 摄像头的一帧：老路是 <video>；Chrome / Edge 走新路，直接从摄像头轨道读出来的 VideoFrame（切到后台也照样有帧，见 processor.ts） */
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

/** 分割一帧：返回 0~255 的人像遮罩（宽高同输入），给合成用 */
/** out.person = 画面里人占的比例（0~1） */
export function segment(seg: ImageSegmenter, frame: HTMLCanvasElement, ts: number, out: { data: Uint8Array; w: number; h: number; person?: number }): boolean {
  const r = seg.segmentForVideo(frame, ts)
  const m = r.confidenceMasks?.[0]
  if (!m) { r.close(); return false }
  const f = m.getAsFloat32Array()
  const n = m.width * m.height
  // 和上一帧的遮罩混一下：变化小的地方（边缘抖动）新的只占 35%，轮廓很稳；
  // 变化大的地方（人在动）新的占 75%，跟得上又不至于一下子跳（2026-10-02 goat：边缘还是乱跳）
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

/** 驱动猫头要用的几样：眨眼、张嘴、笑、挑眉、头的转动（弧度）；脸在画面里的位置（cx、cy 是脸框中心，fw 脸宽、fh 脸高，都按画面宽高归一到 0~1） */
export interface FacePose { found: boolean; blinkL: number; blinkR: number; jaw: number; smile: number; brow: number; yaw: number; pitch: number; roll: number; cx: number; cy: number; fw: number; fh: number
  /** 478 个人脸关键点（0~1，原点左上；瘦脸、大眼用） */
  lm?: { x: number; y: number }[] }
export const NO_FACE: FacePose = { found: false, blinkL: 0, blinkR: 0, jaw: 0, smile: 0, brow: 0, yaw: 0, pitch: 0, roll: 0, cx: 0.5, cy: 0.4, fw: 0, fh: 0 }

export function readFace(r: FaceLandmarkerResult): FacePose {
  const bs = r.faceBlendshapes?.[0]?.categories
  const mx = r.facialTransformationMatrixes?.[0]?.data
  if (!bs || !mx) return NO_FACE
  const g = (name: string) => bs.find((c) => c.categoryName === name)?.score ?? 0
  // 脸框：所有关键点的外接框
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0
  for (const p of r.faceLandmarks?.[0] ?? []) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y }
  if (x1 <= x0) return NO_FACE
  // 4×4 列主序旋转矩阵 → 欧拉角（Y 偏航、X 俯仰、Z 翻滚）
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
