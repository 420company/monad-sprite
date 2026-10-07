// 礼物贴纸插画：每个礼物一张 64×64 的内联 SVG。
// 每张图分两部分：sil 是外轮廓（只有形状，不写颜色），外层包装拿它描一圈深色投影和一圈白边做成贴纸感；
// art 是真正的彩色画面。p 是本实例的 id 前缀，所有渐变 / 裁剪的 id 都要带上，同页多个实例才不会串。
import type { ReactNode } from 'react'

export interface GiftArt {
  /** 外轮廓。sw = 描边宽度（64 坐标系下），带缩放的子元素要自己除以缩放倍数 */
  sil: (sw: number) => ReactNode
  art: ReactNode
}

const INK = '#1a1b20'

/** 四角闪光 */
export const star = (cx: number, cy: number, r: number) =>
  `M${cx} ${cy - r}Q${cx} ${cy} ${cx + r} ${cy}Q${cx} ${cy} ${cx} ${cy + r}Q${cx} ${cy} ${cx - r} ${cy}Q${cx} ${cy} ${cx} ${cy - r}Z`

// ---------- 0x4 飞机耳猫头（沿用 public/icons/cat.svg 的原始路径，120 坐标系，中心约在 60,65） ----------
const EAR_L = 'M33 34 L12 44 Q9 46 12 48 L25 55 Z'
const EAR_R = 'M87 34 L108 44 Q111 46 108 48 L95 55 Z'
const FACE = 'M60 26 C85 26 102 42 102 64 C102 88 84 104 60 104 C36 104 18 88 18 64 C18 42 35 26 60 26 Z'

function catTf(x: number, y: number, s: number) { return `translate(${x} ${y}) scale(${s}) translate(-60 -65)` }

/** 猫头轮廓（给 sil 用） */
function CatSil({ x, y, s, sw }: { x: number; y: number; s: number; sw: number }) {
  return (
    <g transform={catTf(x, y, s)} strokeWidth={sw / s}>
      <path d={EAR_L} /><path d={EAR_R} /><path d={FACE} />
    </g>
  )
}

/** 猫头本体。bold：小尺寸时加粗五官 */
function Cat({ p, x, y, s, bold, dy = 0, children }: { p: string; x: number; y: number; s: number; bold?: boolean; /** 五官整体下移（给头带腾位置） */ dy?: number; children?: ReactNode }) {
  const w = bold ? 8 : 5
  return (
    <g transform={catTf(x, y, s)}>
      <defs>
        <linearGradient id={`${p}face`} x1=".1" y1="0" x2=".9" y2="1"><stop offset="0" stopColor="#ffd9c2" /><stop offset=".5" stopColor="#d9c8ff" /><stop offset="1" stopColor="#b6ecff" /></linearGradient>
        <radialGradient id={`${p}shine`} cx=".33" cy=".28" r=".65"><stop offset="0" stopColor="#fff" stopOpacity=".85" /><stop offset=".5" stopColor="#fff" stopOpacity="0" /></radialGradient>
      </defs>
      <g fill={`url(#${p}face)`} stroke={`url(#${p}face)`} strokeWidth="5" strokeLinejoin="round"><path d={EAR_L} /><path d={EAR_R} /></g>
      <path d={FACE} fill={`url(#${p}face)`} />
      <path d={FACE} fill={`url(#${p}shine)`} />
      <g fill="none" stroke={INK} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" transform={dy ? `translate(0 ${dy})` : undefined}>
        <ellipse cx="41" cy="64" rx="8" ry="10.5" />
        <path d="M36 71.5 L46 56.5" strokeWidth={w - 1} />
        <path d="M85 74.5 V53.5 L72.5 68.5 H90" />
        <path d="M57 83 L63 89 M63 83 L57 89" strokeWidth={w - 1} />
        {!bold && <path d="M22 80 L31 81.5 M23 87 L31.5 85.5 M98 80 L89 81.5 M97 87 L88.5 85.5" strokeWidth="2.4" strokeOpacity=".55" />}
      </g>
      {children}
    </g>
  )
}

// ---------- 韭菜：一捆被割过的韭菜，切口平平的，还在傻笑 ----------
const LEEK_TOPS = [0, 1, 2, 3, 4].map((i) => {
  const tx = 13 + i * 9.5, ty = 11 + Math.abs(i - 2) * 1.6
  const bx = 25.2 + i * 3.4
  return { tx, ty, bx, d: `M${tx - 5.4} ${ty} L${tx + 5.4} ${ty} L${bx + 3} 41 L${bx - 3} 41 Z` }
})
const leek = (p: string): GiftArt => ({
  sil: () => (
    <>
      {LEEK_TOPS.map((b) => <path key={b.tx} d={b.d} />)}
      <rect x="22" y="37" width="20" height="8" rx="3" />
      <path d="M24.5 44 H39.5 L38.5 57 Q32 59.5 25.5 57 Z" />
    </>
  ),
  art: (
    <>
      <defs>
        <linearGradient id={`${p}g`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#a6f05a" /><stop offset=".55" stopColor="#3fc34a" /><stop offset="1" stopColor="#1f8f3a" /></linearGradient>
        <linearGradient id={`${p}g2`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8fe04c" /><stop offset="1" stopColor="#2a9d40" /></linearGradient>
        <linearGradient id={`${p}w`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f4ffe6" /><stop offset="1" stopColor="#d6ecc4" /></linearGradient>
        <linearGradient id={`${p}r`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff6b81" /><stop offset="1" stopColor="#d9214a" /></linearGradient>
      </defs>
      {/* 白色根部 */}
      <path d="M24.5 44 H39.5 L38.5 57 Q32 59.5 25.5 57 Z" fill={`url(#${p}w)`} />
      <path d="M28 46 V56.5 M32 46 V57.5 M36 46 V56.5" stroke="#b9d9a0" strokeWidth="1" strokeLinecap="round" />
      {/* 叶片：中间的压在两边上面 */}
      {[0, 4, 1, 3, 2].map((i) => {
        const b = LEEK_TOPS[i]
        return (
          <g key={i}>
            <path d={b.d} fill={`url(#${i % 2 ? `${p}g2` : `${p}g`})`} stroke="#1f7a33" strokeOpacity=".35" strokeWidth=".8" strokeLinejoin="round" />
            <path d={`M${b.tx - 2.2} ${b.ty + 2} L${b.bx - 1.2} 39`} stroke="#fff" strokeOpacity=".45" strokeWidth="1.3" strokeLinecap="round" />
            {/* 切口 */}
            <ellipse cx={b.tx} cy={b.ty} rx="5.4" ry="1.7" fill="#e9ffd2" stroke="#7cc85a" strokeWidth=".7" />
          </g>
        )
      })}
      {/* 捆绳 */}
      <rect x="22" y="37" width="20" height="8" rx="3" fill={`url(#${p}r)`} />
      <rect x="24" y="38.3" width="16" height="1.8" rx=".9" fill="#fff" opacity=".45" />
      {/* 脸：眯眼傻笑 + 腮红 + 一滴汗 */}
      <g fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round">
        <path d="M24.6 25.5 Q27.2 22 29.8 25.5" />
        <path d="M34.2 25.5 Q36.8 22 39.4 25.5" />
      </g>
      <path d="M27.6 28.4 Q32 35.6 36.4 28.4 Z" fill={INK} stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M29.6 31.6 Q32 30 34.4 31.6 Q32 33.6 29.6 31.6 Z" fill="#ff7a93" />
      <ellipse cx="22.6" cy="29.6" rx="2.6" ry="1.6" fill="#ff7a93" opacity=".8" />
      <ellipse cx="41.4" cy="29.6" rx="2.6" ry="1.6" fill="#ff7a93" opacity=".8" />
      <path d="M45.6 17.5 Q43.2 21.6 45.6 23 Q48 21.6 45.6 17.5 Z" fill="#8fd8ff" stroke="#3a9ad9" strokeWidth=".8" strokeLinejoin="round" />
    </>
  ),
})

// ---------- 大阳线：一根粗壮发亮的绿 K 线 ----------
const candle = (p: string): GiftArt => ({
  sil: () => (
    <>
      <rect x="29.5" y="3.5" width="5" height="57" rx="2.5" />
      <rect x="18" y="14" width="28" height="36" rx="5" />
      <path d={star(52.5, 11, 6)} /><path d={star(11, 22, 4.2)} /><path d={star(53, 45, 3.6)} />
    </>
  ),
  art: (
    <>
      <defs>
        <linearGradient id={`${p}b`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8dffb4" /><stop offset=".45" stopColor="#22d46b" /><stop offset="1" stopColor="#0b9a4a" /></linearGradient>
        <linearGradient id={`${p}w`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#35c96f" /><stop offset="1" stopColor="#0e7d3d" /></linearGradient>
        <linearGradient id={`${p}s`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff7c2" /><stop offset="1" stopColor="#ffd23f" /></linearGradient>
      </defs>
      <rect x="30" y="4" width="4" height="56" rx="2" fill={`url(#${p}w)`} />
      <rect x="18" y="14" width="28" height="36" rx="5" fill={`url(#${p}b)`} stroke="#0b7a3a" strokeOpacity=".5" strokeWidth="1" />
      <rect x="21.5" y="17.5" width="4.2" height="29" rx="2.1" fill="#fff" opacity=".6" />
      <rect x="28" y="17.5" width="1.8" height="14" rx=".9" fill="#fff" opacity=".35" />
      <path d={star(52.5, 11, 6)} fill={`url(#${p}s)`} />
      <path d={star(11, 22, 4.2)} fill={`url(#${p}s)`} />
      <path d={star(53, 45, 3.6)} fill="#b6ffcf" />
    </>
  ),
})

// ---------- 冲：绑「冲」字头带的飞机耳猫，眼神坚定，背后速度线 ----------
const CX = 38, CY = 35, CS = 0.48
/** 「冲」字，猫头坐标系（120）里，中心约在 60,39 */
const CHONG = 'M49.5 31.2 L52 33.2 M49 39.6 L52.3 36.3 M55.5 32.6 H69.5 V38.2 H55.5 Z M62.5 29.4 V41.4'
const fire = (p: string): GiftArt => ({
  sil: (sw) => (
    <>
      <CatSil x={CX} y={CY} s={CS} sw={sw} />
      <g transform={catTf(CX, CY, CS)} strokeWidth={sw / CS}>
        <path d="M21 36 L-8 23 L-3 35 L-15 40 L19 45 Z" />
      </g>
      <rect x="2" y="27" width="11" height="3.2" rx="1.6" /><rect x="0.5" y="35" width="10" height="3.2" rx="1.6" /><rect x="3" y="43" width="9" height="3.2" rx="1.6" />
    </>
  ),
  art: (
    <>
      <defs>
        <linearGradient id={`${p}r`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff5a5f" /><stop offset="1" stopColor="#c8102e" /></linearGradient>
        <clipPath id={`${p}c`}><path d={FACE} /></clipPath>
      </defs>
      <g fill="#ff9f43"><rect x="2" y="27" width="11" height="3.2" rx="1.6" /><rect x="0.5" y="35" width="10" height="3.2" rx="1.6" /><rect x="3" y="43" width="9" height="3.2" rx="1.6" /></g>
      <g transform={catTf(CX, CY, CS)}>
        {/* 头带飘带（在头后面） */}
        <path d="M21 36 L-8 23 L-3 35 L-15 40 L19 45 Z" fill={`url(#${p}r)`} stroke="#8e0b20" strokeOpacity=".4" strokeWidth="1.5" strokeLinejoin="round" />
      </g>
      <Cat p={p} x={CX} y={CY} s={CS} dy={5}>
        {/* 头带 */}
        <g clipPath={`url(#${p}c)`}>
          <path d="M10 31 Q60 19 110 31 L110 48 Q60 36 10 48 Z" fill={`url(#${p}r)`} />
          <path d="M10 33 Q60 21.5 110 33" stroke="#fff" strokeOpacity=".4" strokeWidth="2" fill="none" />
        </g>
        <path d={CHONG} stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        {/* 结 */}
        <circle cx="21" cy="40" r="6" fill="#c8102e" stroke="#8e0b20" strokeOpacity=".4" strokeWidth="1.5" />
        {/* 倒八字眉：认真 */}
        <path d="M30 46.5 L46 53 M74 53 L90 46.5" stroke={INK} strokeWidth="6" strokeLinecap="round" />
      </Cat>
    </>
  ),
})

// ---------- 火箭：舷窗里坐着 0x4 猫 ----------
const ROCKET_BODY = 'M32 5 C40 10 43 20 43 32 L43 44 Q32 48 21 44 L21 32 C21 20 24 10 32 5 Z'
const rocket = (p: string): GiftArt => ({
  sil: () => (
    <>
      <g transform="rotate(42 32 32)">
        <path d={ROCKET_BODY} />
        <path d="M21 29 L11 41 L11 49 L21 44 Z" /><path d="M43 29 L53 41 L53 49 L43 44 Z" />
        <path d="M23.5 45 Q32 67 40.5 45 Z" />
      </g>
      <path d={star(12, 12, 4.4)} /><path d={star(55, 52, 3.6)} />
    </>
  ),
  art: (
    <>
      <defs>
        <linearGradient id={`${p}b`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#ffffff" /><stop offset=".55" stopColor="#e9ecf8" /><stop offset="1" stopColor="#aeb6d6" /></linearGradient>
        <linearGradient id={`${p}r`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#ff6f7d" /><stop offset="1" stopColor="#d4163c" /></linearGradient>
        <linearGradient id={`${p}f`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffe066" /><stop offset=".5" stopColor="#ff9a1f" /><stop offset="1" stopColor="#ff4d2e" /></linearGradient>
        <radialGradient id={`${p}w`} cx=".4" cy=".35" r=".7"><stop offset="0" stopColor="#3b4f9a" /><stop offset="1" stopColor="#141c44" /></radialGradient>
        <clipPath id={`${p}c`}><path d={ROCKET_BODY} /></clipPath>
      </defs>
      <g transform="rotate(42 32 32)">
        <path d="M23.5 45 Q32 67 40.5 45 Z" fill={`url(#${p}f)`} />
        <path d="M27 45 Q32 58 37 45 Z" fill="#fff6c4" />
        <path d="M21 29 L11 41 L11 49 L21 44 Z" fill={`url(#${p}r)`} />
        <path d="M43 29 L53 41 L53 49 L43 44 Z" fill={`url(#${p}r)`} />
        <path d={ROCKET_BODY} fill={`url(#${p}b)`} />
        <g clipPath={`url(#${p}c)`}>
          <rect x="18" y="0" width="30" height="15.5" fill={`url(#${p}r)`} />
          <rect x="18" y="41" width="30" height="8" fill={`url(#${p}r)`} />
          <rect x="24.5" y="14" width="2.6" height="28" rx="1.3" fill="#fff" opacity=".9" />
        </g>
        <circle cx="32" cy="28" r="8.4" fill="#8e97bd" />
        <circle cx="32" cy="28" r="6.8" fill={`url(#${p}w)`} />
        <g transform="rotate(-42 32 28)">
          <Cat p={p} x={32} y={28.6} s={0.112} bold />
        </g>
        <path d="M27.5 24.5 Q29.5 22.2 32.5 22" stroke="#fff" strokeOpacity=".7" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      </g>
      <path d={star(12, 12, 4.4)} fill="#ffe066" />
      <path d={star(55, 52, 3.6)} fill="#9fd8ff" />
    </>
  ),
})

// ---------- 登月：月亮上插一面猫头旗 ----------
const FLAG = 'M36 6 Q47 2.5 59 6.5 L59 23 Q47 19 36 22.5 Z'
const moon = (p: string): GiftArt => ({
  sil: () => (
    <>
      <circle cx="29" cy="42" r="19" />
      <rect x="33.6" y="4.5" width="3" height="24" rx="1.5" />
      <path d={FLAG} />
      <path d={star(14, 10, 5)} /><path d={star(9, 30, 3)} />
    </>
  ),
  art: (
    <>
      <defs>
        <radialGradient id={`${p}m`} cx=".35" cy=".3" r=".8"><stop offset="0" stopColor="#fffbe0" /><stop offset=".5" stopColor="#ffe27a" /><stop offset="1" stopColor="#f2a91e" /></radialGradient>
        <linearGradient id={`${p}f`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#b98cff" /><stop offset="1" stopColor="#ff6fb5" /></linearGradient>
      </defs>
      <rect x="34" y="5" width="2.2" height="23.5" rx="1.1" fill="#c9ced9" />
      <circle cx="35.1" cy="5" r="1.8" fill="#ffd23f" />
      <path d={FLAG} fill={`url(#${p}f)`} stroke="#7c3aed" strokeOpacity=".5" strokeWidth=".8" strokeLinejoin="round" />
      <Cat p={p} x={47.6} y={13.8} s={0.15} bold />
      <circle cx="29" cy="42" r="19" fill={`url(#${p}m)`} />
      <path d="M44 32 A19 19 0 0 1 17 57 A21 21 0 0 0 44 32 Z" fill="#e0901a" opacity=".35" />
      <g fill="#e8a52a" opacity=".55">
        <circle cx="21" cy="37" r="4.2" /><circle cx="36" cy="47" r="3.2" /><circle cx="24" cy="50" r="2.2" /><circle cx="38" cy="36" r="1.8" />
      </g>
      <g fill="#fff" opacity=".6"><circle cx="20.2" cy="36" r="1.6" /><circle cx="35.3" cy="46.2" r="1.2" /></g>
      <path d={star(14, 10, 5)} fill="#ffe066" />
      <path d={star(9, 30, 3)} fill="#ffe066" />
    </>
  ),
})

// ---------- 钻石手：握拳的钻石手 ----------
const FINGERS = [13.5, 23, 32.5, 42]
const THUMB = 'M12 40 Q12 33.5 18 33.5 L38 35.5 Q44.5 36.3 44.5 41 Q44.5 46 38.5 46 L18 46 Q12 46 12 40 Z'
const diamond = (p: string): GiftArt => ({
  sil: () => (
    <>
      <rect x="21" y="44" width="22" height="16" rx="3" />
      <rect x="12" y="22" width="40" height="28" rx="8" />
      {FINGERS.map((x) => <rect key={x} x={x} y="12" width="9.5" height="24" rx="4.75" />)}
      <path d={THUMB} />
      <path d={star(55, 10, 5)} /><path d={star(8, 20, 3.4)} />
    </>
  ),
  art: (
    <>
      <defs>
        <linearGradient id={`${p}d`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f2fdff" /><stop offset=".45" stopColor="#8fdcff" /><stop offset="1" stopColor="#3f8cf0" /></linearGradient>
        <linearGradient id={`${p}d2`} x1="1" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#dff8ff" /><stop offset=".5" stopColor="#74c8ff" /><stop offset="1" stopColor="#3a7fe0" /></linearGradient>
      </defs>
      {/* 手腕 */}
      <rect x="21" y="44" width="22" height="16" rx="3" fill={`url(#${p}d2)`} />
      <path d="M21 52 L32 46 L43 53 M32 46 V60" stroke="#fff" strokeOpacity=".6" strokeWidth=".9" fill="none" />
      {/* 手背 */}
      <rect x="12" y="22" width="40" height="28" rx="8" fill={`url(#${p}d)`} />
      <path d="M12.5 44 L24 30 L40 48 L52 30" stroke="#fff" strokeOpacity=".55" strokeWidth=".9" fill="none" />
      {/* 四根手指，每根切出亮面和暗面 */}
      {FINGERS.map((x, i) => (
        <g key={x}>
          <rect x={x} y="12" width="9.5" height="24" rx="4.75" fill={`url(#${i % 2 ? `${p}d2` : `${p}d`})`} stroke="#2f74cf" strokeOpacity=".45" strokeWidth=".8" />
          <path d={`M${x + 1} ${17} L${x + 4.75} ${12.6} L${x + 8.5} ${17} L${x + 4.75} ${23} Z`} fill="#fff" opacity=".75" />
          <path d={`M${x + 8.5} ${20} L${x + 8.5} ${32} L${x + 4.75} ${35.4} L${x + 4.75} ${25} Z`} fill="#2f74cf" opacity=".28" />
          <path d={`M${x + 1} ${20} L${x + 4.75} ${25} L${x + 4.75} ${35.4}`} stroke="#fff" strokeOpacity=".7" strokeWidth=".8" fill="none" />
        </g>
      ))}
      {/* 拇指 */}
      <path d={THUMB} fill={`url(#${p}d2)`} stroke="#2f74cf" strokeOpacity=".45" strokeWidth=".8" />
      <path d="M14 38.5 L22 35 L30 40.5 L38 36.2 L43.5 40.5" stroke="#fff" strokeOpacity=".85" strokeWidth="1" fill="none" strokeLinejoin="round" />
      <path d="M16 36.2 L22 35 L19 40 Z" fill="#fff" opacity=".8" />
      <path d="M30 40.5 L38 36.2 L41 44.5 L31 45 Z" fill="#2f74cf" opacity=".25" />
      <path d={star(55, 10, 5)} fill="#fff" stroke="#8fdcff" strokeWidth=".8" />
      <path d={star(8, 20, 3.4)} fill="#bdeeff" />
    </>
  ),
})

// ---------- 巨鲸：圆滚滚的蓝鲸，喷出来的是金币 ----------
const WHALE = 'M6 43 C6 32 16 26 29 26 C41 26 50 33 51 42 C54 40 56 35 55 31 C52 30 50 27.5 50.5 24.5 C53.5 25.5 56 27.5 57.5 29.5 C58.5 26.5 60.5 24.5 63 24 C63 29 61 33 58.5 35 C58 46 50 57 30 57 C15 57 6 52 6 43 Z'
const coin = (p: string, cx: number, cy: number, r: number, rot: number) => (
  <g transform={`rotate(${rot} ${cx} ${cy})`}>
    <ellipse cx={cx} cy={cy} rx={r * 0.82} ry={r} fill="#d98a00" />
    <ellipse cx={cx - r * 0.12} cy={cy} rx={r * 0.72} ry={r * 0.92} fill={`url(#${p}c)`} />
    <ellipse cx={cx - r * 0.12} cy={cy} rx={r * 0.42} ry={r * 0.56} fill="none" stroke="#c97d00" strokeWidth=".9" />
    <path d={`M${cx - r * 0.4} ${cy - r * 0.45} Q${cx - r * 0.1} ${cy - r * 0.8} ${cx + r * 0.2} ${cy - r * 0.6}`} stroke="#fff" strokeOpacity=".85" strokeWidth="1" fill="none" strokeLinecap="round" />
  </g>
)
const whale = (p: string): GiftArt => ({
  sil: () => (
    <>
      <path d={WHALE} />
      <path d="M24.5 27 Q22 19 17 14 L21 13 Q25 17 27 22 Q28.5 16 33 12 L37 13.5 Q31 19 30 27 Z" />
      <circle cx="15" cy="10" r="5.4" /><circle cx="38" cy="9.5" r="5.8" /><circle cx="26.5" cy="6.5" r="4.4" />
    </>
  ),
  art: (
    <>
      <defs>
        <linearGradient id={`${p}b`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6fc3ff" /><stop offset=".6" stopColor="#2f86f0" /><stop offset="1" stopColor="#1f5fcf" /></linearGradient>
        <linearGradient id={`${p}c`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff3a6" /><stop offset=".5" stopColor="#ffd23f" /><stop offset="1" stopColor="#f5a300" /></linearGradient>
        <clipPath id={`${p}k`}><path d={WHALE} /></clipPath>
        <radialGradient id={`${p}h`} cx=".3" cy=".25" r=".6"><stop offset="0" stopColor="#fff" stopOpacity=".55" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
      </defs>
      {/* 水柱 */}
      <path d="M24.5 27 Q22 19 17 14 L21 13 Q25 17 27 22 Q28.5 16 33 12 L37 13.5 Q31 19 30 27 Z" fill="#9ee0ff" />
      <path d="M26 25 Q24 19 20 15" stroke="#fff" strokeOpacity=".8" strokeWidth="1" fill="none" strokeLinecap="round" />
      <path d={WHALE} fill={`url(#${p}b)`} />
      <g clipPath={`url(#${p}k)`}>
        <ellipse cx="26" cy="58" rx="24" ry="9.5" fill="#d8f0ff" />
        <path d="M10 51.5 Q26 55 42 51.5 M12 54.5 Q26 58 40 54.5" stroke="#9ccbee" strokeWidth=".9" fill="none" />
        <ellipse cx="20" cy="34" rx="14" ry="8" fill={`url(#${p}h)`} />
      </g>
      {/* 眼睛、笑、腮红 */}
      <circle cx="18.5" cy="40" r="3" fill={INK} />
      <circle cx="19.5" cy="38.9" r="1.1" fill="#fff" />
      <path d="M10.5 45.5 Q15 49 20 46.5" stroke={INK} strokeWidth="1.7" fill="none" strokeLinecap="round" />
      <ellipse cx="24.5" cy="44.8" rx="2.8" ry="1.6" fill="#ff8fb1" opacity=".85" />
      <path d="M33 45 Q37 49 41 45" stroke="#1f5fcf" strokeOpacity=".5" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      {coin(p, 15, 10, 5.4, -18)}
      {coin(p, 38, 9.5, 5.8, 15)}
      {coin(p, 26.5, 6.5, 4.4, 0)}
    </>
  ),
})

// ---------- 兰博：金紫低趴超跑侧面（无任何车标） ----------
const CAR = 'M2 41 L3.2 38.4 L20 34 L31.5 28.4 Q34 27.6 42 27.8 L57 32 Q61 33 61.8 35.5 L61.8 41.2 Q61.8 44 58.8 44 L5 44 Q2 44 2 41 Z'
// 车头朝右（镜像），整体略微抬头；车身缩一点给车尾的速度线腾位置
const CAR_TF = 'translate(64 -4) scale(-1 1) rotate(7 32 36)'
const CAR_S = 'translate(29 38) scale(.94) translate(-30 -38)'
const lambo = (p: string): GiftArt => ({
  sil: () => (
    <g transform={CAR_TF}>
      <g transform={CAR_S}>
        <path d={CAR} />
        <rect x="53" y="26.6" width="9.5" height="3" rx="1.2" />
        <circle cx="16" cy="44" r="7.6" /><circle cx="50" cy="44" r="7.6" />
      </g>
      <rect x="58.5" y="30.5" width="7.5" height="2.6" rx="1.3" /><rect x="60" y="36.5" width="5.5" height="2.6" rx="1.3" />
      <path d={star(20, 13, 5)} /><path d={star(9, 22, 3)} />
    </g>
  ),
  art: (
    <>
      <defs>
        <linearGradient id={`${p}g`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff6b8" /><stop offset=".4" stopColor="#ffcf2e" /><stop offset="1" stopColor="#d88a00" /></linearGradient>
        <linearGradient id={`${p}v`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#c7a6ff" /><stop offset="1" stopColor="#5b21b6" /></linearGradient>
        <linearGradient id={`${p}s`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#a855f7" /><stop offset="1" stopColor="#6d28d9" /></linearGradient>
      </defs>
      <g transform={CAR_TF}>
        <g fill="#c084fc"><rect x="58.5" y="30.5" width="7.5" height="2.6" rx="1.3" /><rect x="60" y="36.5" width="5.5" height="2.6" rx="1.3" /></g>
        <g transform={CAR_S}>
        {/* 尾翼 */}
        <rect x="56.2" y="28.6" width="2" height="4" fill="#5b21b6" />
        <rect x="53" y="26.6" width="9.5" height="3" rx="1.2" fill={`url(#${p}s)`} />
        <path d={CAR} fill={`url(#${p}g)`} stroke="#a86400" strokeOpacity=".45" strokeWidth=".8" strokeLinejoin="round" />
        {/* 车窗 */}
        <path d="M23 34.2 L32.2 29.4 Q34.6 28.7 41.6 28.9 L52.6 32.4 L23.5 34.8 Z" fill={`url(#${p}v)`} />
        <path d="M31 30.6 L28.5 33.4" stroke="#fff" strokeOpacity=".7" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M42 29 L41 33.4" stroke="#ffcf2e" strokeWidth="1.1" />
        {/* 腰线 + 进气口 */}
        <path d="M5.5 39 L58 36.4 L61 38.4 L5.5 41.4 Z" fill={`url(#${p}s)`} />
        <path d="M44 35.2 L54.5 34.4 L52 37.2 Z" fill="#3b0764" opacity=".75" />
        <path d="M6 37.4 L19.5 34.4" stroke="#fff" strokeOpacity=".8" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M3.8 39.2 L8 38.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        {/* 轮子 */}
        {[16, 50].map((x) => (
          <g key={x}>
            <circle cx={x} cy="44" r="7.2" fill={INK} />
            <circle cx={x} cy="44" r="4.4" fill={`url(#${p}v)`} />
            <circle cx={x} cy="44" r="1.8" fill="#ffcf2e" />
            <path d={`M${x - 2.6} ${41.2} Q${x} ${39.6} ${x + 2.6} ${41.2}`} stroke="#fff" strokeOpacity=".6" strokeWidth=".9" fill="none" strokeLinecap="round" />
          </g>
        ))}
        </g>
        <path d={star(20, 13, 5)} fill="#ffe066" />
        <path d={star(9, 22, 3)} fill="#e9d5ff" />
      </g>
    </>
  ),
})

// ---------- 通用礼盒（未知 id 时用） ----------
const box = (p: string): GiftArt => ({
  sil: () => (
    <>
      <rect x="12" y="29" width="40" height="28" rx="4" />
      <rect x="9" y="21" width="46" height="11" rx="3.5" />
      <path d="M32 21 C24 8 12 12 18 19 Q22 22 32 21 Z M32 21 C40 8 52 12 46 19 Q42 22 32 21 Z" />
    </>
  ),
  art: (
    <>
      <defs>
        <linearGradient id={`${p}b`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffb3d1" /><stop offset="1" stopColor="#a78bfa" /></linearGradient>
        <linearGradient id={`${p}y`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff3a6" /><stop offset="1" stopColor="#f5b300" /></linearGradient>
      </defs>
      <rect x="12" y="29" width="40" height="28" rx="4" fill={`url(#${p}b)`} />
      <rect x="9" y="21" width="46" height="11" rx="3.5" fill={`url(#${p}b)`} />
      <rect x="12" y="32" width="40" height="3" fill="#7c5bd6" opacity=".25" />
      <rect x="28.5" y="21" width="7" height="36" fill={`url(#${p}y)`} />
      <path d="M32 21 C24 8 12 12 18 19 Q22 22 32 21 Z M32 21 C40 8 52 12 46 19 Q42 22 32 21 Z" fill={`url(#${p}y)`} stroke="#d99100" strokeWidth=".8" strokeLinejoin="round" />
      <circle cx="32" cy="21" r="3.2" fill="#f5b300" />
      <rect x="13" y="23" width="12" height="2" rx="1" fill="#fff" opacity=".55" />
    </>
  ),
})

export const GIFT_ART: Record<string, (p: string) => GiftArt> = { rose: leek, beer: candle, fire, rocket, moon, diamond, whale, lambo }
export const FALLBACK_ART = box
