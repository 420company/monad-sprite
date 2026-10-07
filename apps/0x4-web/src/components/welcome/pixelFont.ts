// 标语「MEME IS / EVERYTHING.」的像素点阵（2026-09-25，替换掉液态铬衬线字；goat 要求全大写更整齐）。
//
// 不用字体文件：只有这两行字，自己画点阵最锐利，也不用等字体加载。
// 全大写，每个字 7 行高，没有升部降部。竖笔两格宽、横笔一格高，字宽 5~7 格，字间 1 格，空格 3 格。

type Glyph = string[]

/** top = 字形从第几行开始画 */
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
/** 每行字占的行数（含降部） */
export const GLYPH_ROWS = 7
/** 第二行相对第一行往下错多少格：行间留 2 格 */
export const LINE_ADVANCE = 9

export interface PixelCell {
  /** 列、行（格子坐标） */
  x: number
  y: number
  /** 第几行字、第几个字母（做入场错落用） */
  line: number
  char: number
}

export interface PixelText {
  cols: number
  rows: number
  cells: PixelCell[]
}

/** 把几行字排成格子坐标，左对齐 */
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
