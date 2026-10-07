// 能量打赏（2026-09-30 goat，设计见 docs/GIFT_ENERGY_DESIGN.md）：网页版 / 电脑端的充值、余额、礼物目录、送礼队列。
// 手机 App（和 app.420.meme 手机网页版）不出现余额、价格、充值、送礼按钮（苹果规则），只播别人送的礼物动画：ENERGY_GIFTS 为 false。
// 送礼：每点一下签一张「这个通道累计送了多少」的小票（EIP-712 Tip）交给服务器；服务器按钱包排队、验签、扣能量，成功才广播动画。
// 本机不先播、被拒也不播，只给点的人一句提示。同一个通道的小票一张一张交（上一张确认了才签下一张，累计永远对得上），
// 服务器说「累计对不上 / 通道换了 / 比例更新了」就重新准备、重签一次。
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

/** 送礼、充值、能量余额、礼物价格只在网页版出现（手机 App / 手机网页版恒为 false） */
export const ENERGY_GIFTS = WEB_SURFACE && !isNative

export interface EnergyGift { id: string; nameZh: string; nameEn: string; icon: string | null; anim: string | null; fx: string | null; sound: string | null; price: number; sort: number; active: boolean }
export interface EnergyMe {
  enabled: boolean; open?: boolean; closedReason?: string | null; wallet?: string | null
  available?: string; onchain?: string; pending?: string
  contract?: Hex; chainId?: number; usdt?: Hex; feeBps?: number | null; depositsOpen?: boolean
}
export interface EnergyEarnings { enabled: boolean; wallet?: string | null; today: string; pending: string; todayGifts?: number; nextSettleAt?: number | null; chainId?: number; recent: { from: string; nickname?: string | null; avatar?: string | null; gift: string; price: number; feeBps: number; room: string; at: number }[] }
export interface EnergyHistory { enabled: boolean; chainId?: number; items: { tx: string; block: number; at: number; amount: string; tips: number }[] }

/** /files/xxx → 能直接加载的地址 */
export const energyFile = (u: string | null | undefined) => (!u ? null : /^(https?:|data:|blob:)/.test(u) ? u : SOCIAL_API + u)
/** 能量数（服务器给的十进制字符串，整数能量）→ 数字 */
export const energyNum = (s: string | null | undefined) => { const n = Number(s || 0); return Number.isFinite(n) ? n : 0 }
/** 余额里某个礼物还能送几个（向下取整） */
export const canSend = (available: number, price: number) => (price > 0 ? Math.max(0, Math.floor(available / price)) : 0)

// ---------- 礼物目录（公开，60 秒内共用一份） ----------
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
/** 目录里的一个礼物（飘屏 / 动画用；没在目录里返回 null） */
export const giftById = (id: string) => catalog?.gifts.find((g) => g.id === id) ?? null

// ---------- 我的能量（实时推送更新） ----------
interface EnergyState {
  me: EnergyMe | null
  loading: boolean
  refresh(): Promise<EnergyMe | null>
  /** 服务器推送 energy_balance / 送礼成功回来的新余额 */
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

/** 服务器推的消息里挑能量相关的（在实时连接的消息回调里调用）：余额变了所有设备跟着变 */
export function onEnergyMessage(d: Record<string, unknown>, myWallet: string | null | undefined): void {
  if (d.type !== 'energy_balance') return
  if (myWallet && typeof d.wallet === 'string' && d.wallet.toLowerCase() !== myWallet.toLowerCase()) return
  useEnergy.getState().setAvailable(String(d.available ?? '0'), typeof d.onchain === 'string' ? d.onchain : undefined)
}

// ---------- 充值 ----------
/** 充值：只收整数 USDT（合约也会拒小数）。先授权（不够才授），再调 deposit。返回交易哈希 */
export async function depositEnergy(account: Account, me: EnergyMe, amount: number, onApproving?: () => void): Promise<Hex> {
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error(t('只能充值整数 USDT'))
  if (!me.contract || !me.usdt || !me.chainId) throw new Error(t('送礼暂未开放'))
  if (!me.depositsOpen) throw new Error(t('充值暂停中'))
  // 两笔交易的内容和电脑端会议同一份（lib/energyDepositCore.ts）：授权只授这次的数量
  const c = depositCalls(me, amount)
  const bal = await getEvmTokenBalance(me.chainId, account.address, me.usdt)
  if (bal < c.units) throw new Error(t('BNB Chain 上的 USDT 不够'))
  await ensureAllowance(account, me.chainId, me.usdt, me.contract, c.units, onApproving)
  return sendEvmTx(account, me.chainId, c.deposit)
}
/** 钱包里 BNB Chain 的 USDT（充值页显示「可充」） */
export async function usdtOf(me: EnergyMe, address: string): Promise<number> {
  if (!me.usdt || !me.chainId) return 0
  try { return Number((await getEvmTokenBalance(me.chainId, address, me.usdt)) / (ENERGY / 100n)) / 100 } catch { return 0 }
}

// ---------- 送礼队列 ----------

export type { GiftPrep, GiftSendResult, GiftQueueDeps } from './giftQueue'
export { GiftQueue, type TapResult } from './giftQueue'

// ---------- 签小票 ----------

/** 现在的钱包是不是 0x4 Wallet 插件（能开打赏授权、免逐次确认）。外部钱包每一下都要在钱包里确认 */
export const giftWalletKind = (account: Account | null | undefined): 'ox4' | 'external' | 'none' => (!account ? 'none' : externalOf(account) ? 'external' : 'ox4')

/**
 * 签一张送礼小票：
 *   外部钱包：eth_signTypedData_v4（钱包每次弹窗确认）；
 *   0x4 Wallet：signGiftTip（开了打赏授权就不弹）；插件太老没有这个方法就退回通用的 EIP-712 签名（逐次确认）。
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

/** 打赏授权的状态（不是 0x4 Wallet / 插件太老 = 没开） */
export async function giftSessionStatus(): Promise<Ox4GiftSession> {
  const ox = getOx4()
  if (!ox?.giftSessionStatus) return { active: false }
  try { return await ox.giftSessionStatus() } catch { return { active: false } }
}
/** 开启打赏授权：插件弹一次窗口（写明单次最多 = 目录里最贵礼物的价格，可选 7 天 / 24 小时） */
export async function startGiftSession(me: EnergyMe, maxTip: number): Promise<Ox4GiftSession> {
  const ox = getOx4()
  if (!ox?.giftSessionStart) throw new Error(t('请更新 0x4 Wallet 到最新版'))
  if (!me.contract || !me.chainId) throw new Error(t('送礼暂未开放'))
  return ox.giftSessionStart({ chainId: me.chainId, contract: me.contract, maxTip: Math.max(1, Math.ceil(maxTip)) })
}
export async function endGiftSession(): Promise<void> { await getOx4()?.giftSessionEnd?.().catch(() => {}) }

/** 服务器 /api/energy/prepare */
export const prepareGift = (room: string, device: string, to?: string | null) =>
  api<GiftPrep>('/api/energy/prepare', { method: 'POST', body: JSON.stringify({ room, device, ...(to ? { to } : {}) }) })
/** 服务器 /api/energy/send（实时连接不可用时的备用路） */
export const sendGiftHttp = (body: Record<string, unknown>) => api<GiftSendResult>('/api/energy/send', { method: 'POST', body: JSON.stringify(body) })
export const energyEarnings = () => api<EnergyEarnings>('/api/energy/earnings')
export const energyHistory = () => api<EnergyHistory>('/api/energy/earnings/history')

/**
 * 这一页的设备标识（通道 = 房间 × 设备 × 收礼人 × 比例）。每次打开页面新生成一个、不存本机：
 * 保证一条通道只有这一页的一个队列在写（复制标签页也不会共用），送礼队列才能放心地把「服务器已确认 ≥ 这张」当成这张已送成（防重复扣）
 */
const PAGE_DEVICE = 'web' + Array.from(globalThis.crypto?.getRandomValues?.(new Uint8Array(12)) ?? Array.from({ length: 12 }, () => Math.floor(Math.random() * 256)), (b) => b.toString(16).padStart(2, '0')).join('')
export function giftDevice(): string { return PAGE_DEVICE }
