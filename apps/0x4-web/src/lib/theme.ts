// 深色 / 浅色外观（2026-09-25 goat：设计稿有两套配色，手机上却选不了）。
// 设置存 0x4.theme：auto = 跟随系统。解析后的结果写到 <html data-theme>，index.css 里按它换一整套颜色；
// 原生 App 顺手换状态栏文字颜色（浅色底要黑字）。流体背景监听 theme-change 事件换一组对应亮度的颜色。
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { StatusBar, Style } from '@capacitor/status-bar'
import { isNative } from '@/lib/native'
import { WEB_SURFACE } from '@/lib/surface'

// space = 网页版第三种外观「空间」（2026-10-03 goat 选 Gemini 方向 5）：建在深色上（白字），<html> 另标 data-look="space"，
// 背景换成虚化照片、界面只剩漂浮的深色玻璃（desktop/space.css + space.ts）。只在网页版出现，手机 App 没有这个选项
export type ThemeSetting = 'auto' | 'dark' | 'light' | 'space'
export type Theme = 'dark' | 'light'

export const THEME_OPTIONS: { value: ThemeSetting; label: string }[] = [
  { value: 'auto', label: '跟随系统' },
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
]

/** 网页版三种（2026-10-02 goat 午夜黑 / 香芋白；10-03 加「空间」）：午夜黑 = 深色，香芋白 = 浅色，空间 = 深色 + 虚化照片背景 */
export const WEB_THEME_OPTIONS: { value: 'dark' | 'light' | 'space'; label: string }[] = [
  { value: 'dark', label: '午夜黑' },
  { value: 'light', label: '香芋白' },
  { value: 'space', label: '空间' },
]

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)') : null
// 网页版（420.meme/app）默认深色，和官网首页一致（2026-09-29 goat）；用户在设置里改过的照旧记住。手机 App 仍默认跟随系统
const DEFAULT_SETTING: ThemeSetting = WEB_SURFACE ? 'dark' : 'auto'
const resolve = (s: ThemeSetting): Theme => (s === 'auto' ? (media?.matches ? 'light' : 'dark') : s === 'space' ? 'dark' : s)

export function applyTheme(theme: Theme, setting?: ThemeSetting): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme
  // 「空间」只在网页版：手机 App 就算读到这个值也按深色显示
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
      // 第 1 版（2026-09-29）：网页版以前存下的「跟随系统」是旧默认值，不是用户自己选的，一次性改成深色；之后用户再改的照常记住。
      // 手机 App 原样保留
      version: 1,
      migrate: (persisted, from) => {
        const s = (persisted || {}) as { setting?: ThemeSetting }
        return (WEB_SURFACE && from < 1 && (s.setting ?? 'auto') === 'auto' ? { ...s, setting: 'dark' } : s) as ThemeState
      },
      // 注水在 create() 里同步发生，那时 useTheme 还没赋值，放微任务里再 setState（同 i18n 的坑）
      onRehydrateStorage: () => (state) => {
        const theme = resolve(state?.setting ?? DEFAULT_SETTING)
        applyTheme(theme, state?.setting ?? DEFAULT_SETTING)
        queueMicrotask(() => useTheme.setState({ theme }))
      },
    },
  ),
)

// 跟随系统时，系统切换深浅色要跟着变
media?.addEventListener('change', () => {
  const { setting } = useTheme.getState()
  if (setting !== 'auto') return
  const theme = resolve('auto')
  useTheme.setState({ theme })
  applyTheme(theme)
})

/** 当前是不是「空间」外观（网页版） */
export const isSpaceLook = (): boolean => typeof document !== 'undefined' && document.documentElement.dataset.look === 'space'

/** 当前生效的外观（给不走 React 的地方用，比如流体背景挑颜色）。「空间」算深色 */
export const currentTheme = (): Theme => (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
