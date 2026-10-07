// Gift queue (shared by web src/lib/energy.ts and desktop meetings in meet/; depends on neither UI, API wrappers, nor i18n — only giftTip.ts).
// One queue per "room × recipient × device": sign one ticket at a time, submit one at a time — after one is confirmed, the next ticket's cumulative = confirmed + price;
// when the server says the cumulative doesn't match, re-sign with its confirmed figure; re-prepare when the channel / ratio / deadline changes; when one tap is rejected, cancel everything queued behind it (no cascading dialogs).
import type { Hex } from 'viem'
import { ENERGY, tipTypedData, type GiftDomain, type GiftTip } from './giftTip'

/** Response of the server's /api/energy/prepare */
export interface GiftPrep {
  room: string; streamer: Hex; streamerAccount: string; channel: Hex; base: string; platformId: string; feeBps: number; deadline: string; user: Hex
  available: string; domain: GiftDomain; primaryType: 'Tip'
}
export type GiftSendResult = { ok: true; available: string; cumulative: string } | { ok: false; reason: string; error: string; base?: string }
export interface GiftQueueDeps {
  prepare(): Promise<GiftPrep>
  /** Sign a ticket: 0x4 Wallet uses signGiftTip (no popup once tipping authorization is granted); other wallets use eth_signTypedData_v4 (popup every time) */
  sign(typedData: ReturnType<typeof tipTypedData>): Promise<Hex>
  send(body: { gift: string; tip: Record<string, string | number>; sig: Hex }): Promise<GiftSendResult>
}
/** These rejection kinds: re-prepare (fresh confirmed cumulative / channel / ratio / deadline), then sign once more */
const RETRY = new Set(['stale', 'bad_channel', 'bad_fee', 'expiring', 'bad_deadline'])
export type TapResult = { ok: true; available: string } | { ok: false; reason: string; error: string }

/**
 * The gift queue for one room, one recipient, one device. tap() returns a Promise immediately (resolved = server confirmed);
 * tickets are signed and submitted one at a time: once one is confirmed, the next ticket's cumulative = confirmed + price.
 * When one ticket is rejected (insufficient energy, etc.): cancel all unsigned ones behind it (no repeated "insufficient energy" popups).
 */
export class GiftQueue {
  private prep: GiftPrep | null = null
  private confirmed = 0n
  private queue: { gift: { id: string; price: number }; resolve: (r: TapResult) => void }[] = []
  private running = false
  /** Energy still in the queue (unconfirmed) — the panel uses it to gray out early */
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
  /** Cancel the unsigned ones (leaving the room, switching recipient) */
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
      // ★ Double-charge guard (found in the 2026-10-01 review): this ticket was actually already received by the server (e.g. sent over the realtime connection, receipt never arrived, then resent via the fallback path),
      // and the server replies "cumulative mismatch" with a recognized confirmed cumulative ≥ this ticket's cumulative → this tap already succeeded: count it as success, and never sign another ticket against the new confirmed figure (that would charge twice).
      // This channel has exactly one writing queue (channel = room × device × recipient × ratio) — the confirmed cumulative can only be pushed up by this queue
      if (r.reason === 'stale' && r.base !== undefined && BigInt(r.base) >= tip.cumulative) { this.confirmed = BigInt(r.base); return { ok: true, available: '' } }
      // Cumulative mismatch: the server gave its recognized confirmed cumulative — re-sign against it directly; channel / ratio / deadline issues need a re-prepare
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
          // Signature rejected by user / wallet locked / network: this tap counts as unsent, and the ones behind are cancelled too (when the user rejects, don't keep popping)
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

