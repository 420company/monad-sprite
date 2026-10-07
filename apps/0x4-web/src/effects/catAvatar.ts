// 虚拟形象：0x4 猫头（2026-10-02 goat：主播不想露脸时，用一个虚拟角色替换真人，类似 Lyra）。
// 照着 logo 做成 3D（public/icons/cat.svg）：珍珠渐变的圆头、往两边伸的「飞机耳」、左眼带斜线的 0、右眼 4、嘴是 x、两边胡须。
// 摄像头只用来读表情和头的转动（engine.readFace），真人一个像素都不会画出来。
// 2026-10-02 goat：背景和身体都保留，只用猫头挡住脸（不要猫身子）。所以这里只画「透明底上的一颗猫头」，
//   processor 按脸的位置和大小把它贴上去（anchor 给出猫头在这张图上的中心和半径）。
//   眨眼 → 眼睛压扁成一条线；张嘴 → x 变成张开的小圆嘴；笑 → 脸颊泛红；挑眉 → 耳朵竖起来；转头 / 点头 / 歪头 → 猫头跟着转。
//   读不到脸时：保持正脸、偶尔左右看看，不会僵住。
// 五官画在一张贴在脸前面的透明画布上（随表情重画），头和耳朵是珍珠色着色器，不靠灯光，任何背景下都是同一种颜色。
import * as THREE from 'three'
import type { FacePose } from './engine'

const PEARL_VS = `
varying vec3 vN; varying vec3 vV;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`
// 和 logo 同一组颜色：左上蜜桃 #ffd9c2 → 中间薰衣草 #d9c8ff → 右下天蓝 #b6ecff，加高光和边缘亮
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

// logo 坐标（120×120，脸中心 60,64）→ 五官画布像素：每 1 个 logo 单位 = K 像素，画布中心 = 脸中心
const FACE_PX = 512, K = 6.2
const fx = (x: number) => FACE_PX / 2 + (x - 60) * K
const fy = (y: number) => FACE_PX / 2 + (y - 64) * K

interface Smooth { blinkL: number; blinkR: number; jaw: number; smile: number; brow: number; yaw: number; pitch: number; roll: number }

export class CatAvatar {
  readonly canvas: HTMLCanvasElement
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  // 正方形的一张图，框住头和两只耳朵（3.6 × 3.6 个单位，头宽约 2.2）
  private camera = new THREE.PerspectiveCamera(2 * Math.atan(1.8 / 7.2) * 180 / Math.PI, 1, 0.1, 50)
  /** 猫头在这张图上的中心（像素）和半径（像素，横向） */
  readonly anchor: { x: number; y: number; r: number }
  private rig = new THREE.Group()       // 整颗猫头
  private head = new THREE.Group()      // 头（跟着转）
  private earL: THREE.Group
  private earR: THREE.Group
  private faceCv = document.createElement('canvas')
  private faceTex: THREE.CanvasTexture
  private faceKey = ''
  private s: Smooth = { blinkL: 0, blinkR: 0, jaw: 0, smile: 0, brow: 0, yaw: 0, pitch: 0, roll: 0 }

  /** width = 这张猫头图的边长（像素）；手机用小一点的省显卡 */
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
    // 头中心 (0, 0.15)、头横向半径 1.08 投到图上
    const hc = new THREE.Vector3(0, 0.15, 0).project(this.camera), he = new THREE.Vector3(1.08, 0.15, 0).project(this.camera)
    this.anchor = { x: (hc.x + 1) / 2 * W, y: (1 - hc.y) / 2 * H, r: (he.x - hc.x) / 2 * W }

    // 头：稍扁的球
    const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), pearl())
    skull.scale.set(1.08, 0.96, 0.98)
    this.head.add(skull)
    // 五官：贴在头前面的一块球面（比头大一点点，跟头一起转），左右 ±51°、上下 ±49°
    this.faceCv.width = this.faceCv.height = FACE_PX
    this.faceTex = new THREE.CanvasTexture(this.faceCv); this.faceTex.colorSpace = THREE.SRGBColorSpace; this.faceTex.anisotropy = 4
    const decal = new THREE.Mesh(new THREE.SphereGeometry(1.004, 48, 40, Math.PI / 2 - 0.89, 1.78, Math.PI / 2 - 0.86, 1.72),
      new THREE.MeshBasicMaterial({ map: this.faceTex, transparent: true, depthWrite: false, toneMapped: false }))
    decal.scale.copy(skull.scale)
    this.head.add(decal)
    // 飞机耳：照 logo 的耳朵轮廓挤出厚度，根部插进头里，绕根部转
    const earShape = new THREE.Shape()
    const P = (x: number, y: number) => new THREE.Vector2((x - 60) / 42, -(y - 64) / 42)
    const a = P(33, 34), b = P(12, 44), c = P(9, 46), d = P(12, 48), e = P(25, 55)
    earShape.moveTo(a.x, a.y); earShape.lineTo(b.x, b.y); earShape.quadraticCurveTo(c.x, c.y, d.x, d.y); earShape.lineTo(e.x, e.y); earShape.closePath()
    const earGeo = new THREE.ExtrudeGeometry(earShape, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 4, curveSegments: 10 })
    earGeo.translate(0.78, -0.46, -0.11)   // 原点挪到耳根，方便转
    // 左耳往 x 负方向伸；右耳是左耳镜像（scale.x = -1），镜像后面朝里，所以两面都画
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

  /** 画一帧（透明底）。pose = 这一帧读到的表情（读不到时 found=false），t = 毫秒 */
  render(pose: FacePose, t: number) {
    // 平滑：表情跟得快一点（不然眨眼看不出来），转头慢一点（不抖）
    const s = this.s, k = 0.55, kr = 0.3
    const idle = !pose.found
    const target: Smooth = idle
      ? { blinkL: 0, blinkR: 0, jaw: 0, smile: 0.15, brow: 0, yaw: Math.sin(t / 2600) * 0.18, pitch: Math.sin(t / 3700) * 0.04, roll: Math.sin(t / 3100) * 0.05 }
      : { blinkL: pose.blinkL, blinkR: pose.blinkR, jaw: pose.jaw, smile: pose.smile, brow: pose.brow, yaw: pose.yaw, pitch: pose.pitch, roll: pose.roll }
    for (const key of ['blinkL', 'blinkR', 'jaw', 'smile', 'brow'] as const) s[key] += (target[key] - s[key]) * k
    for (const key of ['yaw', 'pitch', 'roll'] as const) s[key] += (target[key] - s[key]) * kr
    // 发出去的画面不镜像：真人往画面左边转，猫也往画面左边转（2026-10-02 观众端实测过方向）
    // 抬头 / 低头：pitch 正 = 抬头，猫头绕 x 轴转正角度是往上仰（2026-10-02 goat 实测以前是反的）
    this.head.rotation.set(s.pitch * 0.9, s.yaw, s.roll * 0.9)
    const flap = s.brow * 0.5 + Math.sin(t / 1300) * 0.04 + s.jaw * 0.08
    this.earL.rotation.z = -flap; this.earR.rotation.z = flap                  // 挑眉 → 两只耳朵尖都往上竖（右耳是镜像，转向相反）
    this.drawFace(s)
    this.renderer.render(this.scene, this.camera)
  }

  /** 五官（logo 线条）：表情变化够大才重画，省掉每帧重画画布 */
  private drawFace(s: Smooth) {
    const q = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 20)
    const key = [q(s.blinkL), q(s.blinkR), q(s.jaw), q(s.smile)].join(',')
    if (key === this.faceKey) return
    this.faceKey = key
    const g = this.faceCv.getContext('2d')!
    g.clearRect(0, 0, FACE_PX, FACE_PX)
    // 脸颊红晕：笑的时候出来
    if (s.smile > 0.12) {
      g.fillStyle = `rgba(255,140,170,${Math.min(0.55, (s.smile - 0.12) * 0.9)})`
      for (const x of [fx(34), fx(86)]) { g.beginPath(); g.ellipse(x, fy(76), 34, 18, 0, 0, Math.PI * 2); g.fill() }
    }
    g.strokeStyle = '#1a1b20'; g.lineCap = 'round'; g.lineJoin = 'round'
    // 镜像问题：发出去的画面不镜像，你闭左眼，画面里是右边那只眼闭——所以左右对调
    const openL = 1 - Math.min(0.92, s.blinkR * 1.05), openR = 1 - Math.min(0.92, s.blinkL * 1.05)
    // 左眼：带斜线的 0
    const ex = fx(41), ey = fy(64)
    g.lineWidth = 30
    g.beginPath(); g.ellipse(ex, ey, 8 * K, Math.max(1.5, 10.5 * K * openL), 0, 0, Math.PI * 2); g.stroke()
    g.lineWidth = 24
    g.beginPath(); g.moveTo(fx(36), ey + (fy(71.5) - ey) * openL); g.lineTo(fx(46), ey + (fy(56.5) - ey) * openL); g.stroke()
    // 右眼：4（以 y=64 为中线压扁）
    const sy = (y: number) => fy(64) + (fy(y) - fy(64)) * openR
    g.lineWidth = 30
    g.beginPath(); g.moveTo(fx(85), sy(74.5)); g.lineTo(fx(85), sy(53.5)); g.lineTo(fx(72.5), sy(68.5)); g.lineTo(fx(90), sy(68.5)); g.stroke()
    // 嘴：闭着是 x，张开变成一个小圆嘴（里面一点粉色舌头）
    const mx = fx(60), my = fy(86)
    if (s.jaw < 0.14) {
      g.lineWidth = 24
      g.beginPath(); g.moveTo(mx - 3 * K, my - 3 * K); g.lineTo(mx + 3 * K, my + 3 * K); g.moveTo(mx + 3 * K, my - 3 * K); g.lineTo(mx - 3 * K, my + 3 * K); g.stroke()
    } else {
      const ow = 3.6 * K + s.jaw * 2.2 * K, oh = 2.4 * K + s.jaw * 8 * K
      g.fillStyle = '#1a1b20'; g.beginPath(); g.ellipse(mx, my + oh * 0.25, ow, oh, 0, 0, Math.PI * 2); g.fill()
      g.fillStyle = '#ff8fa8'; g.beginPath(); g.ellipse(mx, my + oh * 0.75, ow * 0.62, oh * 0.38, 0, 0, Math.PI * 2); g.fill()
    }
    // 胡须
    g.lineWidth = 12; g.strokeStyle = 'rgba(26,27,32,.55)'
    g.beginPath()
    g.moveTo(fx(24), fy(80)); g.lineTo(fx(32), fy(81.5)); g.moveTo(fx(25), fy(87)); g.lineTo(fx(32.5), fy(85.5))
    g.moveTo(fx(96), fy(80)); g.lineTo(fx(88), fy(81.5)); g.moveTo(fx(95), fy(87)); g.lineTo(fx(87.5), fy(85.5))
    g.stroke()
    this.faceTex.needsUpdate = true
  }

  destroy() { this.renderer.dispose(); this.renderer.forceContextLoss() }
}
