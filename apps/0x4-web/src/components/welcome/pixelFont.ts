// Pixel matrix for the "MEME IS / EVERYTHING." slogan (2026-09-25, replacing the liquid-chrome serif; goat wants all-caps for tidiness).
//
// No font file: just these two lines — hand-drawn pixels are sharpest, and there's no font load to wait for.
// All caps, each glyph 7 rows tall, no ascenders/descenders. Vertical strokes 2 cells wide, horizontal strokes 1 cell tall, glyph width 5–7 cells, 1 cell between glyphs, 3 cells for spaces.

type Glyph = string[]

/** top = which row the glyph starts drawing from */
const glyph = (top: number, rows: string[]): Glyph => [...Array<string>(top).fill(''), ...rows]

const GLYPHS: Record<string, Glyph> = {
  M: glyph(0, [
    '##...##',
    '###.###',
    '#######',
    '##.#.##',
    '##...##',
    '##...##',
    '##...##',
  ]),
  E: glyph(0, [
    '#####',
    '##...',
    '##...',
    '####.',
    '##...',
    '##...',
    '#####',
  ]),
  I: glyph(0, ['##', '##', '##', '##', '##', '##', '##']),
  S: glyph(0, [
    '.####',
    '##...',
    '##...',
    '.###.',
    '...##',
    '...##',
    '####.',
  ]),
  V: glyph(0, [
    '##..##',
    '##..##',
    '##..##',
    '##..##',
    '.####.',
    '.####.',
    '..##..',
  ]),
  R: glyph(0, [
    '####.',
    '##.##',
    '##.##',
    '####.',
    '###..',
    '##.##',
    '##.##',
  ]),
  Y: glyph(0, [
    '##..##',
    '##..##',
    '.####.',
    '..##..',
    '..##..',
    '..##..',
    '..##..',
  ]),
  T: glyph(0, [
    '######',
    '..##..',
    '..##..',
    '..##..',
    '..##..',
    '..##..',
    '..##..',
  ]),
  H: glyph(0, [
    '##.##',
    '##.##',
    '##.##',
    '#####',
    '##.##',
    '##.##',
    '##.##',
  ]),
  N: glyph(0, [
    '##..##',
    '###.##',
    '######',
    '##.###',
    '##..##',
    '##..##',
    '##..##',
  ]),
  G: glyph(0, [
    '.####',
    '##...',
    '##...',
    '##.##',
    '##.##',
    '##.##',
    '.####',
  ]),
  '.': glyph(5, ['##', '##']),
}

const width = (g: Glyph) => Math.max(...g.map(r => r.length))
const SPACE = 3
const GAP = 1
/** Rows occupied per line of text (incl. descenders) */
export const GLYPH_ROWS = 7
/** How many cells the second line sits below the first: 2 cells between lines */
export const LINE_ADVANCE = 9

export interface PixelCell {
  /** Column, row (grid coordinates) */
  x: number
  y: number
  /** Which line, which letter (for staggered entrance) */
  line: number
  char: number
}

export interface PixelText {
  cols: number
  rows: number
  cells: PixelCell[]
}

/** Lay out the lines into grid coordinates, left-aligned */
export function layoutPixelText(lines: string[]): PixelText {
  const cells: PixelCell[] = []
  let cols = 0
  lines.forEach((line, li) => {
    let x = 0
    let char = 0
    for (const ch of line) {
      if (ch === ' ') { x += SPACE - GAP; continue }
      const g = GLYPHS[ch]
      if (!g) throw new Error(`pixelFont: 没有字形 "${ch}"`)
      g.forEach((row, y) => {
        for (let c = 0; c < row.length; c++) if (row[c] === '#') cells.push({ x: x + c, y: li * LINE_ADVANCE + y, line: li, char })
      })
      x += width(g) + GAP
      char++
    }
    cols = Math.max(cols, x - GAP)
  })
  return { cols, rows: (lines.length - 1) * LINE_ADVANCE + GLYPH_ROWS, cells }
}
