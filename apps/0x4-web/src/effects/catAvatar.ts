// Virtual avatar: the 0x4 cat head (2026-10-02 goat: when a streamer doesn't want to show their face, a virtual character replaces the person, like Lyra).
// Built in 3D from the logo (public/icons/cat.svg): pearl-gradient round head, "airplane ears" sticking out sideways, left eye a slashed 0, right eye a 4, x-shaped mouth, whiskers on both sides.
// The camera is only used to read facial expressions and head rotation (engine.readFace); not a single pixel of the real person is drawn.
// 2026-10-02 goat: keep the background and body, only cover the face with the cat head (no cat body). So this only draws "one cat head on a transparent background",
//   and the processor pastes it over the face's position and size (anchor gives the cat head's center and radius in this image).
//   Blink → eyes squash into lines; open mouth → x becomes a small round open mouth; smile → cheeks flush; raised brow → ears perk up; turn / nod / tilt → the cat head follows.
//   When no face is detected: keep facing forward, glance around occasionally, never freeze.
// Features are drawn on a transparent canvas in front of the face (redrawn as expressions change); head and ears use a pearl-colored shader with no lighting, so the color is identical against any background.
import * as THREE from 'three'
import type { FacePose } from './engine'

const PEARL_VS = `
varying vec3 vN; varying vec3 vV;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`
// Same color set as the logo: top-left peach #ffd9c2 → middle lavender #d9c8ff → bottom-right sky blue #b6ecff, plus highlights and rim light
const PEARL_FS = `
uniform vec3 cA; uniform vec3 cB; uniform vec3 cC; uniform float dim;
varying vec3 vN; varying vec3 vV;
void main(){
  vec3 n = normalize(vN), v = normalize(vV);
  float d = clamp(0.5 + 0.5 * (n.x * 0.7 - n.y * 0.7), 0.0, 1.0);
  vec3 base = d < 0.5 ? mix(cA, cB, d * 2.0) : mix(cB, cC, (d - 0.5) * 2.0);
  vec3 L = normalize(vec3(-0.45, 0.6, 0.75));
  float diff = 0.62 + 0.38 * max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, normalize(L + v)), 0.0), 36.0) * 0.55;
  float fres = pow(1.0 - max(dot(n, v), 0.0), 2.6);
  vec3 col = base * diff * dim + spec + fres * vec3(0.9, 0.92, 1.0) * 0.32;
  gl_FragColor = vec4(col, 1.0);
}`

const pearl = (dim = 1) => new THREE.ShaderMaterial({
  vertexShader: PEARL_VS, fragmentShader: PEARL_FS,
  uniforms: { cA: { value: new THREE.Color('#ffd9c2') }, cB: { value: new THREE.Color('#d9c8ff') }, cC: { value: new THREE.Color('#b6ecff') }, dim: { value: dim } },
})

// Logo coords (120×120, face center 60,64) → feature-canvas pixels: 1 logo unit = K pixels, canvas center = face center
const FACE_PX = 512, K = 6.2
const fx = (x: number) => FACE_PX / 2 + (x - 60) * K
const fy = (y: number) => FACE_PX / 2 + (y - 64) * K

interface Smooth { blinkL: number; blinkR: number; jaw: number; smile: number; brow: number; yaw: number; pitch: number; roll: number }

export class CatAvatar {
  readonly canvas: HTMLCanvasElement
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  // A square image framing the head and both ears (3.6 × 3.6 units, head ~2.2 wide)
  private camera = new THREE.PerspectiveCamera(2 * Math.atan(1.8 / 7.2) * 180 / Math.PI, 1, 0.1, 50)
  /** The cat head's center (pixels) and radius (pixels, horizontal) in this image */
  readonly anchor: { x: number; y: number; r: number }
  private rig = new THREE.Group()       // The whole cat head
  private head = new THREE.Group()      // Head (follows rotation)
  private earL: THREE.Group
  private earR: THREE.Group
  private faceCv = document.createElement('canvas')
  private faceTex: THREE.CanvasTexture
  private faceKey = ''
  private s: Smooth = { blinkL: 0, blinkR: 0, jaw: 0, smile: 0, brow: 0, yaw: 0, pitch: 0, roll: 0 }

  /** width = the side length of this cat-head image (pixels); phones use a smaller one to save GPU */
  constructor(width = 600) {
    this.canvas = document.createElement('canvas')
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(1)
    this.renderer.setClearColor(0x000000, 0)
    const W = Math.round(width), H = W
    this.renderer.setSize(W, H, false)
    this.camera.position.set(0, 0.25, 7.2)
    this.camera.lookAt(0, 0.25, 0)
    this.camera.updateMatrixWorld()
    // Head center (0, 0.15), head horizontal radius 1.08 projected onto the image
    const hc = new THREE.Vector3(0, 0.15, 0).project(this.camera), he = new THREE.Vector3(1.08, 0.15, 0).project(this.camera)
    this.anchor = { x: (hc.x + 1) / 2 * W, y: (1 - hc.y) / 2 * H, r: (he.x - hc.x) / 2 * W }

    // Head: a slightly flattened sphere
    const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), pearl())
    skull.scale.set(1.08, 0.96, 0.98)
    this.head.add(skull)
    // Features: a patch of sphere in front of the head (a touch larger than the head, rotating with it), ±51° left-right, ±49° up-down
    this.faceCv.width = this.faceCv.height = FACE_PX
    this.faceTex = new THREE.CanvasTexture(this.faceCv); this.faceTex.colorSpace = THREE.SRGBColorSpace; this.faceTex.anisotropy = 4
    const decal = new THREE.Mesh(new THREE.SphereGeometry(1.004, 48, 40, Math.PI / 2 - 0.89, 1.78, Math.PI / 2 - 0.86, 1.72),
      new THREE.MeshBasicMaterial({ map: this.faceTex, transparent: true, depthWrite: false, toneMapped: false }))
    decal.scale.copy(skull.scale)
    this.head.add(decal)
    // Airplane ears: extruded thickness following the logo's ear outline, roots embedded in the head, rotating around the roots
    const earShape = new THREE.Shape()
    const P = (x: number, y: number) => new THREE.Vector2((x - 60) / 42, -(y - 64) / 42)
    const a = P(33, 34), b = P(12, 44), c = P(9, 46), d = P(12, 48), e = P(25, 55)
    earShape.moveTo(a.x, a.y); earShape.lineTo(b.x, b.y); earShape.quadraticCurveTo(c.x, c.y, d.x, d.y); earShape.lineTo(e.x, e.y); earShape.closePath()
    const earGeo = new THREE.ExtrudeGeometry(earShape, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 4, curveSegments: 10 })
    earGeo.translate(0.78, -0.46, -0.11)   // Origin moved to the ear root for easy rotation
    // Left ear extends toward −x; right ear is the left ear mirrored (scale.x = −1) — the mirrored back faces inward, so both sides are drawn
    const earMat = pearl(0.96); earMat.side = THREE.DoubleSide
    const mkEar = (side: 1 | -1) => {
      const grp = new THREE.Group()
      grp.add(new THREE.Mesh(earGeo, earMat))
      grp.position.set(0.78 * side, 0.46, 0)
      if (side === 1) grp.scale.x = -1
      this.head.add(grp)
      return grp
    }
    this.earL = mkEar(-1); this.earR = mkEar(1)
    this.rig.add(this.head)
    this.head.position.y = 0.15
    this.scene.add(this.rig)
    this.drawFace(this.s)
  }

  /** Draw one frame (transparent background). pose = the expression read this frame (found=false when nothing detected), t = milliseconds */
  render(pose: FacePose, t: number) {
    // Smoothing: expressions track a bit faster (blinks would otherwise be invisible), head turns slower (no jitter)
    const s = this.s, k = 0.55, kr = 0.3
    const idle = !pose.found
    const target: Smooth = idle
      ? { blinkL: 0, blinkR: 0, jaw: 0, smile: 0.15, brow: 0, yaw: Math.sin(t / 2600) * 0.18, pitch: Math.sin(t / 3700) * 0.04, roll: Math.sin(t / 3100) * 0.05 }
      : { blinkL: pose.blinkL, blinkR: pose.blinkR, jaw: pose.jaw, smile: pose.smile, brow: pose.brow, yaw: pose.yaw, pitch: pose.pitch, roll: pose.roll }
    for (const key of ['blinkL', 'blinkR', 'jaw', 'smile', 'brow'] as const) s[key] += (target[key] - s[key]) * k
    for (const key of ['yaw', 'pitch', 'roll'] as const) s[key] += (target[key] - s[key]) * kr
    // The outgoing picture is not mirrored: when the person turns toward the picture's left, the cat also turns toward the picture's left (direction verified on the viewer side, 2026-10-02)
    // Look up / down: positive pitch = looking up; the cat head tilting upward is a positive rotation around the x-axis (goat measured it as inverted before, 2026-10-02)
    this.head.rotation.set(s.pitch * 0.9, s.yaw, s.roll * 0.9)
    const flap = s.brow * 0.5 + Math.sin(t / 1300) * 0.04 + s.jaw * 0.08
    this.earL.rotation.z = -flap; this.earR.rotation.z = flap                  // Raised brow → both ear tips perk up (the right ear is mirrored, so it turns the opposite way)
    this.drawFace(s)
    this.renderer.render(this.scene, this.camera)
  }

  /** Features (logo strokes): redrawn only when the expression changes enough, skipping per-frame canvas redraws */
  private drawFace(s: Smooth) {
    const q = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 20)
    const key = [q(s.blinkL), q(s.blinkR), q(s.jaw), q(s.smile)].join(',')
    if (key === this.faceKey) return
    this.faceKey = key
    const g = this.faceCv.getContext('2d')!
    g.clearRect(0, 0, FACE_PX, FACE_PX)
    // Cheek blush: appears when smiling
    if (s.smile > 0.12) {
      g.fillStyle = `rgba(255,140,170,${Math.min(0.55, (s.smile - 0.12) * 0.9)})`
      for (const x of [fx(34), fx(86)]) { g.beginPath(); g.ellipse(x, fy(76), 34, 18, 0, 0, Math.PI * 2); g.fill() }
    }
    g.strokeStyle = '#1a1b20'; g.lineCap = 'round'; g.lineJoin = 'round'
    // Mirroring: the outgoing picture isn't mirrored — you close your left eye, the right eye closes in the picture — so left and right are swapped
    const openL = 1 - Math.min(0.92, s.blinkR * 1.05), openR = 1 - Math.min(0.92, s.blinkL * 1.05)
    // Left eye: a slashed 0
    const ex = fx(41), ey = fy(64)
    g.lineWidth = 30
    g.beginPath(); g.ellipse(ex, ey, 8 * K, Math.max(1.5, 10.5 * K * openL), 0, 0, Math.PI * 2); g.stroke()
    g.lineWidth = 24
    g.beginPath(); g.moveTo(fx(36), ey + (fy(71.5) - ey) * openL); g.lineTo(fx(46), ey + (fy(56.5) - ey) * openL); g.stroke()
    // Right eye: a 4 (squashed around y=64 as the midline)
    const sy = (y: number) => fy(64) + (fy(y) - fy(64)) * openR
    g.lineWidth = 30
    g.beginPath(); g.moveTo(fx(85), sy(74.5)); g.lineTo(fx(85), sy(53.5)); g.lineTo(fx(72.5), sy(68.5)); g.lineTo(fx(90), sy(68.5)); g.stroke()
    // Mouth: x when closed, a small round open mouth when open (with a hint of pink tongue inside)
    const mx = fx(60), my = fy(86)
    if (s.jaw < 0.14) {
      g.lineWidth = 24
      g.beginPath(); g.moveTo(mx - 3 * K, my - 3 * K); g.lineTo(mx + 3 * K, my + 3 * K); g.moveTo(mx + 3 * K, my - 3 * K); g.lineTo(mx - 3 * K, my + 3 * K); g.stroke()
    } else {
      const ow = 3.6 * K + s.jaw * 2.2 * K, oh = 2.4 * K + s.jaw * 8 * K
      g.fillStyle = '#1a1b20'; g.beginPath(); g.ellipse(mx, my + oh * 0.25, ow, oh, 0, 0, Math.PI * 2); g.fill()
      g.fillStyle = '#ff8fa8'; g.beginPath(); g.ellipse(mx, my + oh * 0.75, ow * 0.62, oh * 0.38, 0, 0, Math.PI * 2); g.fill()
    }
    // Whiskers
    g.lineWidth = 12; g.strokeStyle = 'rgba(26,27,32,.55)'
    g.beginPath()
    g.moveTo(fx(24), fy(80)); g.lineTo(fx(32), fy(81.5)); g.moveTo(fx(25), fy(87)); g.lineTo(fx(32.5), fy(85.5))
    g.moveTo(fx(96), fy(80)); g.lineTo(fx(88), fy(81.5)); g.moveTo(fx(95), fy(87)); g.lineTo(fx(87.5), fy(85.5))
    g.stroke()
    this.faceTex.needsUpdate = true
  }

  destroy() { this.renderer.dispose(); this.renderer.forceContextLoss() }
}
