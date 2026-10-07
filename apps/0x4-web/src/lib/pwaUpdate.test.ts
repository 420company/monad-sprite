import { describe, expect, it } from 'vitest'
import { canAutoReload, initPwaUpdate } from './pwaUpdate'

const base = { hadController: true, sinceLoad: 2000, interacted: false, typing: false, visible: true, sinceLastAuto: Date.now() }

describe('网页版新版本接管', () => {
  it('刚打开、没操作、在前台 → 自动刷新', () => {
    expect(canAutoReload(base)).toBe(true)
  })
  it('超过 5 秒 / 点过 / 正在输入 / 在后台 → 只提示不刷新', () => {
    expect(canAutoReload({ ...base, sinceLoad: 5001 })).toBe(false)
    expect(canAutoReload({ ...base, interacted: true })).toBe(false)
    expect(canAutoReload({ ...base, typing: true })).toBe(false)
    expect(canAutoReload({ ...base, visible: false })).toBe(false)
  })
  it('首次安装（之前没被 SW 控制）不算更新', () => {
    expect(canAutoReload({ ...base, hadController: false })).toBe(false)
  })
  it('60 秒内自动刷过一次就不再自动刷（防循环）', () => {
    expect(canAutoReload({ ...base, sinceLastAuto: 30_000 })).toBe(false)
    expect(canAutoReload({ ...base, sinceLastAuto: 61_000 })).toBe(true)
  })
  it('没有 SW 的包（原生 App / 测试环境）什么都不做', () => {
    expect(() => initPwaUpdate()).not.toThrow()
  })
})
