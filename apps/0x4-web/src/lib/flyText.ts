// 小精灵交易相关的显示文字（2026-10-05 goat「交易还有哪些没对的、哪里该显示却没显示」），和服务器 server/src/flyText.ts 同一套说法：
// 交易进程内部按包装币记（WBNB / WETH / BTCB），给人看叫 BNB / ETH / BTC；交易所拒单的英文原因翻成一句能照着做的话。
import { t } from './i18n'

const WRAPPED: Record<string, string> = { WBNB: 'BNB', WETH: 'ETH', BTCB: 'BTC', WBTC: 'BTC', WSOL: 'SOL' }
export const displaySymbol = (s: string | null | undefined): string => { const x = (s || '').replace(/-USDC$|-PERP$/, ''); return WRAPPED[x.toUpperCase()] || x }

export function rejectWhy(reason: string | null | undefined, marginUsd: number): string {
  const r = reason || ''
  if (/Margin is insufficient|-2019/i.test(r)) return t('合约账户可用保证金不够，开不了新单（单次保证金 ${m}）。存入更多 USDT，或在「交易方式」里调低单次保证金。', { m: marginUsd })
  if (/最小合规仓位|min.*notional|-4164/i.test(r)) return t('这个币的最小下单金额超过了「单次保证金 × 杠杆」，提高单次保证金或杠杆才下得了。')
  if (/leverage/i.test(r)) return t('杠杆倍数超过了这个币允许的上限。')
  return t('交易所没有接受这笔订单。')
}
