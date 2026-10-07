// Fallback UI when rendering crashes.
// Without it, React 19 unmounts the entire UI on a render error — the user sees only a blank screen with nothing clickable.
import { Component, type ReactNode } from 'react'
import { t } from '@/lib/i18n'
import { isChunkError, reloadForNewVersion } from '@/lib/chunkReload'
import { CLEAN_URLS, WEB_HOME } from '@/lib/route'

interface State { error: unknown }

/** The error description shown on the fallback page, so a user's screenshot tells us the error class */
function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State { return { error } }

  // After a new release, stale pages can't fetch old chunks: auto-refresh in place once (lib/chunkReload) — users never see this page
  componentDidCatch(error: unknown) { if (isChunkError(error)) reloadForNewVersion() }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-dvh flex-col justify-center gap-4 bg-bg px-6 text-fg safe-top safe-bottom">
        <h1 className="text-xl font-semibold">{t('出了点问题')}</h1>
        <p className="text-sm text-muted">{t('界面遇到了一个错误。你的钱包和资产不受影响。')}</p>
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-xl bg-card p-3 text-xs text-muted">{describe(this.state.error)}</pre>
        {/* Chunk unreachable (new release / network down): refresh in place and land back here; other errors go home so the same broken page isn't hit again */}
        <button className="h-12 rounded-xl bg-accent font-semibold text-bg" onClick={() => { if (!isChunkError(this.state.error)) { if (CLEAN_URLS) { location.assign(WEB_HOME); return } location.hash = '#/' } location.reload() }}>{t('重新加载')}</button>
      </div>
    )
  }
}
