// 用户设置（持久化到 localStorage）
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ENV } from '@/lib/env'
import type { VibeKind } from '@/lib/notifyHaptics'
import { cleanFuelChains } from '@/lib/fuelChains'

interface SettingsState {
  rpcUrl: string
  slippageBps: number
  /** 快捷买入金额（SOL） */
  quickBuy: number[]
  /** 快捷卖出比例（%） */
  quickSell: number[]
  setRpcUrl: (url: string) => void
  setSlippageBps: (bps: number) => void
  setQuickBuy: (list: number[]) => void
  hideBalance: boolean
  toggleHideBalance: () => void
  guideDone: boolean
  setGuideDone: (v: boolean) => void
  /** 助记词是否已确认备份（可先跳过，首页持续提醒） */
  backedUp: boolean
  setBackedUp: (v: boolean) => void
  /** 注册后的推荐关注是否已展示 */
  followSuggested: boolean
  setFollowSuggested: (v: boolean) => void
  /** 自动锁定阈值（毫秒）。-1 = 从不，0 = 切后台立即锁 */
  autoLockMs: number
  setAutoLockMs: (ms: number) => void
  /** 自动补充燃料费（2026-09-27）：开了就从 BSC 上的 BNB 预存里给缺燃料费的链补（见 lib/gas.ts） */
  autoRefuel: boolean
  /** BNB 燃料费预存（美元），最少 10；买币时这部分 BNB 不动 */
  gasReserveUsd: number
  setAutoRefuel: (on: boolean, reserveUsd?: number) => void
  /** 燃料费页用户添加的链（2026-09-29）：只存白名单里能补的，默认五条不在这里（lib/fuelChains.ts） */
  fuelChains: number[]
  addFuelChain: (chainId: number) => void
  removeFuelChain: (chainId: number) => void
  /**
   * 按键震动（2026-09-29）：点按功能按键时轻微震一下，操作成功 / 失败时再震一下。只在原生 App 生效，见 lib/pressHaptics.ts、lib/native.ts hapticResult。
   * 2026-09-29 goat：原来「按键震动」「操作结果」两个开关合成这一个（老设置任一开着就算开，见下面 migrate）
   */
  pressHaptics: boolean
  setPressHaptics: (on: boolean) => void
  /**
   * 通知的「App 开着时震动」部分（2026-09-29）：各类通知在「我 → 通知」里一个开关，开 = 推送（声音和震动按系统）+ App 开着时震动。
   * 这里存 App 开着时那一半；没存过的类别跟推送开关走，再没有就按 lib/notifyHaptics.ts 的默认值
   */
  notifyHaptics: Partial<Record<VibeKind, boolean>>
  setNotifyHaptic: (kind: VibeKind, on: boolean) => void
  /** 推送各类开关在本机的一份副本（正本在服务器 /api/me/push-prefs），前台收到提醒时按它决定要不要震 */
  pushPrefsCache: Partial<Record<string, boolean>>
  setPushPrefsCache: (p: Partial<Record<string, boolean>>) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      rpcUrl: ENV.rpcUrl,
      slippageBps: 100, // 默认 1% 滑点，meme 币波动大
      quickBuy: [0.1, 0.5, 1, 2],
      quickSell: [25, 50, 100],
      setRpcUrl: (rpcUrl) => set({ rpcUrl: rpcUrl.trim() || ENV.rpcUrl }),
      setSlippageBps: (slippageBps) => set({ slippageBps: Math.max(1, Math.min(5000, Math.round(slippageBps))) }),
      setQuickBuy: (quickBuy) => set({ quickBuy }),
      hideBalance: false,
      toggleHideBalance: () => set((s) => ({ hideBalance: !s.hideBalance })),
      guideDone: false,
      setGuideDone: (guideDone) => set({ guideDone }),
      backedUp: true, // 老用户默认视为已备份，新建钱包时会显式置 false
      setBackedUp: (backedUp) => set({ backedUp }),
      followSuggested: false,
      setFollowSuggested: (followSuggested) => set({ followSuggested }),
      // 默认 5 分钟。老用户升级上来也会拿到这个默认值（persist 合并时缺的字段用初始值），
      // 也就是说所有人都会从「没有自动锁定」变成「5 分钟锁」，这是有意的。
      autoLockMs: 300_000,
      setAutoLockMs: (autoLockMs) => set({ autoLockMs }),
      autoRefuel: false,
      gasReserveUsd: 20,
      setAutoRefuel: (autoRefuel, reserveUsd) => set((s) => ({ autoRefuel, gasReserveUsd: reserveUsd === undefined ? s.gasReserveUsd : Math.max(10, Math.min(100_000, Math.round(reserveUsd))) })),
      fuelChains: [],
      addFuelChain: (chainId) => set((s) => ({ fuelChains: cleanFuelChains([...s.fuelChains, chainId]) })),
      // 默认五条不在 fuelChains 里，这里删不掉它们
      removeFuelChain: (chainId) => set((s) => ({ fuelChains: s.fuelChains.filter((x) => x !== chainId) })),
      // 默认开：老用户升级上来 persist 合并时拿到的也是开
      pressHaptics: true,
      setPressHaptics: (pressHaptics) => set({ pressHaptics }),
      notifyHaptics: {},
      setNotifyHaptic: (kind, on) => set((s) => ({ notifyHaptics: { ...s.notifyHaptics, [kind]: on } })),
      pushPrefsCache: {},
      setPushPrefsCache: (p) => set({ pushPrefsCache: { ...p } }),
    }),
    {
      name: '0x4.settings',
      // 版本 1（2026-09-29）：「按键震动」「操作结果」合成一个「按键震动」，老设置任一开着就算开
      version: 1,
      migrate: (persisted, version) => migrateSettings(persisted, version) as unknown as SettingsState,
      onRehydrateStorage: () => (state) => {
        // 设置里已经没有「Solana 节点」入口（2026-09-25），以前自定义过的一律换回当前构建的默认节点
        if (state) state.rpcUrl = ENV.rpcUrl
        // 白名单以后可能收窄（某条链的桥下线）：存过但已不在白名单的链去掉
        if (state) state.fuelChains = cleanFuelChains(state.fuelChains)
      },
    },
  ),
)

/** 老版本设置升级（导出给测试用） */
export function migrateSettings(persisted: unknown, version: number): Record<string, unknown> {
  const p = { ...((persisted as Record<string, unknown>) || {}) }
  if (version < 1) {
    // 两个开关没存过都算开；任一开着 → 合并后的「按键震动」开
    p.pressHaptics = p.pressHaptics !== false || p.resultHaptics !== false
    delete p.resultHaptics
  }
  return p
}
