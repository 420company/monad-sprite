// The web version's row of small links: Terms · Privacy · Risk disclosure · Download center (2026-10-04 walkthrough).
// The wide-screen bottom status bar already has them; on phone browsers (narrow) the status bar isn't shown at all, and the "space" appearance's bottom capsule doesn't carry them — so visitors couldn't find these pages.
// Placed under the connect-wallet panel and at the bottom of the mobile markets page. Open in a new tab with the current theme (legalUrl).
import { SITE_LINKS, legalUrl } from '@/lib/legal'
import { t } from '@/lib/i18n'

export default function LegalFooter({ className = '' }: { className?: string }) {
  return (
    <nav className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11.5px] text-muted ${className}`} aria-label={t('法律与下载')}>
      {SITE_LINKS.map((l) => <a key={l.key} href={legalUrl(l.url)} target="_blank" rel="noreferrer" className="hover:text-fg">{t(l.label)}</a>)}
    </nav>
  )
}
