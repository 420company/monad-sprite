// 直播 / 会议分享链接（2026-09-30）。链接前缀 VITE_SHARE_BASE：420.meme 切成网页版主站之前是 app.420.meme，
// 切换当天改成 https://420.meme（docs/DOMAIN_SWITCH.md）。这两个路径在 Vercel 上转给服务器生成带卡片的页面。
// 2026-10-04 走查：默认值也改成 420.meme（手机 App 的构建没带这个变量，分享出去的还是 app.420.meme，那个域名以后要下线）
import { locale } from '@/lib/i18n'

export const SHARE_BASE = (((import.meta.env as Record<string, string | undefined>).VITE_SHARE_BASE) || 'https://420.meme').replace(/\/+$/, '')
const lang = () => (/^en/i.test(locale()) ? 'en' : 'zh')

/** 分享链接：英文界面带 ?l=en，卡片就是英文 */
export function shareUrl(kind: 'live' | 'meet', id: string): string {
  return `${SHARE_BASE}/${kind}/${encodeURIComponent(id)}${lang() === 'en' ? '?l=en' : ''}`
}
/** 发到 X 的发帖框（文案和链接预填，用户自己点发送） */
export function xIntentUrl(text: string, url: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`
}
