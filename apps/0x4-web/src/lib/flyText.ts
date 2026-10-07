// Sprite trading display strings (2026-10-05 goat: "which trading copy is still off, where something should show but doesn't"), same wording as the server's server/src/flyText.ts:
// Internally the trading flow tracks wrapped coins (WBNB / WETH / BTCB), shown to users as BNB / ETH / BTC; exchanges' English rejection reasons are translated into actionable one-liners.
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
