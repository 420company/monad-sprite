// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('本机存储 fomo.* → 0x4.* 迁移', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules() })

  it('旧键搬到新键并删除旧键，内容原样', async () => {
    localStorage.setItem('fomo.wallet', '{"state":{"vault":{"publicKey":"A"}},"version":0}')
    localStorage.setItem('fomo.settings', '{"x":1}')
    localStorage.setItem('other', 'keep')
    await import('./storageMigrate')
    expect(localStorage.getItem('0x4.wallet')).toBe('{"state":{"vault":{"publicKey":"A"}},"version":0}')
    expect(localStorage.getItem('0x4.settings')).toBe('{"x":1}')
    expect(localStorage.getItem('fomo.wallet')).toBeNull()
    expect(localStorage.getItem('fomo.settings')).toBeNull()
    expect(localStorage.getItem('other')).toBe('keep')
  })

  it('新键已经有了：不拿旧数据覆盖，只删旧键', async () => {
    localStorage.setItem('0x4.wallet', 'new')
    localStorage.setItem('fomo.wallet', 'old')
    await import('./storageMigrate')
    expect(localStorage.getItem('0x4.wallet')).toBe('new')
    expect(localStorage.getItem('fomo.wallet')).toBeNull()
  })
})
