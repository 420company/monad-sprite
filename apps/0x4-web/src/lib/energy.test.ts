// @vitest-environment jsdom
// Gift queue: rapid taps sign one by one, cumulative always = confirmed + price; when the server says the cumulative doesn't match, re-sign with what it gives;
// a rejected one (insufficient energy) fails, everything queued behind it is cancelled with no more signing; user-rejected signatures cancel the rest too.
import { describe, expect, it, vi } from 'vitest'
import type { Hex } from 'viem'
import { canSend, GiftQueue, onEnergyMessage, useEnergy, type GiftPrep, type GiftSendResult } from './energy'
import { ENERGY } from './giftTip'

const prep = (base = '0'): GiftPrep => ({
  room: 'live:r1', streamer: '0x3333333333333333333333333333333333333333', streamerAccount: 'host', channel: ('0x' + 'ab'.repeat(32)) as Hex,
  base, platformId: '1', feeBps: 3000, deadline: String(2_000_000_000), user: '0x1111111111111111111111111111111111111111', available: '100',
  domain: { name: '0x4 Gift Energy', version: '1', chainId: 56, verifyingContract: '0x2222222222222222222222222222222222222222' }, primaryType: 'Tip',
})

/** Fake server: accepts per "cumulative = confirmed + price", returns insufficient when the balance is short, simulates network latency */
function fakeServer(balance: number, startAccepted = 0n) {
  let accepted = startAccepted
  let avail = BigInt(balance) * ENERGY
  const prices: Record<string, number> = { heart: 1, hachimi: 5, rose: 30 }
  const log: string[] = []
  const send = vi.fn(async (b: { gift: string; tip: Record<string, string | number> }): Promise<GiftSendResult> => {
    await new Promise((r) => setTimeout(r, 1))
    const price = BigInt(prices[b.gift]) * ENERGY
    const cum = BigInt(String(b.tip.cumulative))
    if (cum !== accepted + price) { log.push(`stale ${cum}`); return { ok: false, reason: 'stale', error: '请重试', base: accepted.toString() } }
    if (avail < price) { log.push('insufficient'); return { ok: false, reason: 'insufficient', error: '能量不足' } }
    accepted = cum; avail -= price
    log.push(`ok ${cum / ENERGY}`)
    return { ok: true, available: (avail / ENERGY).toString(), cumulative: cum.toString() }
  })
  return { send, log, get accepted() { return accepted } }
}

describe('送礼队列', () => {
  it('连点 10 个哈基米：一张一张确认，累计 5、10 … 50', async () => {
    const srv = fakeServer(100)
    const sign = vi.fn(async () => '0xsig' as Hex)
    const q = new GiftQueue({ prepare: async () => prep(), sign, send: srv.send })
    const rs = await Promise.all(Array.from({ length: 10 }, () => q.tap({ id: 'hachimi', price: 5 })))
    expect(rs.every((r) => r.ok)).toBe(true)
    expect(srv.log).toEqual([5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map((n) => `ok ${n}`))
    expect(sign).toHaveBeenCalledTimes(10)
    expect(q.queuedEnergy).toBe(0)
  })
  it('能量只够 3 个：第 4 个被拒，后面的取消、不再签名、不再发', async () => {
    const srv = fakeServer(15)
    const sign = vi.fn(async () => '0xsig' as Hex)
    const q = new GiftQueue({ prepare: async () => prep(), sign, send: srv.send })
    const rs = await Promise.all(Array.from({ length: 8 }, () => q.tap({ id: 'hachimi', price: 5 })))
    expect(rs.map((r) => r.ok)).toEqual([true, true, true, false, false, false, false, false])
    expect((rs[3] as { reason: string }).reason).toBe('insufficient')
    expect(rs.slice(4).every((r) => !r.ok && r.reason === 'cancelled')).toBe(true)
    expect(sign).toHaveBeenCalledTimes(4)
    expect(srv.send).toHaveBeenCalledTimes(4)
    // Tap again after top-up: continue up from the confirmed 15
    expect(q.queuedEnergy).toBe(0)
  })
  it('通道换了（比如分成比例更新）：重新准备后重签一次', async () => {
    const srv = fakeServer(100)
    let n = 0
    const send = vi.fn(async (b: { gift: string; tip: Record<string, string | number> }): Promise<GiftSendResult> => (++n === 1 ? { ok: false, reason: 'bad_channel', error: '请重试' } : srv.send(b)))
    const prepare = vi.fn(async () => prep())
    const q = new GiftQueue({ prepare, sign: async () => '0xsig' as Hex, send })
    expect((await q.tap({ id: 'hachimi', price: 5 })).ok).toBe(true)
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(srv.log).toEqual(['ok 5'])
  })
  it('★回执丢了又重发同一张（服务器已经收过）：算成功，不再按新累计多签一张、多扣一次', async () => {
    const srv = fakeServer(100)
    let first = true
    // First time: server received but the receipt never came back (simulates a lost realtime receipt, then resending the same one via the fallback path after timeout)
    const send = vi.fn(async (b: { gift: string; tip: Record<string, string | number> }) => {
      const r = await srv.send(b)
      if (first) { first = false; return srv.send(b) }   // Resend the same one: server replies "cumulative mismatch", base = the cumulative it already has
      return r
    })
    const sign = vi.fn(async () => '0xsig' as Hex)
    const q = new GiftQueue({ prepare: async () => prep(), sign, send })
    const r = await q.tap({ id: 'hachimi', price: 5 })
    expect(r.ok).toBe(true)
    expect(srv.log).toEqual(['ok 5', `stale ${5n * ENERGY}`])   // Deducted only once
    expect(sign).toHaveBeenCalledTimes(1)
    // The next one continues up from 5
    expect((await q.tap({ id: 'hachimi', price: 5 })).ok).toBe(true)
    expect(srv.log.at(-1)).toBe('ok 10')
  })
  it('用户在钱包里拒绝签名：这一下没送，排着的取消', async () => {
    const srv = fakeServer(100)
    let n = 0
    const sign = vi.fn(async () => { if (++n === 2) throw new Error('User rejected'); return '0xsig' as Hex })
    const q = new GiftQueue({ prepare: async () => prep(), sign, send: srv.send })
    const rs = await Promise.all([q.tap({ id: 'heart', price: 1 }), q.tap({ id: 'heart', price: 1 }), q.tap({ id: 'heart', price: 1 })])
    expect(rs.map((r) => (r.ok ? 'ok' : r.reason))).toEqual(['ok', 'sign', 'cancelled'])
    expect(srv.send).toHaveBeenCalledTimes(1)
  })
  it('排队中的能量算进「还能送几个」（面板提前置灰）', async () => {
    const srv = fakeServer(100)
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const q = new GiftQueue({ prepare: async () => prep(), sign: async () => { await gate; return '0xsig' as Hex }, send: srv.send })
    const all = [q.tap({ id: 'rose', price: 30 }), q.tap({ id: 'rose', price: 30 })]
    expect(q.queuedEnergy).toBe(60)
    expect(canSend(100 - q.queuedEnergy, 30)).toBe(1)
    release()
    await Promise.all(all)
    expect(q.queuedEnergy).toBe(0)
  })
})

describe('余额推送', () => {
  it('同一个钱包的推送更新余额（别的设备送了礼，这台马上变）；别的钱包的不理', () => {
    useEnergy.setState({ me: { enabled: true, wallet: '0xaa', available: '100', onchain: '100' } })
    onEnergyMessage({ type: 'energy_balance', wallet: '0xAA', available: '70', onchain: '100' }, '0xaa')
    expect(useEnergy.getState().me?.available).toBe('70')
    onEnergyMessage({ type: 'energy_balance', wallet: '0xbb', available: '1' }, '0xaa')
    expect(useEnergy.getState().me?.available).toBe('70')
    onEnergyMessage({ type: 'roommsg' }, '0xaa')
    expect(useEnergy.getState().me?.available).toBe('70')
  })
  it('还能送几个：向下取整', () => {
    expect(canSend(99, 5)).toBe(19)
    expect(canSend(4, 5)).toBe(0)
    expect(canSend(999, 999)).toBe(1)
  })
})
