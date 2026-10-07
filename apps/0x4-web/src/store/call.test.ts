// 通话状态机：呼出 / 来电 / 接听 / 拒接 / 取消 / 占线 / 未接 / 对方挂断 / 多设备，以及 ended 自动回 idle。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls: { path: string; body?: unknown }[] = []
let reply: (path: string) => unknown = () => ({})
vi.mock('@/lib/social', () => ({
  api: vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const r = reply(path)
    if (r instanceof Error) throw r
    return r
  }),
}))

const { useCall, ENDED_HOLD_MS } = await import('./call')
const bob = { address: 'Bob111', nickname: 'Bob', avatar: null }
const st = () => useCall.getState()

beforeEach(() => { calls.length = 0; reply = () => ({}); useCall.getState().reset() })
afterEach(() => { vi.useRealTimers() })

describe('呼出', () => {
  it('发起 → 等待 → 对方接听 → 连上 → 挂断', async () => {
    reply = (p) => p === '/api/calls' ? { status: 'ringing', callId: 'c1', online: true, token: 'tok', url: 'wss://lk' } : {}
    const p = st().startCall(bob, true)
    expect(st().phase).toBe('outgoing')
    await p
    expect(calls[0]).toEqual({ path: '/api/calls', body: { to: 'Bob111', video: true } })
    expect(st()).toMatchObject({ phase: 'outgoing', callId: 'c1', token: 'tok', video: true, outgoingCall: true, peerOnline: true })
    // 别的通话的事件不理
    st().onEvent({ type: 'call_accepted', callId: 'other' })
    expect(st().phase).toBe('outgoing')
    st().onEvent({ type: 'call_accepted', callId: 'c1' })
    expect(st().phase).toBe('connecting')
    st().connected()
    expect(st().phase).toBe('active')
    expect(st().startedAt).toBeTypeOf('number')
    await st().hangup()
    expect(st().phase).toBe('ended')
    expect(calls.at(-1)?.path).toBe('/api/calls/c1/end')
  })

  it('对方不在线：仍在呼叫，标记离线', async () => {
    reply = () => ({ status: 'ringing', callId: 'c2', online: false, token: 't', url: 'u' })
    await st().startCall(bob, false)
    expect(st()).toMatchObject({ phase: 'outgoing', peerOnline: false })
  })

  it('占线 → ended「对方正在通话中」，然后自动回 idle', async () => {
    vi.useFakeTimers()
    reply = () => ({ status: 'busy', peer: bob })
    await st().startCall(bob, false)
    expect(st()).toMatchObject({ phase: 'ended', reason: '对方正在通话中' })
    vi.advanceTimersByTime(ENDED_HOLD_MS + 10)
    expect(st().phase).toBe('idle')
  })

  it('非好友：服务器拒绝，显示服务器的话', async () => {
    reply = () => new Error('互相关注成为好友后才能通话')
    await st().startCall(bob, false)
    expect(st()).toMatchObject({ phase: 'ended', reason: '互相关注成为好友后才能通话' })
  })

  it('等待中取消：通知服务器 cancel', async () => {
    reply = () => ({ status: 'ringing', callId: 'c3', online: true, token: 't', url: 'u' })
    await st().startCall(bob, false)
    await st().hangup()
    expect(st()).toMatchObject({ phase: 'ended', reason: '已取消' })
    expect(calls.at(-1)?.path).toBe('/api/calls/c3/cancel')
  })

  it('请求还没回来就取消：回来后补发 cancel', async () => {
    let resolve!: (v: unknown) => void
    reply = (p) => p === '/api/calls' ? new Promise((r) => { resolve = r }) : {}
    const p = st().startCall(bob, false)
    await st().hangup()
    resolve({ status: 'ringing', callId: 'c4', online: true, token: 't', url: 'u' })
    await p
    expect(st().phase).toBe('ended')
    expect(calls.some((c) => c.path === '/api/calls/c4/cancel')).toBe(true)
  })

  it('对方拒绝 / 无人接听', async () => {
    reply = () => ({ status: 'ringing', callId: 'c5', online: true, token: 't', url: 'u' })
    await st().startCall(bob, false)
    st().onEvent({ type: 'call_declined', callId: 'c5' })
    expect(st().reason).toBe('对方已拒绝')
    st().reset()
    await st().startCall(bob, false)
    st().onEvent({ type: 'call_missed', callId: 'c5' })
    expect(st().reason).toBe('对方无人接听')
  })

  it('通话中不能再发起', async () => {
    reply = () => ({ status: 'ringing', callId: 'c6', online: true, token: 't', url: 'u' })
    await st().startCall(bob, false)
    await st().startCall({ address: 'Carol' }, false)
    expect(calls.filter((c) => c.path === '/api/calls')).toHaveLength(1)
    expect(st().peer?.address).toBe('Bob111')
  })
})

describe('来电', () => {
  const invite = { type: 'call_invite', callId: 'in1', from: 'Alice', video: true, nickname: 'Alice', avatar: null }

  it('响铃 → 接听 → 拿到令牌 → 连上 → 对方挂断', async () => {
    st().onEvent(invite)
    expect(st()).toMatchObject({ phase: 'incoming', callId: 'in1', video: true, outgoingCall: false, peer: { address: 'Alice', nickname: 'Alice' } })
    reply = () => ({ token: 'tk', url: 'wss://lk' })
    const p = st().accept()
    expect(st().phase).toBe('connecting')
    await p
    expect(calls.at(-1)?.path).toBe('/api/calls/in1/accept')
    expect(st()).toMatchObject({ token: 'tk', url: 'wss://lk' })
    // 自己接听后服务端广播的 call_accepted 不影响本机
    st().onEvent({ type: 'call_accepted', callId: 'in1' })
    expect(st().phase).toBe('connecting')
    st().connected()
    st().onEvent({ type: 'call_ended', callId: 'in1', by: 'Alice' })
    expect(st()).toMatchObject({ phase: 'ended', reason: '对方已挂断' })
  })

  it('拒接', async () => {
    st().onEvent(invite)
    await st().decline()
    expect(st()).toMatchObject({ phase: 'ended', reason: '已拒绝' })
    expect(calls.at(-1)?.path).toBe('/api/calls/in1/decline')
  })

  it('对方取消 / 超时未接', () => {
    st().onEvent(invite)
    st().onEvent({ type: 'call_cancelled', callId: 'in1' })
    expect(st().reason).toBe('对方已取消')
    st().reset()
    st().onEvent(invite)
    st().onEvent({ type: 'call_missed', callId: 'in1' })
    expect(st().reason).toBe('未接来电')
  })

  it('同账号另一台设备接了：本机停止响铃', () => {
    st().onEvent(invite)
    st().onEvent({ type: 'call_accepted', callId: 'in1' })
    expect(st()).toMatchObject({ phase: 'ended', reason: '已在其他设备接听' })
  })

  it('接听失败（已超时）→ ended', async () => {
    st().onEvent(invite)
    reply = () => new Error('通话已结束')
    await st().accept()
    expect(st()).toMatchObject({ phase: 'ended', reason: '通话已结束' })
  })

  it('通话中又来一个邀请：忽略', async () => {
    st().onEvent(invite)
    st().onEvent({ ...invite, callId: 'in2', from: 'Carol' })
    expect(st().callId).toBe('in1')
  })

  it('对方断线', async () => {
    st().onEvent(invite)
    reply = () => ({ token: 'tk', url: 'u' })
    await st().accept()
    st().connected()
    st().onEvent({ type: 'call_ended', callId: 'in1', by: 'Alice', reason: 'lost' })
    expect(st().reason).toBe('对方网络已断开')
  })

  it('打开 App 补拿来电', async () => {
    reply = () => ({ call: { callId: 'in9', from: 'Dave', video: false, nickname: null, avatar: null } })
    await st().syncIncoming()
    expect(st()).toMatchObject({ phase: 'incoming', callId: 'in9', video: false })
  })

  it('本机出错：fail 通知服务器并结束', async () => {
    st().onEvent(invite)
    reply = () => ({ token: 'tk', url: 'u' })
    await st().accept()
    st().fail('暂时无法连接通话')
    expect(st()).toMatchObject({ phase: 'ended', reason: '暂时无法连接通话' })
    expect(calls.at(-1)?.path).toBe('/api/calls/in1/end')
  })
})
