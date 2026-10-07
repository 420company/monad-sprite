// 交易进度怎么写（2026-10-05 goat：网页版闪兑一直显示「签名发送中…」，不知道是在等自己确认还是在等链，「为什么没有等待提醒」）。
// 网页版签名要用户在 0x4 插件（或 MetaMask 等外部钱包）弹出的窗口里点确认：这一步明说「请在…窗口里确认」，并提示窗口找不到时去哪找；
// 交易发出以后单独一句「已发出，等待链上确认」（以太坊这类链要等十几秒到一两分钟）。手机 App 本机签名，照旧「签名发送中…」。
import type { ExecPhase } from './lifi'
import { WEB_SURFACE } from './surface'
import { t } from './i18n'

export type Signer = 'plugin' | 'external' | 'local'

/** 网页版连的是 0x4 插件还是外部钱包；手机 App 本机签名 */
export function signerOf(kind: 'ox4' | 'external' | null): Signer {
  return !WEB_SURFACE ? 'local' : kind === 'external' ? 'external' : 'plugin'
}

export function execPhaseText(phase: ExecPhase, who: Signer): { main: string; hint?: string } {
  if (phase === 'sent') return { main: t('已发出，等待链上确认') }
  if (who === 'local') return { main: phase === 'approving' ? t('授权中…') : t('签名发送中…') }
  if (who === 'external') return { main: phase === 'approving' ? t('请在钱包窗口里确认授权') : t('请在钱包窗口里确认') }
  return { main: phase === 'approving' ? t('请在 0x4 插件窗口里确认授权') : t('请在 0x4 插件窗口里确认'), hint: t('没看到窗口？点浏览器右上角的 0x4 图标') }
}
