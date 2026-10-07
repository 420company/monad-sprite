// 法律文件（2026-10-01 goat：网页底部和 App 里都要能找到）。正文是 420.meme 上的静态页（deploy/0x4-site/terms|privacy|risk），
// 中英文在同一页、按语言切换；App 里用系统浏览器打开（openExternal），不在钱包页面里内嵌网页。
import { currentTheme } from '@/lib/theme'

/** 静态页的地址带上当前主题（legal/theme.js 读 ?theme=）：从 app.420.meme 或手机 App 跳过去不同源，读不到网页版存的主题，靠这个参数跟随 */
export const legalUrl = (url: string): string => `${url}?theme=${currentTheme()}`

export const LEGAL_LINKS = [
  { key: 'terms', label: '服务条款', url: 'https://420.meme/terms/' },
  { key: 'privacy', label: '隐私政策', url: 'https://420.meme/privacy/' },
  { key: 'risk', label: '风险披露', url: 'https://420.meme/risk/' },
] as const

/** 网页版用的一排链接：三份法律文件 + 下载中心（2026-10-04 走查：手机浏览器里底部状态栏整条不显示、「空间」外观也藏了，访客找不到这几页；「关于」里也没有下载中心） */
export const SITE_LINKS = [...LEGAL_LINKS, { key: 'download', label: '下载中心', url: 'https://420.meme/download/' }] as const
