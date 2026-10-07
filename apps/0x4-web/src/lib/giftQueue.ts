// 送礼队列（网页版 src/lib/energy.ts 和电脑端会议 meet/ 共用；不依赖界面、接口封装和翻译，只依赖 giftTip.ts）。
// 每个「房间 × 收礼人 × 设备」一条：一张一张签、一张一张交，上一张确认了下一张的累计 = 已确认 + 价格；
// 服务器说累计对不上就按它给的已确认重签，通道 / 比例 / 截止时间变了就重新准备；某一下被拒，后面排着的全部取消（不连环弹窗）。
import type { Hex } from 'viem'
import { ENERGY, tipTypedData, type GiftDomain, type GiftTip } from './giftTip'

/** 服务器 /api/energy/prepare 的返回 */
export interface GiftPrep {
  room: string; streamer: Hex; streamerAccount: string; channel: Hex; base: string; platformId: string; feeBps: number; deadline: string; user: Hex
  available: string; domain: GiftDomain; primaryType: 'Tip'
}
export type GiftSendResult = { ok: true; available: string; cumulative: string } | { ok: false; reason: string; error: string; base?: string }
export interface GiftQueueDeps {
  prepare(): Promise<GiftPrep>
  /** 签小票：0x4 Wallet 走 signGiftTip（开了打赏授权就不弹窗），其他钱包走 eth_signTypedData_v4（每次弹窗） */
  sign(typedData: ReturnType<typeof tipTypedData>): Promise<Hex>
  send(body: { gift: string; tip: Record<string, string | number>; sig: Hex }): Promise<GiftSendResult>
}
/** 这几种被拒：重新准备（拿新的已确认累计 / 通道 / 比例 / 截止时间）后重签一次 */
const RETRY = new Set(['stale', 'bad_channel', 'bad_fee', 'expiring', 'bad_deadline'])
export type TapResult = { ok: true; available: string } | { ok: false; reason: string; error: string }

/**
 * 一个房间、一个收礼人、一台设备的送礼队列。tap() 立刻返回一个 Promise（成功 = 服务器确认了），
 * 队列一张一张签、一张一张交：上一张确认了，下一张的累计 = 已确认 + 价格。
 * 某一张被拒（能量不足等）：后面还没签的全部取消（不会接着一张张弹「能量不足」）。
 */
export class GiftQueue {
  private prep: GiftPrep | null = null
  private confirmed = 0n
  private queue: { gift: { id: string; price: number }; resolve: (r: TapResult) => void }[] = []
  private running = false
  /** 还在队列里（没确认）的能量，面板用来提前置灰 */
  queuedEnergy = 0
  constructor(private deps: GiftQueueDeps, private onChange?: () => void) {}

  tap(gift: { id: string; price: number }): Promise<TapResult> {
    return new Promise((resolve) => {
      this.queue.push({ gift, resolve })
      this.queuedEnergy += gift.price
      this.onChange?.()
      void this.pump()
    })
  }
  /** 取消还没签的（离开房间、换收礼人） */
  cancel(): void {
    const rest = this.queue.splice(0)
    for (const x of rest) { this.queuedEnergy -= x.gift.price; x.resolve({ ok: false, reason: 'cancelled', error: '' }) }
    this.onChange?.()
  }

  private async ready(force: boolean): Promise<GiftPrep> {
    if (!this.prep || force) {
      this.prep = await this.deps.prepare()
      this.confirmed = BigInt(this.prep.base)
    }
    return this.prep
  }

  private async one(gift: { id: string; price: number }): Promise<TapResult> {
    let refresh = false
    for (let attempt = 0; attempt < 2; attempt++) {
      const prep = await this.ready(refresh)
      const tip: GiftTip = {
        user: prep.user, platformId: BigInt(prep.platformId), streamer: prep.streamer, channel: prep.channel,
        cumulative: this.confirmed + BigInt(gift.price) * ENERGY, feeBps: prep.feeBps, deadline: BigInt(prep.deadline),
      }
      const typed = tipTypedData(prep.domain, tip)
      const sig = await this.deps.sign(typed)
      const r = await this.deps.send({ gift: gift.id, tip: typed.message, sig })
      if (r.ok) { this.confirmed = tip.cumulative; return { ok: true, available: r.available } }
      // ★防重复扣（2026-10-01 走查发现）：这一张其实已经被服务器收了（比如走实时连接送出、回执没等到，又从备用路重发了一次），
      // 服务器回「累计对不上」且它认的已确认累计 ≥ 这张的累计 → 这一下已经送成了，算成功，绝不能按新的已确认再签一张多扣一次。
      // 这条通道只有这一个队列在写（通道 = 房间 × 设备 × 收礼人 × 比例），已确认累计只会被这个队列推高
      if (r.reason === 'stale' && r.base !== undefined && BigInt(r.base) >= tip.cumulative) { this.confirmed = BigInt(r.base); return { ok: true, available: '' } }
      // 累计对不上：服务器给了它认的已确认累计，直接按它重签；通道 / 比例 / 截止时间的问题要重新准备
      if (r.reason === 'stale' && r.base !== undefined) this.confirmed = BigInt(r.base)
      else refresh = true
      if (!RETRY.has(r.reason) || attempt === 1) return { ok: false, reason: r.reason, error: r.error }
    }
    return { ok: false, reason: 'error', error: '' }
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length) {
        const x = this.queue.shift()!
        let r: TapResult
        try { r = await this.one(x.gift) } catch (e) {
          // 签名被用户拒绝 / 钱包锁着 / 网络：这一下算没送，后面的也取消（用户拒绝了就不要接着弹）
          r = { ok: false, reason: 'sign', error: e instanceof Error ? e.message : String(e) }
          this.prep = null
        }
        this.queuedEnergy -= x.gift.price
        x.resolve(r)
        if (!r.ok) this.cancel()
        this.onChange?.()
      }
    } finally { this.running = false }
  }
}

