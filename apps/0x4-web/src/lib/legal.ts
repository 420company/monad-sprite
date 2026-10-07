// Legal docs (2026-10-01 goat: findable in the web footer and in the app). Bodies are static pages on 420.meme (deploy/0x4-site/terms|privacy|risk),
// Chinese and English on the same page, switched by language; the app opens them in the system browser (openExternal), never embedded in the wallet page.
import { currentTheme } from '@/lib/theme'

/** Static page URLs carry the current theme (legal/theme.js reads ?theme=): jumping from app.420.meme or the mobile app is cross-origin, so the web's stored theme is unreadable — this param follows along */
export const legalUrl = (url: string): string => `${url}?theme=${currentTheme()}`

export const LEGAL_LINKS = [
  { key: 'terms', label: '服务条款', url: 'https://420.meme/terms/' },
  { key: 'privacy', label: '隐私政策', url: 'https://420.meme/privacy/' },
  { key: 'risk', label: '风险披露', url: 'https://420.meme/risk/' },
] as const

/** The web's row of links: three legal docs + download center (2026-10-04 walkthrough: the whole bottom status bar hides in phone browsers and the "Space" look hides it too — guests couldn't find these pages; "About" had no download center either) */
export const SITE_LINKS = [...LEGAL_LINKS, { key: 'download', label: '下载中心', url: 'https://420.meme/download/' }] as const
