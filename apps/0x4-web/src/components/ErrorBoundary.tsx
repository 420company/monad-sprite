// 渲染出错时的兜底界面。
// 没有它的话，React 19 遇到渲染错误会把整棵界面卸掉，用户只看到一片空白、什么都点不了。
import { Component, type ReactNode } from 'react'
import { t } from '@/lib/i18n'
import { isChunkError, reloadForNewVersion } from '@/lib/chunkReload'
import { CLEAN_URLS, WEB_HOME } from '@/lib/route'

interface State { error: unknown }

/** 兜底页上显示的错误说明，用户截图给我们时能看出是哪类错误 */
function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State { return { error } }

  // 发新版后旧页面拿不到旧分包：自动原地刷新一次（lib/chunkReload），用户不用看到这一页
  componentDidCatch(error: unknown) { if (isChunkError(error)) reloadForNewVersion() }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-dvh flex-col justify-center gap-4 bg-bg px-6 text-fg safe-top safe-bottom">
        <h1 className="text-xl font-semibold">{t('出了点问题')}</h1>
        <p className="text-sm text-muted">{t('界面遇到了一个错误。你的钱包和资产不受影响。')}</p>
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-xl bg-card p-3 text-xs text-muted">{describe(this.state.error)}</pre>
        {/* 分包拿不到（发了新版 / 网络断了）：原地刷新，还回到这一页；其它错误回首页，免得再撞上同一个坏页面 */}
        <button className="h-12 rounded-xl bg-accent font-semibold text-bg" onClick={() => { if (!isChunkError(this.state.error)) { if (CLEAN_URLS) { location.assign(WEB_HOME); return } location.hash = '#/' } location.reload() }}>{t('重新加载')}</button>
      </div>
    )
  }
}
