// @vitest-environment jsdom
// 网页版「用 0x4 App 扫码登录」（2026-10-01 goat：meet.420.meme 下线，会议只留网页版；没装插件的电脑也能登录）：
// ① 扫码流程：二维码是手机确认页网址（app.420.meme/#/pc-login?c=ox4meet:…），带 app:'web' 发起；已扫码 → 确认 → 拿到令牌
// ② 拿令牌登录：社交层 ready、qrMode、令牌按账号存在本机；刷新页面（没连钱包）用存的令牌恢复；令牌失效就删掉、不卡住
// ③ 只有会议 / 直播 / 群聊等标了 app 的页面放行，钱包页面照旧要钱包；会议、直播的操作（needLogin）放行，交易类（needWallet）照旧弹连接面板
// ④ 退出登录删掉本机令牌；连上钱包时换成钱包登录
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/surface', () => ({ WEB_SURFACE: true }))

const { beginQrLogin, phoneConfirmUrl } = await import('./qrLogin')
const { needLogin, needWallet, useWalletGate } = await import('./walletGate')
const { useSocial, readQrSession } = await import('@/store/social')
const { setToken, getToken } = await import('@/lib/social')
const { parseLoginQr } = await import('@/lib/meetQr')

class NoSocket { readyState = 0; onopen = null; onclose = null; onmessage = null; send() {} close() {} }
const ACC = 'AliceQr111111111111111111111111111111111111'

/** 本机假服务器：扫码登录三步 + /api/me + 续期 */
function fakeServer(srvTrusted = false) {
  const hits: { path: string; body?: unknown; headers?: Record<string, string> }[] = []
  let polls = 0
  const valid = new Set(['WEBTOKEN'])
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0]
    const headers = (init?.headers || {}) as Record<string, string>
    hits.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers })
    const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status })
    const bearer = String(headers.authorization || '').replace('Bearer ', '')
    if (path === '/api/meet/login/start') return j({ loginId: 'L'.repeat(22), pollKey: 'PK', qr: `ox4meet:${'L'.repeat(22)}:${'C'.repeat(22)}`, expiresAt: Date.now() + 180_000, ttl: 180_000 })
    if (path.startsWith('/api/meet/login/')) {
      if (headers['x-poll-key'] !== 'PK') return j({ error: '二维码已失效' }, 404)
      polls++
      return j(polls === 1 ? { status: 'scanned' } : { status: 'approved', token: 'WEBTOKEN', user: { address: ACC }, trusted: srvTrusted })
    }
    if (path === '/api/me') return valid.has(bearer) ? j({ address: ACC, nickname: 'Alice', encPub: 'PUB' }) : j({ error: '未登录' }, 401)
    if (path === '/api/auth/refresh') return valid.has(bearer) ? j({ token: 'WEBTOKEN2' }) : j({ error: '未登录' }, 401)
    return j(path.endsWith('s') || path.includes('groups') ? [] : {})
  }))
  return { hits, revoke: () => valid.clear(), allow: (t: string) => valid.add(t) }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', NoSocket)
  localStorage.clear()
  sessionStorage.clear()
  useSocial.getState().logout(true)
  setToken(null)
  useWalletGate.setState({ open: false, appQr: false })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('网页版扫码登录', () => {
  it('二维码是手机确认页网址，手机 App 和手机相机都能认', () => {
    const qr = `ox4meet:${'a'.repeat(22)}:${'b'.repeat(22)}`
    const url = phoneConfirmUrl(qr)
    expect(url.startsWith('https://app.420.meme/#/pc-login?c=')).toBe(true)
    expect(parseLoginQr(url)).toEqual({ kind: 'meet', loginId: 'a'.repeat(22), challenge: 'b'.repeat(22) })
  })

  it('发起带 app:web；已扫码 → 确认 → 拿到令牌；登录后社交层就绪、令牌按账号存在本机', async () => {
    const srv = fakeServer()
    const seen: string[] = []
    const h = await beginQrLogin((s) => seen.push(s))
    expect(srv.hits[0]).toMatchObject({ path: '/api/meet/login/start', body: { app: 'web' } })
    expect(srv.hits[0].headers?.authorization).toBeUndefined()
    const r = await h.done
    expect(seen).toEqual(['scanned', 'approved'])
    expect(r).toEqual({ status: 'approved', token: 'WEBTOKEN', trusted: false })
    expect(await useSocial.getState().loginWithQr(r.token)).toBe(true)
    const st = useSocial.getState()
    expect(st.status).toBe('ready'); expect(st.qrMode).toBe(true); expect(st.me?.address).toBe(ACC)
    expect(st.dmKeyElsewhere).toBe(true)   // 私信钥匙不在这台电脑
    expect(getToken()).toBe('WEBTOKEN')
    expect(readQrSession()).toEqual({ account: ACC, token: 'WEBTOKEN', trusted: false })
    expect(st.qrTrusted).toBe(false)
  })

  it('手机上选了「信任此设备」：令牌存 localStorage（关掉浏览器也保持 30 天），不做无操作退出', async () => {
    fakeServer(true)
    const r = await (await beginQrLogin(() => {})).done
    expect(r).toEqual({ status: 'approved', token: 'WEBTOKEN', trusted: true })
    expect(await useSocial.getState().loginWithQr(r.token, r.trusted)).toBe(true)
    expect(useSocial.getState().qrTrusted).toBe(true)
    expect(JSON.parse(localStorage.getItem('0x4.webQrSession') || 'null')?.token).toBe('WEBTOKEN')
    expect(sessionStorage.getItem('0x4.webQrSession')).toBeNull()
    // 关掉浏览器再打开（sessionStorage 没了，localStorage 还在）：用存的令牌恢复，仍是信任的电脑
    useSocial.getState().logout()
    sessionStorage.clear()
    expect(readQrSession()).toEqual({ account: ACC, token: 'WEBTOKEN', trusted: true })
    expect(await useSocial.getState().loginWithQr()).toBe(true)
    expect(useSocial.getState().qrTrusted).toBe(true)
    // 退出登录：两边都删
    useSocial.getState().logout(true)
    expect(localStorage.getItem('0x4.webQrSession')).toBeNull()
  })

  it('刷新页面（没连钱包）用本机存的令牌恢复并顺手续期；令牌失效就删掉回到没登录', async () => {
    const srv = fakeServer()
    // 2026-10-01：扫码登录的令牌放 sessionStorage（关掉浏览器就退出，刷新还在）
    sessionStorage.setItem('0x4.webQrSession', JSON.stringify({ account: ACC, token: 'WEBTOKEN', v: 1 }))
    expect(await useSocial.getState().loginWithQr()).toBe(true)
    await vi.waitFor(() => expect(readQrSession()?.token).toBe('WEBTOKEN2'))
    useSocial.getState().logout()
    srv.revoke()
    expect(await useSocial.getState().loginWithQr()).toBe(false)
    expect(useSocial.getState().status).toBe('idle')
    expect(readQrSession()).toBeNull()
  })

  it('会议、直播的操作放行；交易类照旧要钱包', async () => {
    fakeServer()
    expect(needLogin()).toBe(true)                       // 没登录：弹连接面板
    expect(useWalletGate.getState().open).toBe(true)
    useWalletGate.setState({ open: false })
    await useSocial.getState().loginWithQr('WEBTOKEN')
    expect(needLogin()).toBe(false)                      // 扫码登录了：开会、开播直接做
    expect(needWallet()).toBe(true)                      // 交易、送礼：还是要连钱包
  })

  it('令牌只存在这个标签页（sessionStorage），不进 localStorage：关掉浏览器就退出', async () => {
    fakeServer()
    await useSocial.getState().loginWithQr('WEBTOKEN')
    expect(JSON.parse(sessionStorage.getItem('0x4.webQrSession') || 'null')?.token).toBe('WEBTOKEN')
    expect(localStorage.getItem('0x4.webQrSession')).toBeNull()
  })

  it('退出登录删掉本机令牌', async () => {
    fakeServer()
    await useSocial.getState().loginWithQr('WEBTOKEN')
    useSocial.getState().logout(true)
    expect(useSocial.getState().qrMode).toBe(false)
    expect(readQrSession()).toBeNull()
    expect(getToken()).toBeNull()
  })

  it('二维码失效（404）当成过期；被拒不给令牌', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0]
      if (path === '/api/meet/login/start') return new Response(JSON.stringify({ loginId: 'X'.repeat(22), pollKey: 'PK', qr: `ox4meet:${'X'.repeat(22)}:${'C'.repeat(22)}`, expiresAt: 0, ttl: 0 }))
      return new Response(JSON.stringify({ status: 'denied' }))
    }))
    expect(await (await beginQrLogin(() => {})).done).toEqual({ status: 'denied' })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0]
      if (path === '/api/meet/login/start') return new Response(JSON.stringify({ loginId: 'X'.repeat(22), pollKey: 'PK', qr: 'ox4meet:x:y', expiresAt: 0, ttl: 0 }))
      return new Response(JSON.stringify({ error: '二维码已失效' }), { status: 404 })
    }))
    expect(await (await beginQrLogin(() => {})).done).toEqual({ status: 'expired' })
  })
})
