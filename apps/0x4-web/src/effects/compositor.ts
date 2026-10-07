// Beauty + background-swap compositing (WebGL2, single pass):
// - Beauty (2026-10-02 goat: TikTok-style, four controls — smooth / whiten / slim-face / big-eyes):
//   Smooth = edge-preserving blur (3 rings × 24 taps) within skin regions (dissimilar colors don't blend, brow/eye contours stay crisp), then a touch of fine texture back in — never plastic; radius follows face size.
//   Whiten = brighten skin (shadows lifted most), de-yellow a touch, add a hint of glow.
//   Slim-face / big-eyes = sample-position warp: four cheek/jaw points pulled toward the nose; both eyes enlarged about the pupils. Landmarks computed by the processor from face keypoints.
// - Background: blur = the blurry mip level of the camera frame's mipmap chain, nearly free; image = cover-fit to the frame.
// - The person mask comes from engine.segment (0–255) at only ~256×144; naive upscaling blurs edges and shrinks inward, "eating" face and clothing edges (2026-10-02 goat).
//   So upscaling aligns edges to the source frame's colors (joint bilateral upsampling): the surrounding 5×5 mask taps are weighted by "how much this pixel resembles each color",
//   person-like colors count as person, background-like as background — edges hug the true contour; a narrow smoothstep finishes the edge.
//   Thresholds: first 0.4–0.62 (feared a ring of the original room outside the hair); goat's testing showed edges still jumping and getting eaten, asked for more margin around the person → changed to 0.18–0.46.
// - Textures aren't flipped; shaders sample (u, 1-v) uniformly so output matches the camera orientation (mirroring is the preview UI's own business; the sent stream isn't mirrored).
// - Cat-head mode (2026-10-02 goat: background and body unchanged, just a cat head covering the face): composited like person mode, cat head drawn on top by the processor.
//   An attempt to paint hair peeking around the cat head into the background looked ghostly-ugly to goat — removed; the cat head now sits higher, covering the hair.
//   veil: no face detected yet, or face lost for a while — the whole frame blurs heavily (no face shown until the cat head is aligned).
import { srcSize, type FrameSrc } from './engine'

export type BgMode = 'none' | 'blur' | 'image'
/** veil = heavy whole-frame blur (used in cat-head mode before a face is detected) */
export interface FxLook { smooth: number; white: number; bg: BgMode; veil?: boolean; warp?: Warp | null; skinR?: number }
/** Slim-face / big-eyes warp params: coords 0–1 (origin top-left), radius in frame-height units */
export interface Warp { slimP: number[]; slimM: number[]; slimR: number; eyeC: number[]; eyeR: number; eyeS: number }

const VS = `#version 300 es
in vec2 p; out vec2 vUv;
void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

const FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uCam, uMask, uBg;
uniform int uBgMode;
uniform float uSmooth, uWhite, uSkinR, uHasMask, uVeil, uAspect, uWarp;
uniform vec2 uSlimP[4], uSlimM[4], uEyeC[2];
uniform float uSlimR, uEyeR, uEyeS;
uniform vec2 uTexel, uBgScale, uMaskTexel;
uniform int uRad;

// 皮肤颜色范围（YCbCr），只对皮肤磨皮
float skin(vec3 c){
  float cb = -0.1687*c.r - 0.3313*c.g + 0.5*c.b;
  float cr = 0.5*c.r - 0.4187*c.g - 0.0813*c.b;
  return smoothstep(0.02, 0.06, cr) * (1.0 - smoothstep(0.17, 0.22, cr)) * smoothstep(-0.20, -0.14, cb) * (1.0 - smoothstep(0.02, 0.06, cb));
}
// 瘦脸 / 大眼：算出这个像素该从哪里取样
vec2 warp(vec2 uv){
  if (uWarp < 0.5) return uv;
  vec2 A = vec2(uAspect, 1.0);
  for (int i = 0; i < 4; i++) {
    vec2 d = (uv - uSlimP[i]) * A;
    float w = 1.0 - dot(d, d) / (uSlimR * uSlimR);
    if (w > 0.0) uv -= uSlimM[i] * w * w;     // 脸边往里收 = 从外面一点取样
  }
  for (int i = 0; i < 2; i++) {
    float r = length((uv - uEyeC[i]) * A) / uEyeR;
    if (r < 1.0) uv = uEyeC[i] + (uv - uEyeC[i]) * (1.0 - uEyeS * (1.0 - r * r));   // 越靠近瞳孔放得越大
  }
  return uv;
}
vec3 beauty(vec2 uv){
  vec3 c = texture(uCam, uv).rgb;
  if (uSmooth <= 0.001 && uWhite <= 0.001) return c;
  // 皮肤 = 肤色范围 ∩ 人像（有分割结果时）：米色墙、木地板颜色像皮肤，但不在人身上（2026-10-02 实测）
  // 哪里是皮肤：按一小片（多级缩小图第 3 级）整体判断，不逐像素——逐像素时雀斑、痘印本身不算皮肤，
  // 周围提亮了它没提亮，美白后反而一块一块（2026-10-02 实测）。太暗的（头发、眉毛）不算：棕色头发颜色像皮肤，会被磨糊。
  // 人像边缘（头发和墙交界）也不算：只取遮罩很确定是人的地方，不然美白会在头发边上描出一圈白边。
  vec3 cb = textureLod(uCam, uv, 3.0).rgb;
  float sk = skin(cb) * smoothstep(0.22, 0.38, dot(cb, vec3(0.299, 0.587, 0.114)))
           * (uHasMask > 0.5 ? smoothstep(0.7, 0.95, texture(uMask, uv).r) : 1.0);
  if (sk < 0.01) return c;
  vec3 r = c;
  if (uSmooth > 0.001) {
    vec3 sum = c; float ws = 1.0;
    for (int i = 0; i < 24; i++) {
      float ring = float(i / 8);
      float a = float(i) * 0.7854 + ring * 0.3927;
      vec3 s = texture(uCam, uv + vec2(cos(a), sin(a)) * (1.0 + ring * 1.2) * uSkinR * uTexel).rgb;
      vec3 d = s - c;
      float w = exp(-dot(d, d) * 14.0);       // 颜色差得多的不混：保住五官轮廓（雀斑、痘印这种小色差要混掉）
      sum += s * w; ws += w;
    }
    // 细纹理：和上下左右的差，加回一点，皮肤不会像塑料
    vec3 near = (texture(uCam, uv + vec2(uTexel.x, 0.0)).rgb + texture(uCam, uv - vec2(uTexel.x, 0.0)).rgb + texture(uCam, uv + vec2(0.0, uTexel.y)).rgb + texture(uCam, uv - vec2(0.0, uTexel.y)).rgb) * 0.25;
    r = mix(c, sum / ws + (c - near) * (0.3 - 0.2 * uSmooth), min(1.0, uSmooth * 1.15) * sk);   // 磨得越狠，加回的纹理越少
  }
  if (uWhite > 0.001) {
    float k = uWhite * sk;
    r = 1.0 - pow(1.0 - clamp(r, 0.0, 1.0), vec3(1.0 + 0.9 * k));   // 提亮，暗部提得多
    r = mix(r, vec3(dot(r, vec3(0.299, 0.587, 0.114))), 0.12 * k);   // 去一点黄
    r += vec3(0.025, 0.0, 0.012) * k;                                 // 一点气色
  }
  return clamp(r, 0.0, 1.0);
}
// 按原画面颜色对齐的人像遮罩（见文件开头）。uRad = 取样半径（电脑 2 = 5×5，手机 1 = 3×3）
float refineMask(vec2 uv){
  vec3 c = textureLod(uCam, uv, 1.0).rgb;
  float sum = 0.0, ws = 0.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    if (abs(i) > uRad || abs(j) > uRad) continue;
    vec2 o = vec2(float(i), float(j)) * uMaskTexel;
    vec3 d = textureLod(uCam, uv + o, 1.0).rgb - c;
    float w = exp(-dot(d, d) * 25.0) * exp(-float(i * i + j * j) * 0.35);   // 颜色权重别太狠：太狠时摄像头噪点会让边缘一闪一闪
    sum += texture(uMask, uv + o).r * w; ws += w;
  }
  return sum / max(ws, 1e-4);
}
void main(){
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  if (uVeil > 0.5) { o = vec4((textureLod(uCam, uv, 5.0).rgb + textureLod(uCam, uv, 6.0).rgb) * 0.5, 1.0); return; }
  vec2 wuv = warp(uv);
  vec3 person = beauty(wuv);
  if (uBgMode == 0 || uHasMask < 0.5) { o = vec4(person, 1.0); return; }
  float m = smoothstep(0.18, 0.46, refineMask(wuv));   // 界线偏背景一侧：人周围留一圈余量，不吃脸边衣服边（goat 2026-10-02 第二次反馈）
  vec3 bg;
  if (uBgMode == 1) {
    bg = (textureLod(uCam, uv, 4.5).rgb + textureLod(uCam, uv + uTexel * 24.0, 5.0).rgb + textureLod(uCam, uv - uTexel * 24.0, 5.0).rgb) / 3.0;
  } else {
    bg = texture(uBg, (uv - 0.5) * uBgScale + 0.5).rgb;
  }
  o = vec4(mix(bg, person, m), 1.0);
}`

export class Compositor {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private prog: WebGLProgram
  private cam: WebGLTexture
  private mask: WebGLTexture
  private bg: WebGLTexture
  private bgSize = { w: 1, h: 1 }
  private hasMask = false
  private maskSize = { w: 256, h: 144 }
  /** Mask edge-alignment sample radius: 2 on desktop (5×5), 1 on phones (3×3, saves GPU) */
  refineRadius = 2
  private u: Record<string, WebGLUniformLocation | null> = {}

  constructor() {
    this.canvas = document.createElement('canvas')
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: false, antialias: false })
    if (!gl) throw new Error('webgl2')
    this.gl = gl
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader'); return s }
    const p = gl.createProgram()!
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link')
    this.prog = p
    gl.useProgram(p)
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)   // One big triangle covering the screen
    const loc = gl.getAttribLocation(p, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    for (const n of ['uCam', 'uMask', 'uBg', 'uBgMode', 'uSmooth', 'uWhite', 'uSkinR', 'uHasMask', 'uVeil', 'uAspect', 'uWarp', 'uSlimP', 'uSlimM', 'uEyeC', 'uSlimR', 'uEyeR', 'uEyeS', 'uTexel', 'uBgScale', 'uMaskTexel', 'uRad']) this.u[n] = gl.getUniformLocation(p, n)
    const tex = (unit: number, mip: boolean) => {
      const t = gl.createTexture()!; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      return t
    }
    this.cam = tex(0, true); this.mask = tex(1, false); this.bg = tex(2, false)
    gl.uniform1i(this.u.uCam, 0); gl.uniform1i(this.u.uMask, 1); gl.uniform1i(this.u.uBg, 2)
    gl.activeTexture(gl.TEXTURE2); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([18, 16, 28, 255]))
  }

  /** Swap the background image (already-decoded) */
  setBackground(img: HTMLImageElement | ImageBitmap | null) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.bg)
    if (!img) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([18, 16, 28, 255])); this.bgSize = { w: 1, h: 1 }; return }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
    this.bgSize = { w: 'naturalWidth' in img ? img.naturalWidth : img.width, h: 'naturalHeight' in img ? img.naturalHeight : img.height }
  }

  /** Upload this frame's person mask; null when absent (no background swap this frame) */
  setMask(m: { data: Uint8Array; w: number; h: number } | null) {
    const gl = this.gl
    this.hasMask = !!m
    if (!m) return
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.mask)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, m.w, m.h, 0, gl.RED, gl.UNSIGNED_BYTE, m.data)
    this.maskSize = { w: m.w, h: m.h }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
  }

  render(video: FrameSrc, look: FxLook) {
    const gl = this.gl
    const { w, h } = srcSize(video)
    if (!w || !h) return
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h }
    gl.viewport(0, 0, w, h)
    gl.useProgram(this.prog)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.cam)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
    const mip = look.bg !== 'none' || !!look.veil || look.smooth > 0 || look.white > 0   // Blur, skin detection, and mask edge alignment all use the mipmap chain
    if (mip) gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
    // Background image cover-fits the frame: wider images crop left/right, taller ones crop top/bottom
    const ca = w / h, ba = this.bgSize.w / this.bgSize.h
    const sx = ba > ca ? ca / ba : 1, sy = ba > ca ? 1 : ba / ca
    gl.uniform1i(this.u.uBgMode, look.bg === 'blur' ? 1 : look.bg === 'image' ? 2 : 0)
    gl.uniform1f(this.u.uSmooth, look.smooth)
    gl.uniform1f(this.u.uWhite, look.white)
    gl.uniform1f(this.u.uSkinR, look.skinR ?? Math.max(3, h / 150))
    gl.uniform1f(this.u.uAspect, w / h)
    const wp = look.warp
    gl.uniform1f(this.u.uWarp, wp ? 1 : 0)
    if (wp) {
      gl.uniform2fv(this.u.uSlimP, wp.slimP); gl.uniform2fv(this.u.uSlimM, wp.slimM); gl.uniform2fv(this.u.uEyeC, wp.eyeC)
      gl.uniform1f(this.u.uSlimR, wp.slimR); gl.uniform1f(this.u.uEyeR, wp.eyeR); gl.uniform1f(this.u.uEyeS, wp.eyeS)
    }
    gl.uniform1f(this.u.uHasMask, this.hasMask ? 1 : 0)
    gl.uniform2f(this.u.uMaskTexel, 1 / this.maskSize.w, 1 / this.maskSize.h)
    gl.uniform1i(this.u.uRad, this.refineRadius)
    gl.uniform1f(this.u.uVeil, look.veil ? 1 : 0)
    gl.uniform2f(this.u.uTexel, 1 / w, 1 / h)
    gl.uniform2f(this.u.uBgScale, sx, sy)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  destroy() { const ext = this.gl.getExtension('WEBGL_lose_context'); ext?.loseContext() }
}
