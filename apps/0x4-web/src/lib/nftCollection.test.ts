// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollectionLookup, type LookupState, type NftCollectionInfo } from './nftCollection'

const PUDGY = '0xBd3531dA5CF5857e7CfAA92426877b022e612cf8'
const OTHER = '0x1111111111111111111111111111111111111111'
const pudgy: NftCollectionInfo = { chainId: 1, name: 'Pudgy Penguins', standard: 'erc721', verified: true }

describe('NFT 系列识别的状态流转', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('输入 → 正在识别 → 500ms 后才发请求 → 识别到', async () => {
    const states: LookupState[] = []
    const fetcher = vi.fn(async () => pudgy)
    const l = createCollectionLookup(fetcher, (s) => states.push(s))
    l.request(`  ${PUDGY} `)
    expect(states).toEqual([{ status: 'loading' }])
    await vi.advanceTimersByTimeAsync(499)
    expect(fetcher).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetcher).toHaveBeenCalledWith(PUDGY, null)
    expect(states.at(-1)).toEqual({ status: 'found', result: pudgy })
  })

  it('连续输入只发最后一次；指定链会带上', async () => {
    const fetcher = vi.fn(async () => pudgy)
    const l = createCollectionLookup(fetcher, () => {})
    l.request('0xBd35')
    await vi.advanceTimersByTimeAsync(300)
    l.request(PUDGY, 8453)
    await vi.advanceTimersByTimeAsync(500)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(PUDGY, 8453)
  })

  it('没找到 → missing；地址格式不对不发请求直接 missing；清空回 idle', async () => {
    const states: LookupState[] = []
    const fetcher = vi.fn(async () => null)
    const l = createCollectionLookup(fetcher, (s) => states.push(s))
    l.request(OTHER)
    await vi.advanceTimersByTimeAsync(500)
    expect(states.at(-1)).toEqual({ status: 'missing' })
    l.request('hello')
    await vi.advanceTimersByTimeAsync(500)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(states.at(-1)).toEqual({ status: 'missing' })
    l.request('   ')
    expect(states.at(-1)).toEqual({ status: 'idle' })
  })

  it('接口出错 → error，带错误信息', async () => {
    const states: LookupState[] = []
    const l = createCollectionLookup(async () => { throw new Error('暂时查不到，稍后再试') }, (s) => states.push(s))
    l.request(PUDGY)
    await vi.advanceTimersByTimeAsync(500)
    expect(states.at(-1)).toEqual({ status: 'error', message: '暂时查不到，稍后再试' })
  })

  it('先发出去的慢请求回来晚了，不能盖掉后面的结果', async () => {
    const states: LookupState[] = []
    let releaseSlow!: (v: NftCollectionInfo) => void
    const fetcher = vi.fn((c: string) => c === PUDGY ? new Promise<NftCollectionInfo>((r) => { releaseSlow = r }) : Promise.resolve(null))
    const l = createCollectionLookup(fetcher, (s) => states.push(s))
    l.request(PUDGY)
    await vi.advanceTimersByTimeAsync(500) // The slow request is already sent
    l.request(OTHER)
    await vi.advanceTimersByTimeAsync(500)
    expect(states.at(-1)).toEqual({ status: 'missing' })
    releaseSlow(pudgy)
    await vi.advanceTimersByTimeAsync(0)
    expect(states.at(-1)).toEqual({ status: 'missing' })
  })

  it('cancel 之后回来的结果丢弃', async () => {
    const states: LookupState[] = []
    const l = createCollectionLookup(async () => pudgy, (s) => states.push(s))
    l.request(PUDGY)
    l.cancel()
    await vi.advanceTimersByTimeAsync(1000)
    expect(states).toEqual([{ status: 'loading' }])
  })
})
