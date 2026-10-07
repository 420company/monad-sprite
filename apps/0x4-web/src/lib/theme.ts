// Dark / light appearance (2026-09-25 goat: the design had two palettes but phones couldn't switch).
// Setting stored as 0x4.theme: auto = follow system. The resolved value goes to <html data-theme>; index.css swaps the whole palette off it;
// the native app also flips status-bar text color (dark text on light). The fluid background listens for theme-change to swap to a matching-brightness set.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { StatusBar, Style } from '@capacitor/status-bar'
import { isNative } from '@/lib/native'
import { WEB_SURFACE } from '@/lib/surface'

// space = web's third appearance "Space" (2026-10-03 goat picked Gemini direction 5): built on dark (white text), <html> additionally tagged data-look="space",
// background becomes a blurred photo, UI reduced to floating dark glass (desktop/space.css + space.ts). Web only — no such option in the phone app
export type ThemeSetting = 'auto' | 'dark' | 'light' | 'space'
export type Theme = 'dark' | 'light'

export const THEME_OPTIONS: { value: ThemeSetting; label: string }[] = [
  { value: 'auto', label: '跟随系统' },
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
]

/** Web's three (2026-10-02 goat: Midnight Black / Taro White; "Space" added 10-03): Midnight Black = dark, Taro White = light, Space = dark + blurred photo background */
export const WEB_THEME_OPTIONS: { value: 'dark' | 'light' | 'space'; label: string }[] = [
  { value: 'dark', label: '午夜黑' },
  { value: 'light', label: '香芋白' },
  { value: 'space', label: '空间' },
]

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)') : null
// Web (420.meme/app) defaults to dark, matching the website home (2026-09-29 goat); user changes in settings are still remembered. Phone app still defaults to follow-system
const DEFAULT_SETTING: ThemeSetting = WEB_SURFACE ? 'dark' : 'auto'
const resolve = (s: ThemeSetting): Theme => (s === 'auto' ? (media?.matches ? 'light' : 'dark') : s === 'space' ? 'dark' : s)

export function applyTheme(theme: Theme, setting?: ThemeSetting): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme
  // "Space" is web-only: the phone app renders it as dark even if it reads the value
  if (WEB_SURFACE && setting === 'space') document.documentElement.dataset.look = 'space'
  else delete document.documentElement.dataset.look
  if (isNative) StatusBar.setStyle({ style: theme === 'light' ? Style.Light : Style.Dark }).catch(() => {})
  window.dispatchEvent(new Event('theme-change'))
}

interface ThemeState {
  setting: ThemeSetting
  theme: Theme
  setTheme: (s: ThemeSetting) => void
}

export const useTheme = create<ThemeState>()(
  persist(
    (set) => ({
      setting: DEFAULT_SETTING,
      theme: resolve(DEFAULT_SETTING),
      setTheme(setting) {
        const theme = resolve(setting)
        set({ setting, theme })
        applyTheme(theme, setting)
      },
    }),
    {
      name: '0x4.theme',
      partialize: (s) => ({ setting: s.setting }),
      // v1 (2026-09-29): web's previously saved "follow system" was the old default, not the user's choice — migrated to dark once; later user changes are remembered as usual.
      // Phone app keeps its value untouched
      version: 1,
      migrate: (persisted, from) => {
        const s = (persisted || {}) as { setting?: ThemeSetting }
        return (WEB_SURFACE && from < 1 && (s.setting ?? 'auto') === 'auto' ? { ...s, setting: 'dark' } : s) as ThemeState
      },
      // Hydration happens synchronously in create(); useTheme isn't assigned yet — setState in a microtask (same pitfall as i18n)
      onRehydrateStorage: () => (state) => {
        const theme = resolve(state?.setting ?? DEFAULT_SETTING)
        applyTheme(theme, state?.setting ?? DEFAULT_SETTING)
        queueMicrotask(() => useTheme.setState({ theme }))
      },
    },
  ),
)

// On follow-system, track OS dark/light switches
media?.addEventListener('change', () => {
  const { setting } = useTheme.getState()
  if (setting !== 'auto') return
  const theme = resolve('auto')
  useTheme.setState({ theme })
  applyTheme(theme)
})

/** Whether "Space" appearance is active (web) */
export const isSpaceLook = (): boolean => typeof document !== 'undefined' && document.documentElement.dataset.look === 'space'

/** The effective appearance (for non-React consumers, e.g. the fluid background picking colors). "Space" counts as dark */
export const currentTheme = (): Theme => (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
