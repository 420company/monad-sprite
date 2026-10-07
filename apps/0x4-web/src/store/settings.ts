// User settings (persisted to localStorage)
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ENV } from '@/lib/env'
import type { VibeKind } from '@/lib/notifyHaptics'
import { cleanFuelChains } from '@/lib/fuelChains'

interface SettingsState {
  rpcUrl: string
  slippageBps: number
  /** Quick buy amount (SOL) */
  quickBuy: number[]
  /** Quick sell ratio (%) */
  quickSell: number[]
  setRpcUrl: (url: string) => void
  setSlippageBps: (bps: number) => void
  setQuickBuy: (list: number[]) => void
  hideBalance: boolean
  toggleHideBalance: () => void
  guideDone: boolean
  setGuideDone: (v: boolean) => void
  /** Whether the mnemonic backup is confirmed (skippable; home keeps reminding) */
  backedUp: boolean
  setBackedUp: (v: boolean) => void
  /** Whether the post-signup recommended follows have been shown */
  followSuggested: boolean
  setFollowSuggested: (v: boolean) => void
  /** Auto-lock threshold (ms). -1 = never, 0 = lock immediately on backgrounding */
  autoLockMs: number
  setAutoLockMs: (ms: number) => void
  /** Auto gas top-up (2026-09-27): when on, chains short on gas are topped up from the BNB reserve on BSC (see lib/gas.ts) */
  autoRefuel: boolean
  /** BNB gas reserve (USD), minimum 10; this BNB stays untouched when buying coins */
  gasReserveUsd: number
  setAutoRefuel: (on: boolean, reserveUsd?: number) => void
  /** Chains the user added on the gas page (2026-09-29): only whitelisted top-up-able ones are stored; the five defaults aren't here (lib/fuelChains.ts) */
  fuelChains: number[]
  addFuelChain: (chainId: number) => void
  removeFuelChain: (chainId: number) => void
  /**
   * Keypress haptics (2026-09-29): a light buzz when tapping function keys, another on success / failure. Only takes effect in the native app — see lib/pressHaptics.ts, lib/native.ts hapticResult.
   * 2026-09-29 goat: the old "keypress haptics" and "operation result" toggles were merged into this one (if either old setting was on, this counts as on — see migrate below)
   */
  pressHaptics: boolean
  setPressHaptics: (on: boolean) => void
  /**
   * The "vibrate while the app is open" half of notifications (2026-09-29): each notification category has one toggle under "Me -> Notifications"; on = push (sound and vibration per system) + vibrate while the app is open.
   * This stores the while-open half; categories never stored follow the push toggle, and failing that, lib/notifyHaptics.ts defaults
   */
  notifyHaptics: Partial<Record<VibeKind, boolean>>
  setNotifyHaptic: (kind: VibeKind, on: boolean) => void
  /** A local copy of each push toggle (the original lives on the server at /api/me/push-prefs); when a notification arrives in the foreground, this decides whether to buzz */
  pushPrefsCache: Partial<Record<string, boolean>>
  setPushPrefsCache: (p: Partial<Record<string, boolean>>) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      rpcUrl: ENV.rpcUrl,
      slippageBps: 100, // Default 1% slippage — meme coins are volatile
      quickBuy: [0.1, 0.5, 1, 2],
      quickSell: [25, 50, 100],
      setRpcUrl: (rpcUrl) => set({ rpcUrl: rpcUrl.trim() || ENV.rpcUrl }),
      setSlippageBps: (slippageBps) => set({ slippageBps: Math.max(1, Math.min(5000, Math.round(slippageBps))) }),
      setQuickBuy: (quickBuy) => set({ quickBuy }),
      hideBalance: false,
      toggleHideBalance: () => set((s) => ({ hideBalance: !s.hideBalance })),
      guideDone: false,
      setGuideDone: (guideDone) => set({ guideDone }),
      backedUp: true, // Existing users default to backed-up; new wallets explicitly set false at creation
      setBackedUp: (backedUp) => set({ backedUp }),
      followSuggested: false,
      setFollowSuggested: (followSuggested) => set({ followSuggested }),
      // Default 5 minutes. Upgrading existing users also get this default (persist merge fills missing fields with initial values),
      // In other words, everyone moves from "no auto-lock" to "5-minute lock" — that's intentional.
      autoLockMs: 300_000,
      setAutoLockMs: (autoLockMs) => set({ autoLockMs }),
      autoRefuel: false,
      gasReserveUsd: 20,
      setAutoRefuel: (autoRefuel, reserveUsd) => set((s) => ({ autoRefuel, gasReserveUsd: reserveUsd === undefined ? s.gasReserveUsd : Math.max(10, Math.min(100_000, Math.round(reserveUsd))) })),
      fuelChains: [],
      addFuelChain: (chainId) => set((s) => ({ fuelChains: cleanFuelChains([...s.fuelChains, chainId]) })),
      // The five defaults aren't in fuelChains — they can't be removed here
      removeFuelChain: (chainId) => set((s) => ({ fuelChains: s.fuelChains.filter((x) => x !== chainId) })),
      // On by default: upgrading users also get "on" when persist merges
      pressHaptics: true,
      setPressHaptics: (pressHaptics) => set({ pressHaptics }),
      notifyHaptics: {},
      setNotifyHaptic: (kind, on) => set((s) => ({ notifyHaptics: { ...s.notifyHaptics, [kind]: on } })),
      pushPrefsCache: {},
      setPushPrefsCache: (p) => set({ pushPrefsCache: { ...p } }),
    }),
    {
      name: '0x4.settings',
      // Version 1 (2026-09-29): "keypress haptics" and "operation result" merged into one "keypress haptics" — either old setting on counts as on
      version: 1,
      migrate: (persisted, version) => migrateSettings(persisted, version) as unknown as SettingsState,
      onRehydrateStorage: () => (state) => {
        // Settings no longer has a "Solana node" entry (2026-09-25); anyone who customized one is switched back to the current build's default node
        if (state) state.rpcUrl = ENV.rpcUrl
        // The whitelist may narrow later (a chain's bridge goes offline): drop stored chains no longer on the whitelist
        if (state) state.fuelChains = cleanFuelChains(state.fuelChains)
      },
    },
  ),
)

/** Legacy settings migration (exported for tests) */
export function migrateSettings(persisted: unknown, version: number): Record<string, unknown> {
  const p = { ...((persisted as Record<string, unknown>) || {}) }
  if (version < 1) {
    // Either toggle never stored counts as on; either on → the merged "keypress haptics" is on
    p.pressHaptics = p.pressHaptics !== false || p.resultHaptics !== false
    delete p.resultHaptics
  }
  return p
}
