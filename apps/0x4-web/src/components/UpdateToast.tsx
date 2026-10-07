// A bottom strip on web when a new version is available (logic in lib/pwaUpdate). Never auto-dismisses, never blocks interaction; refreshes only when tapped, dismissible on the right.
// Sits above the bottom nav; never appears in the native app (no Service Worker).
import { useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { reloadForUpdate, usePwaUpdate } from '@/lib/pwaUpdate'
import { t } from '@/lib/i18n'

export default function UpdateToast() {
  const ready = usePwaUpdate((s) => s.ready)
  const [dismissed, setDismissed] = useState(false)
  if (!ready || dismissed) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 z-[95] flex justify-center px-4 bottom-[calc(max(8px,env(safe-area-inset-bottom))+84px)]">
      <div role="status" className="toast-solid pointer-events-auto flex w-full max-w-[420px] items-center rounded-lg border border-line text-sm shadow-xl">
        <button type="button" onClick={reloadForUpdate} className="flex min-h-12 min-w-0 flex-1 items-center gap-2 pl-3 text-left">
          <RefreshCw size={17} className="shrink-0 text-accent" aria-hidden="true" />
          <span className="min-w-0 flex-1">{t('有新版本，点这里刷新')}</span>
        </button>
        <button type="button" onClick={() => setDismissed(true)} className="icon-button" aria-label={t('关闭通知')} title={t('关闭通知')}><X size={17} /></button>
      </div>
    </div>
  )
}
