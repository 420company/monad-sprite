// How trade progress is worded (2026-10-05 goat: the web instant swap kept showing "signing & sending…" with no way to tell whether it was waiting on the user or on the chain — "why is there no waiting notice").
// Web signing needs the user to confirm in the popup window from the 0x4 extension (or MetaMask / other external wallets): this step explicitly says "confirm in the … window", and tells where to find it when the window can't be found;
// after broadcast, a separate "sent, awaiting on-chain confirmation" (chains like Ethereum take ten seconds to a minute or two). The mobile app signs locally and keeps the old "signing & sending…".
import type { ExecPhase } from './lifi'
import { WEB_SURFACE } from './surface'
import { t } from './i18n'

export type Signer = 'plugin' | 'external' | 'local'

/** Whether the web client is connected to the 0x4 extension or an external wallet; the mobile app signs locally */
export function signerOf(kind: 'ox4' | 'external' | null): Signer {
  return !WEB_SURFACE ? 'local' : kind === 'external' ? 'external' : 'plugin'
}

export function execPhaseText(phase: ExecPhase, who: Signer): { main: string; hint?: string } {
  if (phase === 'sent') return { main: t('已发出，等待链上确认') }
  if (who === 'local') return { main: phase === 'approving' ? t('授权中…') : t('签名发送中…') }
  if (who === 'external') return { main: phase === 'approving' ? t('请在钱包窗口里确认授权') : t('请在钱包窗口里确认') }
  return { main: phase === 'approving' ? t('请在 0x4 插件窗口里确认授权') : t('请在 0x4 插件窗口里确认'), hint: t('没看到窗口？点浏览器右上角的 0x4 图标') }
}
