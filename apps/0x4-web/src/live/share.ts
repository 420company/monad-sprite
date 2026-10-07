// Live / meeting share links (2026-09-30). Link prefix VITE_SHARE_BASE: app.420.meme until 420.meme becomes the web home,
// switched to https://420.meme on switch day (docs/DOMAIN_SWITCH.md). Both paths are forwarded to the server on Vercel to render card-bearing pages.
// 2026-10-04 review: the default also changed to 420.meme (mobile app builds don't carry this variable — shares still went out as app.420.meme, a domain slated for retirement)
import { locale } from '@/lib/i18n'

export const SHARE_BASE = (((import.meta.env as Record<string, string | undefined>).VITE_SHARE_BASE) || 'https://420.meme').replace(/\/+$/, '')
const lang = () => (/^en/i.test(locale()) ? 'en' : 'zh')

/** Share link: English UI appends ?l=en, and the card renders in English */
export function shareUrl(kind: 'live' | 'meet', id: string): string {
  return `${SHARE_BASE}/${kind}/${encodeURIComponent(id)}${lang() === 'en' ? '?l=en' : ''}`
}
/** X compose box (copy and link prefilled; the user hits send themselves) */
export function xIntentUrl(text: string, url: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`
}
