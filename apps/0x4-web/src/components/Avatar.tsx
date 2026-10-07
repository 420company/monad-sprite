// 用户头像：有图用图，没图用地址生成的对称像素图（每个地址独一无二，本地生成不依赖网络）
//
// 验证过持有的 NFT 头像画成圆角六边形（早年 Twitter 给 NFT 头像用的那种），普通头像是圆的。
// 判断依据优先用调用方传进来的 chainId；没传的（动态、聊天、排行榜那些列表的接口都不带这个字段）
// 由组件自己攒一批问服务端，做法与 XBadge 一样，结果缓存在内存里，没绑的也缓存成 null。
//
// 工作人员（客服 / 管理员）的头像外圈多一道旋转的渐变发光边框（StaffGlow），圆头像是圆环、NFT 六边形是六边形环。
// 是不是工作人员只问服务端（lib/staffBadges），防止普通用户换同样的头像和昵称冒充。
import { useEffect, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { chainById } from '@/lib/chains'
import { api, SOCIAL_API } from '@/lib/social'
import { t } from '@/lib/i18n'
import { useStaffBadges, type StaffBadge } from '@/lib/staffBadges'

function hue(addr: string): number {
  let h = 0
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) % 360
  return h
}

// 六个顶点（按边长百分比）：尖角朝上下、左右是竖边，高度与圆头像一致，宽度是高的 86.6%（正六边形）。
// 横向也撑满的话六边形会变矮胖，不是 Twitter 那个形状。
const W = .866, L = (1 - W) / 2, R = 1 - L
const HEX_POINTS: [number, number][] = [[.5, 0], [R, .25], [R, .75], [.5, 1], [L, .75], [L, .25]]
const ROUND = .13 // 顶点圆角占边长的比例：再大就快成圆的了，再小又是硬尖角

/**
 * 按像素尺寸生成圆角六边形路径：顶点沿两条边各退一段，再用二次贝塞尔绕过去。
 * 尖角直接切出来又硬又有锯齿，小头像上尤其明显。
 * 用 CSS clip-path: path() 而不是 SVG <image>，是因为 <img> 的 onError 才靠得住——
 * NFT 图挂掉时要能落回像素头像，不能留个空壳六边形。
 */
const cache = new Map<string, string>()
/** off：整体往右下平移多少像素（画发光环时内圈要套在外圈正中） */
function hexPath(size: number, off = 0): string {
  const key = `${size}@${off}`
  const hit = cache.get(key)
  if (hit) return hit
  const pts = HEX_POINTS.map(([x, y]) => [x * size + off, y * size + off] as [number, number])
  const r = ROUND * size
  const at = (from: [number, number], to: [number, number]) => {
    const [dx, dy] = [to[0] - from[0], to[1] - from[1]]
    const len = Math.hypot(dx, dy)
    return [from[0] + (dx / len) * r, from[1] + (dy / len) * r] as [number, number]
  }
  let d = ''
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const [ax, ay] = at(p, pts[(i + pts.length - 1) % pts.length])
    const [bx, by] = at(p, pts[(i + 1) % pts.length])
    const n = (v: number) => Math.round(v * 100) / 100
    d += `${i === 0 ? `M${n(ax)} ${n(ay)}` : `L${n(ax)} ${n(ay)}`} Q${n(p[0])} ${n(p[1])} ${n(bx)} ${n(by)} `
  }
  d = `${d}Z`
  cache.set(key, d)
  return d
}

/** 圆（圆心在 c）的路径，两段半圆弧 */
const circlePath = (c: number, r: number) => `M${c - r} ${c} A${r} ${r} 0 1 0 ${c + r} ${c} A${r} ${r} 0 1 0 ${c - r} ${c} Z`

/**
 * 发光环的几何：外框边长 box、相对头像往外扩 off、环的 evenodd 路径 d。
 * 环的内沿压进头像边缘半像素（免得中间漏一道缝），外沿在头像外 thick - 0.5 像素。
 * 六边形是正六边形，绕中心等比放大时每条边外移的距离一样，所以按内切圆半径（高的 0.433）换算高度。
 */
function ringGeometry(shape: 'circle' | 'hex', size: number, thick: number) {
  const inE = -0.5, outE = thick - 0.5
  const r2 = (v: number) => Math.round(v * 100) / 100
  if (shape === 'circle') {
    const box = r2(size + 2 * outE)
    const c = box / 2
    return { box, off: r2((box - size) / 2), d: `${circlePath(c, c)} ${circlePath(c, r2(size / 2 + inE))}` }
  }
  const box = r2(size + (2 * outE) / W)
  const inner = r2(size + (2 * inE) / W)
  return { box, off: r2((box - size) / 2), d: `${hexPath(box)} ${hexPath(inner, r2((box - inner) / 2))}` }
}

/** 环的粗细：20~32px 的小头像 1.5~2px 只勾个边，大头像逐渐加粗 */
function ringThickness(size: number) {
  if (size <= 24) return 1.5
  if (size <= 40) return 2
  if (size <= 64) return 2.5
  return Math.min(4, Math.max(3, size * 0.035))
}

/**
 * 工作人员发光边框：静态柔光层（模糊后的同形状渐变环，只画一次）+ 旋转描边层（静态裁剪里转一个渐变方块）。
 * 占位尺寸和头像一样，环画在头像外侧，不挤动列表布局。
 */
function StaffGlow({ role, shape, size, children }: { role: StaffBadge; shape: 'circle' | 'hex'; size: number; children: ReactNode }) {
  const thick = ringThickness(size)
  const { box, off, d } = ringGeometry(shape, size, thick)
  const clip = `path(evenodd, '${d}')`
  // 小头像的柔光收着点，只是一圈微光；大头像（个人主页）明显一些
  const blur = size <= 32 ? 2 : Math.min(7, Math.round(size * 0.07))
  const pos = { left: -off, top: -off, width: box, height: box }
  return (
    <span className="staff-glow" data-staff-glow={role} data-shape={shape} style={{ width: size, height: size }}>
      <span className="sg-halo" aria-hidden style={{ ...pos, filter: `blur(${blur}px)` }}><span style={{ clipPath: clip }} /></span>
      {children}
      <span className="sg-ring" aria-hidden style={{ ...pos, clipPath: clip }}><span className="sg-spin" /></span>
    </span>
  )
}

interface NftAvatarState {
  /** 地址 → 头像所在链；null = 头像不是验证过的 NFT（已问过） */
  chains: Record<string, number | null>
  ensure: (address: string) => void
  set: (address: string, chainId: number | null) => void
}

let queue = new Set<string>()
let timer: number | null = null

export const useNftAvatars = create<NftAvatarState>()((set, get) => ({
  chains: {},
  set: (address, chainId) => set({ chains: { ...get().chains, [address]: chainId } }),
  ensure: (address) => {
    if (!address || address in get().chains || queue.has(address)) return
    queue.add(address)
    if (timer !== null) return
    timer = window.setTimeout(async () => {
      const batch = [...queue]
      queue = new Set()
      timer = null
      try {
        const r = await api<Record<string, { chainId: number } | null>>(`/api/users/avatar-nfts?addresses=${batch.join(',')}`)
        const next: Record<string, number | null> = {}
        for (const a of batch) next[a] = r[a]?.chainId ?? null
        set({ chains: { ...get().chains, ...next } })
      } catch {
        // 没问到就不写缓存，下次进页面再问
      }
    }, 120)
  },
}))

export default function Avatar({ address, src: rawSrc, size = 36, chainId }: { address: string; src?: string | null; name?: string | null; size?: number; chainId?: number | null }) {
  // 群头像是我们服务器上传的图片，存的是相对地址 /files/…（2026-10-07 群主能自己换头像）：补上接口域名，不然网页版、App 里都显示不出来；
  // 这种不是 NFT，也不去查 NFT
  const uploaded = !!rawSrc && rawSrc.startsWith('/files/')
  const src = uploaded ? SOCIAL_API + rawSrc : rawSrc
  const [err, setErr] = useState(false)
  const ensure = useNftAvatars((s) => s.ensure)
  const known = useNftAvatars((s) => s.chains[address])
  // 有头像图又没人告诉我它是不是 NFT，才值得去问；没设头像的用户不占请求
  const needLookup = !!src && !err && chainId == null && !uploaded
  useEffect(() => { if (needLookup) ensure(address) }, [needLookup, address, ensure])

  const nftChain = chainId ?? known ?? null
  const staffRole = useStaffBadges((s) => s.roles[address] ?? null)
  const ensureStaff = useStaffBadges((s) => s.ensure)
  useEffect(() => { if (address) ensureStaff(address) }, [address, ensureStaff])
  const face = renderFace()
  if (!staffRole) return face
  return <StaffGlow role={staffRole} shape={src && !err && nftChain ? 'hex' : 'circle'} size={size}>{face}</StaffGlow>

  // 头像本体（原来的写法原样保留）；工作人员再在外面套发光环
  function renderFace() {
    // NFT 头像：图片 + 右下角所在链的小图标（自动识别）
    if (src && !err) {
      // 链徽标在小头像上要占掉三分之一还糊住一个角，动态、聊天那些列表里满屏都是图标；只在大头像上给
      const chain = nftChain && size >= 44 ? chainById(nftChain) : undefined
      const badge = Math.round(size * 0.3)
      const path = hexPath(size)
      return (
        <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
          {nftChain
            ? (
              <>
                <img
                  src={src} alt="" title={t('持有已验证的 NFT')} onError={() => setErr(true)}
                  width={size} height={size} className="block object-cover"
                  style={{ width: size, height: size, clipPath: `path('${path}')` }}
                />
                {/* 极细描边只为在深色背景上勾出轮廓；粗色边框每个头像都戴一圈，列表里会很吵 */}
                <svg width={size} height={size} className="pointer-events-none absolute inset-0" style={{ overflow: 'visible' }} aria-hidden>
                  <path d={path} fill="none" stroke="rgb(255 255 255 / .22)" strokeWidth="1.5" />
                </svg>
              </>
            )
            : <img src={src} alt="" width={size} height={size} onError={() => setErr(true)} className="rounded-full object-cover" style={{ width: size, height: size }} />}
          {/* 链徽标往右下挪出去（2026-09-28 goat：原来圆心在六边形里面，挡住太多 NFT）。现在圆心落在右下斜边外侧，只压住边缘约 6% */}
          {chain && <img src={chain.logo} alt={chain.name} title={chain.name} className="absolute rounded-full border-2 border-bg bg-bg" style={{ width: badge, height: badge, right: '-1%', bottom: '-5%' }} />}
        </span>
      )
    }
    // 5×5 左右对称像素：取地址哈希的 15 位决定点亮格子，两种色调交替
    const h = hue(address)
    const seed = hash(address)
    const cells: { x: number; y: number; on: boolean; alt: boolean }[] = []
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
      const bit = (seed >> (y * 3 + x)) & 1
      const alt = ((seed >> (15 + ((y * 3 + x) % 15))) & 1) === 1
      cells.push({ x, y, on: !!bit, alt }); if (x < 2) cells.push({ x: 4 - x, y, on: !!bit, alt })
    }
    const c1 = `hsl(${h} 75% 55%)`, c2 = `hsl(${(h + 40) % 360} 80% 65%)`, bgc = `hsl(${h} 35% 16%)`
    return (
      <svg viewBox="0 0 7 7" width={size} height={size} className="shrink-0 rounded-full" style={{ width: size, height: size, background: bgc }} aria-hidden>
        {cells.filter((c) => c.on).map((c, i) => <rect key={i} x={c.x + 1} y={c.y + 1} width="1" height="1" fill={c.alt ? c2 : c1} />)}
      </svg>
    )
  }
}

// 32 位 FNV 风格哈希，保证同一地址永远得到同一张图
function hash(s: string): number {
  let x = 2166136261
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0 }
  return x
}
