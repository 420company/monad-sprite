// Wallet announcement icon filtering (2026-10-03): Phantom's icon starts with a newline — it should be accepted after trimming whitespace; anything not data:image is dropped
import { describe, expect, it } from 'vitest'
import { safeIcon } from './external'

describe('safeIcon', () => {
  it('Phantom 那种开头带换行的 data:image 图标，去掉空白后照常收下', () => {
    const icon = '\ndata:image/png;base64,iVBORw0KGgoAAAANS'
    expect(safeIcon(icon)).toBe(icon.trim())
    expect(safeIcon('  data:image/svg+xml;base64,PHN2Zz4=  ')).toBe('data:image/svg+xml;base64,PHN2Zz4=')
  })
  it('不是 data:image 的地址不拿来当图标', () => {
    expect(safeIcon('https://example.com/icon.png')).toBeNull()
    expect(safeIcon('data:text/html,<b>x</b>')).toBeNull()
    expect(safeIcon('javascript:alert(1)')).toBeNull()
    expect(safeIcon(undefined)).toBeNull()
    expect(safeIcon('data:image/png;base64,' + 'A'.repeat(200_000))).toBeNull()
  })
})
