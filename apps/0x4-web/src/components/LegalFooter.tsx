// 网页版的一排小链接：服务条款 · 隐私政策 · 风险披露 · 下载中心（2026-10-04 走查）。
// 宽屏底部状态栏里本来就有；手机浏览器（窄屏）状态栏整条不显示、「空间」外观的底部胶囊也不放，访客就找不到这几页。
// 放在连接钱包面板底下和手机行情页最底下。新标签打开，带上当前主题（legalUrl）。
import { SITE_LINKS, legalUrl } from '@/lib/legal'
import { t } from '@/lib/i18n'

export default function LegalFooter({ className = '' }: { className?: string }) {
  return (
    <nav className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11.5px] text-muted ${className}`} aria-label={t('法律与下载')}>
      {SITE_LINKS.map((l) => <a key={l.key} href={legalUrl(l.url)} target="_blank" rel="noreferrer" className="hover:text-fg">{t(l.label)}</a>)}
    </nav>
  )
}
