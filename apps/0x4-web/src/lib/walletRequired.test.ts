// @vitest-environment jsdom
// Web logged in via phone QR scan only, attempting something that needs a wallet (2026-10-01 security review #5, goat: the web has the fullest features — moving money and changing trades need a wallet):
// Server returns 403 + code WALLET_REQUIRED → pop wallet connect, no red error; other 403s error as usual
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, setToken, setWalletRequiredHandler } from './social'

const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))

afterEach(() => { setWalletRequiredHandler(null); setToken(null); vi.unstubAllGlobals() })

describe('要连钱包的操作', () => {
  it('服务器说要连钱包：弹出连接钱包，按「已取消」处理（不弹红色错误）', async () => {
    const open = vi.fn()
    setWalletRequiredHandler(open)
    setToken('qr-token')
    vi.stubGlobal('fetch', reply(403, { error: '请先连接钱包再操作', code: 'WALLET_REQUIRED' }))
    const e = await api<never>('/api/credits/transfer', { method: 'POST', body: '{}' }).catch((x: unknown) => x as Error & { status?: number })
    expect(open).toHaveBeenCalledTimes(1)
    expect(e.name).toBe('WalletRequired')
  })
  it('别的 403 照常报错，不弹钱包', async () => {
    const open = vi.fn()
    setWalletRequiredHandler(open)
    setToken('t')
    vi.stubGlobal('fetch', reply(403, { error: '你已被移出本场会议', code: 'KICKED' }))
    const e = await api<never>('/api/meet/meetings/x/join', { method: 'POST', body: '{}' }).catch((x: unknown) => x as Error & { status?: number })
    expect(open).not.toHaveBeenCalled()
    expect(e.name).not.toBe('WalletRequired')
    expect(e.status).toBe(403)
  })
})
