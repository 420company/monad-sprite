// Energy gifting (2026-09-30 goat, design in docs/GIFT_ENERGY_DESIGN.md): top-ups, balances, gift catalog and gifting queue on web / desktop.
// The mobile app (and the app.420.meme mobile web) never shows balances, prices, top-ups or gifting buttons (Apple rules) — it only plays others' gift animations: ENERGY_GIFTS is false.
// Gifting: each tap signs a ticket stating "this channel's cumulative gifted total" (EIP-712 Tip) and hands it to the server; the server queues per wallet, verifies the signature, deducts energy, and only broadcasts the animation on success.
// Never play locally first, and never play on rejection — the tapper just gets a hint. Tickets for one channel are handed in one at a time (the next is signed only after the previous is confirmed, so the cumulative total always lines up),
// and if the server says "cumulative mismatch / channel changed / rate updated", re-prepare and re-sign.
import type { Account, Hex } from 'viem'
import { create } from 'zustand'
import { api, SOCIAL_API } from '@/lib/social'
import { WEB_SURFACE } from '@/lib/surface'
import { isNative } from '@/lib/native'
import { ensureAllowance, getEvmTokenBalance, sendEvmTx } from '@/lib/evm'
import { ENERGY, tipTypedData } from '@/lib/giftTip'
import { depositCalls } from '@/lib/energyDepositCore'
import type { GiftPrep, GiftSendResult } from './giftQueue'
import { t } from '@/lib/i18n'
import { getOx4, type Ox4GiftSession } from '@/lib/vault/extension'
import { externalOf, walletRequest } from '@/lib/vault/external'

/** Gifting, top-ups, energy balances and gift prices only appear on web (always false on the mobile app / mobile web) */
export const ENERGY_GIFTS = WEB_SURFACE && !isNative

export interface EnergyGift { id: string; nameZh: string; nameEn: string; icon: string | null; anim: string | null; fx: string | null; sound: string | null; price: number; sort: number; active: boolean }
export interface EnergyMe {
  enabled: boolean; open?: boolean; closedReason?: string | null; wallet?: string | null
  available?: string; onchain?: string; pending?: string
  contract?: Hex; chainId?: number; usdt?: Hex; feeBps?: number | null; depositsOpen?: boolean
}
export interface EnergyEarnings { enabled: boolean; wallet?: string | null; today: string; pending: string; todayGifts?: number; nextSettleAt?: number | null; chainId?: number; recent: { from: string; nickname?: string | null; avatar?: string | null; gift: string; price: number; feeBps: number; room: string; at: number }[] }
export interface EnergyHistory { enabled: boolean; chainId?: number; items: { tx: string; block: number; at: number; amount: string; tips: number }[] }

/** /files/xxx → a directly loadable URL */
export const energyFile = (u: string | null | undefined) => (!u ? null : /^(https?:|data:|blob:)/.test(u) ? u : SOCIAL_API + u)
/** Energy amount (decimal string from the server, whole energy units) → number */
export const energyNum = (s: string | null | undefined) => { const n = Number(s || 0); return Number.isFinite(n) ? n : 0 }
/** How many of a gift the balance still covers (rounded down) */
export const canSend = (available: number, price: number) => (price > 0 ? Math.max(0, Math.floor(available / price)) : 0)

// ---------- Gift catalog (public, shared for 60 seconds) ----------
let catalog: { at: number; gifts: EnergyGift[]; enabled: boolean } | null = null
let catalogReq: Promise<{ gifts: EnergyGift[]; enabled: boolean }> | null = null
export async function energyGifts(force = false): Promise<{ gifts: EnergyGift[]; enabled: boolean }> {
  if (!force && catalog && Date.now() - catalog.at < 60_000) return catalog
  if (!catalogReq) {
    catalogReq = api<{ enabled: boolean; gifts: EnergyGift[] }>('/api/energy/gifts', {}, { anonymous: true })
      .then((r) => { catalog = { at: Date.now(), gifts: r.gifts || [], enabled: !!r.enabled }; return catalog })
      .finally(() => { catalogReq = null })
  }
  return catalogReq
}
/** One gift from the catalog (for floating-screen / animation use; returns null when not in the catalog) */
export const giftById = (id: string) => catalog?.gifts.find((g) => g.id === id) ?? null

// ---------- My energy (updated by realtime push) ----------
interface EnergyState {
  me: EnergyMe | null
  loading: boolean
  refresh(): Promise<EnergyMe | null>
  /** Server pushes energy_balance / the new balance after a successful gift */
  setAvailable(available: string, onchain?: string): void
}
export const useEnergy = create<EnergyState>()((set, get) => ({
  me: null,
  loading: false,
  async refresh() {
    set({ loading: true })
    try { const me = await api<EnergyMe>('/api/energy/me'); set({ me }); return me } catch { return get().me } finally { set({ loading: false }) }
  },
  setAvailable(available, onchain) {
    const me = get().me
    if (!me) return
    set({ me: { ...me, available, ...(onchain !== undefined ? { onchain } : {}) } })
  },
}))

/** Pick energy-related messages out of server pushes (called in the realtime connection's message callback): all devices follow balance changes */
export function onEnergyMessage(d: Record<string, unknown>, myWallet: string | null | undefined): void {
  if (d.type !== 'energy_balance') return
  if (myWallet && typeof d.wallet === 'string' && d.wallet.toLowerCase() !== myWallet.toLowerCase()) return
  useEnergy.getState().setAvailable(String(d.available ?? '0'), typeof d.onchain === 'string' ? d.onchain : undefined)
}

// ---------- Top-ups ----------
/** Top-up: whole USDT only (the contract also rejects decimals). Approve first (only if allowance is insufficient), then call deposit. Returns the transaction hash */
export async function depositEnergy(account: Account, me: EnergyMe, amount: number, onApproving?: () => void): Promise<Hex> {
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error(t('只能充值整数 USDT'))
  if (!me.contract || !me.usdt || !me.chainId) throw new Error(t('送礼暂未开放'))
  if (!me.depositsOpen) throw new Error(t('充值暂停中'))
  // The two transactions share their content with desktop meetings (lib/energyDepositCore.ts): approval covers only this top-up's amount
  const c = depositCalls(me, amount)
  const bal = await getEvmTokenBalance(me.chainId, account.address, me.usdt)
  if (bal < c.units) throw new Error(t('BNB Chain 上的 USDT 不够'))
  await ensureAllowance(account, me.chainId, me.usdt, me.contract, c.units, onApproving)
  return sendEvmTx(account, me.chainId, c.deposit)
}
/** BNB Chain USDT in the wallet (the top-up page shows it as "available") */
export async function usdtOf(me: EnergyMe, address: string): Promise<number> {
  if (!me.usdt || !me.chainId) return 0
  try { return Number((await getEvmTokenBalance(me.chainId, address, me.usdt)) / (ENERGY / 100n)) / 100 } catch { return 0 }
}

// ---------- Gifting queue ----------

export type { GiftPrep, GiftSendResult, GiftQueueDeps } from './giftQueue'
export { GiftQueue, type TapResult } from './giftQueue'

// ---------- Signing tickets ----------

/** Whether the current wallet is the 0x4 Wallet extension (supports tipping authorization, skipping per-gift confirmations). External wallets confirm every tap in the wallet */
export const giftWalletKind = (account: Account | null | undefined): 'ox4' | 'external' | 'none' => (!account ? 'none' : externalOf(account) ? 'external' : 'ox4')

/**
 * Sign one gifting ticket:
 *   External wallets: eth_signTypedData_v4 (wallet pops a confirmation every time);
 *   0x4 Wallet: signGiftTip (no popup once tipping authorization is on); if the extension is too old to have this method, fall back to the generic EIP-712 signature (confirm each time).
 */
export async function signGiftTip(account: Account, typed: ReturnType<typeof tipTypedData>): Promise<Hex> {
  const ext = externalOf(account)
  if (ext) {
    const full = { ...typed, types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }], ...typed.types } }
    return walletRequest<Hex>(ext.provider, 'eth_signTypedData_v4', [account.address, JSON.stringify(full)])
  }
  const ox = getOx4()
  if (ox?.signGiftTip) return (await ox.signGiftTip({ typedData: JSON.stringify(typed) })).signature as Hex
  if (!account.signTypedData) throw new Error(t('当前钱包不支持送礼'))
  return account.signTypedData(typed as unknown as Parameters<NonNullable<Account['signTypedData']>>[0])
}

/** Tipping authorization status (not 0x4 Wallet / extension too old = disabled) */
export async function giftSessionStatus(): Promise<Ox4GiftSession> {
  const ox = getOx4()
  if (!ox?.giftSessionStatus) return { active: false }
  try { return await ox.giftSessionStatus() } catch { return { active: false } }
}
/** Enable tipping authorization: the extension pops one window (stating the per-gift max = the priciest gift in the catalog, choice of 7 days / 24 hours) */
export async function startGiftSession(me: EnergyMe, maxTip: number): Promise<Ox4GiftSession> {
  const ox = getOx4()
  if (!ox?.giftSessionStart) throw new Error(t('请更新 0x4 Wallet 到最新版'))
  if (!me.contract || !me.chainId) throw new Error(t('送礼暂未开放'))
  return ox.giftSessionStart({ chainId: me.chainId, contract: me.contract, maxTip: Math.max(1, Math.ceil(maxTip)) })
}
export async function endGiftSession(): Promise<void> { await getOx4()?.giftSessionEnd?.().catch(() => {}) }

/** Server /api/energy/prepare */
export const prepareGift = (room: string, device: string, to?: string | null) =>
  api<GiftPrep>('/api/energy/prepare', { method: 'POST', body: JSON.stringify({ room, device, ...(to ? { to } : {}) }) })
/** Server /api/energy/send (fallback when the realtime connection is unavailable) */
export const sendGiftHttp = (body: Record<string, unknown>) => api<GiftSendResult>('/api/energy/send', { method: 'POST', body: JSON.stringify(body) })
export const energyEarnings = () => api<EnergyEarnings>('/api/energy/earnings')
export const energyHistory = () => api<EnergyHistory>('/api/energy/earnings/history')

/**
 * This page's device identity (channel = room × device × recipient × rate). Freshly generated on every page open, never stored locally:
 * guarantees only this page's single queue writes to a channel (duplicated tabs don't share), so the gifting queue can safely treat "server confirmed ≥ this ticket" as this ticket being sent (prevents double deduction)
 */
const PAGE_DEVICE = 'web' + Array.from(globalThis.crypto?.getRandomValues?.(new Uint8Array(12)) ?? Array.from({ length: 12 }, () => Math.floor(Math.random() * 256)), (b) => b.toString(16).padStart(2, '0')).join('')
export function giftDevice(): string { return PAGE_DEVICE }
