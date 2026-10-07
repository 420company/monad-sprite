// 网页版左上角品牌：和官网首页（deploy/0x4-site 顶栏）完全同一套 —— 去掉留白的猫头 + 像素点阵字 0x4
// （5×7 点阵、带斜线的 0 是「眯眼 420」暗号，别改成普通 0）。猫和字都贴底，底边对齐。
import catUrl from './cat-tight.svg'

// 点阵：# = 亮。三个字各 5 列 × 7 行，字距 1 列
const GLYPHS = [
  ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
]
const RECTS: [number, number][] = []
GLYPHS.forEach((g, gi) => g.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') RECTS.push([gi * 6 + x, y]) })))

export function PixelWordmark({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 17 7" aria-hidden="true">
      <defs>
        <linearGradient id="desk-bw" x1="0" y1="0" x2="17" y2="7" gradientUnits="userSpaceOnUse">
          {/* 颜色走 CSS 变量：午夜黑是浅色渐变，香芋白换深一档的同色系（desktop.css .desk-brand-word） */}
          <stop offset="0" style={{ stopColor: 'var(--bw-1, #ffd9c2)' }} /><stop offset=".5" style={{ stopColor: 'var(--bw-2, #dccdff)' }} /><stop offset="1" style={{ stopColor: 'var(--bw-3, #b6ecff)' }} />
        </linearGradient>
      </defs>
      <g fill="url(#desk-bw)">{RECTS.map(([x, y]) => <rect key={`${x}-${y}`} x={x + .05} y={y + .05} width=".9" height=".9" rx=".08" />)}</g>
    </svg>
  )
}

export default function Brand() {
  return (
    <span className="desk-brand" aria-label="0x4">
      <img className="desk-brand-cat" src={catUrl} alt="" width={39} height={28} />
      <PixelWordmark className="desk-brand-word" />
    </span>
  )
}
