// User avatar: photo when available, otherwise a symmetric pixel identicon generated from the address (unique per address, generated locally, no network)
//
// Verified-held NFT avatars render as rounded hexagons (the shape Twitter once used for NFT avatars); regular avatars are circles.
// Prefer the caller-passed chainId for the check; when absent (feed, chat, leaderboard list APIs don't carry the field)
// the component batches its own server query, same as XBadge; results cached in memory, unbound ones cached as null.
//
// Staff (support / admins) get an extra rotating gradient glow border (StaffGlow): a ring for round avatars, a hexagon ring for NFT hexagons.
// Staff status comes from the server only (lib/staffBadges) — stops regular users impersonating with the same avatar and nickname.
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

// Six vertices (as % of side length): points up/down, vertical edges left/right; same height as round avatars, width 86.6% of height (regular hexagon).
// Stretching horizontally too would make the hexagon squat — not the Twitter shape.
const W = .866, L = (1 - W) / 2, R = 1 - L
const HEX_POINTS: [number, number][] = [[.5, 0], [R, .25], [R, .75], [.5, 1], [L, .75], [L, .25]]
const ROUND = .13 // Corner radius as a fraction of side length: any bigger is nearly round, any smaller is a hard point

/**
 * Rounded-hexagon path generated at pixel size: each vertex backs off along both edges, then rounds over
 * with a quadratic bezier. Sharp-cut corners look hard and jaggy, especially on small avatars.
 * CSS clip-path: path() instead of SVG <image> because <img>'s onError is the reliable one —
 * a dead NFT image must fall back to the pixel avatar, not leave an empty hexagon shell.
 */
const cache = new Map<string, string>()
/** off: how many px the whole thing shifts down-right (the glow ring's inner edge must center on the outer when drawn) */
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

/** Path of a circle (center c), two semicircular arcs */
const circlePath = (c: number, r: number) => `M${c - r} ${c} A${r} ${r} 0 1 0 ${c + r} ${c} A${r} ${r} 0 1 0 ${c - r} ${c} Z`

/**
 * Glow-ring geometry: outer frame side length box, expansion off from the avatar, ring's evenodd path d.
 * The ring's inner edge sinks half a pixel into the avatar edge (no hairline gap), the outer edge sits
 * thick - 0.5 px outside the avatar. A hexagon is regular, so scaling about the center moves every edge
 * outward equally — height is converted via the inradius (0.433 × height).
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

/** Ring thickness: 1.5–2px just outlines 20–32px avatars, thickening on larger ones */
function ringThickness(size: number) {
  if (size <= 24) return 1.5
  if (size <= 40) return 2
  if (size <= 64) return 2.5
  return Math.min(4, Math.max(3, size * 0.035))
}

/**
 * Staff glow border: a static soft-glow layer (blurred same-shape gradient ring, painted once) + a rotating
 * stroke layer (a gradient square rotating inside a static clip). Same footprint as the avatar; the ring sits
 * outside the avatar without disturbing list layout.
 */
function StaffGlow({ role, shape, size, children }: { role: StaffBadge; shape: 'circle' | 'hex'; size: number; children: ReactNode }) {
  const thick = ringThickness(size)
  const { box, off, d } = ringGeometry(shape, size, thick)
  const clip = `path(evenodd, '${d}')`
  // Subtle glow on small avatars — just a faint ring; more pronounced on large ones (profile pages)
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
  /** Address → chain of the avatar; null = avatar isn't a verified NFT (already asked) */
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
        // Don't cache a miss; ask again next page visit
      }
    }, 120)
  },
}))

export default function Avatar({ address, src: rawSrc, size = 36, chainId }: { address: string; src?: string | null; name?: string | null; size?: number; chainId?: number | null }) {
  // Group avatars are images uploaded to our server, stored as relative /files/… paths (group owners can change them since 2026-10-07): prepend the API host or they won't render on web or in the app;
  // these aren't NFTs — skip the NFT lookup
  const uploaded = !!rawSrc && rawSrc.startsWith('/files/')
  const src = uploaded ? SOCIAL_API + rawSrc : rawSrc
  const [err, setErr] = useState(false)
  const ensure = useNftAvatars((s) => s.ensure)
  const known = useNftAvatars((s) => s.chains[address])
  // Only ask when there's an avatar image and nobody told us whether it's an NFT; users without avatars cost no requests
  const needLookup = !!src && !err && chainId == null && !uploaded
  useEffect(() => { if (needLookup) ensure(address) }, [needLookup, address, ensure])

  const nftChain = chainId ?? known ?? null
  const staffRole = useStaffBadges((s) => s.roles[address] ?? null)
  const ensureStaff = useStaffBadges((s) => s.ensure)
  useEffect(() => { if (address) ensureStaff(address) }, [address, ensureStaff])
  const face = renderFace()
  if (!staffRole) return face
  return <StaffGlow role={staffRole} shape={src && !err && nftChain ? 'hex' : 'circle'} size={size}>{face}</StaffGlow>

  // The avatar itself (original markup kept as-is); staff get the glow ring wrapped outside
  function renderFace() {
    // NFT avatar: image + auto-detected chain badge at bottom-right
    if (src && !err) {
      // The chain badge would eat a third of a small avatar and blur a corner — and feed/chat lists would be full of badges; large avatars only
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
                {/* Hairline stroke only outlines against dark backgrounds; a thick colored border on every avatar would be noisy in lists */}
                <svg width={size} height={size} className="pointer-events-none absolute inset-0" style={{ overflow: 'visible' }} aria-hidden>
                  <path d={path} fill="none" stroke="rgb(255 255 255 / .22)" strokeWidth="1.5" />
                </svg>
              </>
            )
            : <img src={src} alt="" width={size} height={size} onError={() => setErr(true)} className="rounded-full object-cover" style={{ width: size, height: size }} />}
          {/* Chain badge shifted down-right (2026-09-28 goat: its center used to sit inside the hexagon, covering too much NFT). Now the center lands outside the bottom-right edge, overlapping only ~6% of the rim */}
          {chain && <img src={chain.logo} alt={chain.name} title={chain.name} className="absolute rounded-full border-2 border-bg bg-bg" style={{ width: badge, height: badge, right: '-1%', bottom: '-5%' }} />}
        </span>
      )
    }
    // 5×5 mirrored pixels: 15 bits of the address hash pick the lit cells, two alternating tones
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

// 32-bit FNV-style hash, so one address always yields the same image
function hash(s: string): number {
  let x = 2166136261
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0 }
  return x
}
