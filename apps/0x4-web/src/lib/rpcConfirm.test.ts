// confirmSignature: don't rely on WebSocket for Solana tx confirmation (2026-10-04: the web build forwards via the server's /rpc with no WebSocket,
// and web3.js's confirmTransaction would wait until expiry to report "expired" even though the tx had actually succeeded)
import { describe, expect, it } from 'vitest'
import { confirmSignature } from './rpc'

type St = { err: unknown; confirmationStatus: string } | null
function fake(seq: (St | 'boom')[], heights: number[], history?: St) {
  let i = 0, j = 0
  return {
    calls: () => i,
    conn: {
      async getSignatureStatuses(_s: string[], o?: { searchTransactionHistory?: boolean }) {
        if (o?.searchTransactionHistory) return { context: { slot: 1 }, value: [history ?? null] }
        const v = seq[Math.min(i++, seq.length - 1)]
        if (v === 'boom') throw new Error('fetch failed')
        return { context: { slot: 1 }, value: [v] }
      },
      async getBlockHeight() { return heights[Math.min(j++, heights.length - 1)] },
    } as never,
  }
}
const ok = { err: null, confirmationStatus: 'confirmed' }

describe('confirmSignature', () => {
  it('查到确认就返回（不用等过期）', async () => {
    const f = fake([null, null, ok], [10])
    await expect(confirmSignature(f.conn, 's', 100, 1)).resolves.toBeUndefined()
    expect(f.calls()).toBe(3)
  })
  it('链上失败', async () => {
    await expect(confirmSignature(fake([{ err: { InstructionError: [0, 'x'] }, confirmationStatus: 'confirmed' }], [10]).conn, 's', 100, 1)).rejects.toThrow(/InstructionError/)
  })
  it('过了有效高度还查不到 = 没上链', async () => {
    await expect(confirmSignature(fake([null], [50, 101]).conn, 's', 100, 1)).rejects.toThrow()
  })
  it('过期那一刻刚好上链：按历史再查一次，算成功', async () => {
    await expect(confirmSignature(fake([null], [101], ok).conn, 's', 100, 1)).resolves.toBeUndefined()
  })
  it('节点偶尔出错照常重试', async () => {
    await expect(confirmSignature(fake(['boom', 'boom', ok], [10]).conn, 's', 100, 1)).resolves.toBeUndefined()
  })
  it('连续出错太多次才放弃', async () => {
    await expect(confirmSignature(fake(['boom'], [10]).conn, 's', 100, 1)).rejects.toThrow()
  })
})
