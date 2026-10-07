// Web top-left brand: exactly the same set as the official site's homepage (deploy/0x4-site top bar) — the cat head without padding + pixel-matrix "0x4"
// (5×7 dot matrix; the slashed 0 is the "squinting 420" easter egg — don't swap it for a plain 0). Cat and text both sit on the baseline, bottoms aligned.
import catUrl from './cat-tight.svg'

// Dot matrix: # = lit. Three glyphs, each 5 cols × 7 rows, 1-col letter spacing
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
          {/* Colors go through CSS variables: midnight black is a light gradient, taro white switches to a darker shade of the same family (desktop.css .desk-brand-word) */}
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
