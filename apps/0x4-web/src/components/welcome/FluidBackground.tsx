// Fluid background exclusive to the welcome / unlock pages (2026-09-26 goat: logo + tagline alone was too plain — wanted liquid fluid).
//
// One WebGL canvas fills the page; the fragment shader uses "domain-warped noise" (warping noise coordinates with more noise) to paint ink swirling in water
// slowly churning and stretching; colors reuse the global liquid-background palette (peach / rose / violet / indigo / ice cyan), hue slowly rotating over time.
// Doesn't follow finger / mouse (2026-09-26 goat: following felt weird — switched to fixed paths): two invisible "stir points" slowly orbit Lissajous curves,
// computed directly from time inside the shader — no per-frame data uploads.
//
// Power saving: renders at half screen resolution (soft fluid shows no artifacts when upscaled); frame updates stop when the page is hidden,
// with OS "reduce motion" only one static frame is drawn. The whole layer is this single canvas — VRAM = canvas pixels × 4, so it never blows up iOS like huge layers do.
// When WebGL is unavailable (rare machines / private mode), draw nothing and fall back to the global soft-glow background.
import { useLayoutEffect, useRef } from "react"
import { currentTheme } from '@/lib/theme'

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`
const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uT;
uniform float uDark;
uniform vec3 uC0, uC1, uC2, uC3, uC4;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 2.2;
  // 两个搅拌点沿固定路线慢绕（周期约 50 秒 / 70 秒），切向位移让颜色绕着它转，径向位移轻轻推开
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    vec2 c = vec2(0.55 * sin(uT * (0.125 - fi * 0.035) + fi * 2.1), 0.6 * cos(uT * (0.095 + fi * 0.03) + fi * 1.3)) * vec2(uRes.x / uRes.y, 1.0);
    vec2 d = p - c;
    float k = 0.22 * exp(-dot(d, d) * 2.2);
    p += vec2(-d.y, d.x) * k * (fi > 0.5 ? -1.0 : 1.0) + d * k * 0.25;
  }
  float t = uT * 0.045;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - vec2(t * 0.8, 0.0)));
  vec2 r = vec2(fbm(p + 3.4 * q + vec2(1.7, 9.2) + t * 0.6), fbm(p + 3.4 * q + vec2(8.3, 2.8) - t * 0.5));
  float f = fbm(p + 3.2 * r);
  vec3 col = mix(uC0, uC1, clamp(f * f * 3.2, 0.0, 1.0));
  col = mix(col, uC2, clamp(length(q) * 0.9, 0.0, 1.0));
  col = mix(col, uC3, clamp(r.x * 1.1 - 0.15, 0.0, 1.0));
  // 拉丝的亮边：噪声梯度处提一点高光色，像油面反光
  float edge = smoothstep(0.42, 0.62, f) * smoothstep(0.78, 0.58, f);
  col += uC4 * edge * (uDark > 0.5 ? 0.55 : 0.35);
  // 暗色主题整体压暗、四角再暗一点，保证标语和按钮永远读得清
  float vig = 1.0 - 0.35 * dot(uv - 0.5, uv - 0.5) * 2.0;
  col *= mix(1.0, vig, uDark);
  gl_FragColor = vec4(col, 1.0);
}`

type Rgb = [number, number, number]
function hsl(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [r + m, g + m, b + m]
}
/** Five colors: base, two main fluid colors, one contrast color, one highlight. Hue rotates slowly (~4 min per revolution); light and dark sets */
function paletteAt(sec: number, dark: boolean): Rgb[] {
  const rot = (sec * 1.5) % 360
  const h = (x: number) => (x + rot + 360) % 360
  return dark
    ? [hsl(h(262), 0.45, 0.06), hsl(h(262), 0.62, 0.30), hsl(h(340), 0.58, 0.34), hsl(h(196), 0.70, 0.30), hsl(h(20), 0.85, 0.60)]
    : [hsl(h(262), 0.60, 0.95), hsl(h(262), 0.75, 0.82), hsl(h(340), 0.80, 0.84), hsl(h(196), 0.80, 0.82), hsl(h(20), 0.90, 0.80)]
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export default function FluidBackground() {
  const ref = useRef<HTMLCanvasElement>(null)

  useLayoutEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false })
    if (!gl) return
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, src); gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { console.warn('[fluid]', gl.getShaderInfoLog(sh)); return null }
      return sh
    }
    const vs = compile(gl.VERTEX_SHADER, VERT), fs = compile(gl.FRAGMENT_SHADER, FRAG)
    if (!vs || !fs) return
    const prog = gl.createProgram()!
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn('[fluid]', gl.getProgramInfoLog(prog)); return }
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const U = (n: string) => gl.getUniformLocation(prog, n)
    const uRes = U('uRes'), uT = U('uT'), uDark = U('uDark')
    const uC = [U('uC0'), U('uC1'), U('uC2'), U('uC3'), U('uC4')]

    const t0 = performance.now()
    const clock = () => (performance.now() - t0) / 1000
    const still = reducedMotion()
    // Renders at half resolution, upscaled at most 1.5x: the fluid is inherently soft gradients — no visible jaggies when upscaled, and three quarters fewer pixels
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3) * 0.5
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h) }
    }
    const draw = () => {
      resize()
      const t = still ? 7.0 : clock()
      const dark = currentTheme() !== 'light'
      const pal = paletteAt(t, dark)
      gl.uniform2f(uRes, canvas.width, canvas.height)
      gl.uniform1f(uT, t)
      gl.uniform1f(uDark, dark ? 1 : 0)
      pal.forEach((c, i) => gl.uniform3f(uC[i], c[0], c[1], c[2]))
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    let raf = 0
    const tick = () => { draw(); raf = document.hidden ? 0 : requestAnimationFrame(tick) }
    const onVis = () => { cancelAnimationFrame(raf); raf = document.hidden || still ? 0 : requestAnimationFrame(tick) }
    document.addEventListener('visibilitychange', onVis)
    const ro = new ResizeObserver(() => { if (still) draw() })
    ro.observe(canvas)
    if (still) draw(); else onVis()
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVis)
      ro.disconnect()
      // Never loseContext on purpose: React StrictMode mounts the same canvas twice, and a lost context stays lost on the second acquire (all shader compiles return null).
      // WebKit releases the context itself when the canvas is GC'd with the component unmount
    }
  }, [])

  return <canvas ref={ref} className="fluid-bg" aria-hidden="true" />
}
