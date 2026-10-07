// Translate raw on-chain / API errors into one user-comprehensible line: strip signature hashes and English stack traces, map by common cause.
// Returns { title, message, hint } for dialogs; unrecognized errors keep only their first 120 characters.
import { t } from '@/lib/i18n'
export interface FriendlyError { title: string; message: string; hint?: string }

const RULES: [RegExp, FriendlyError][] = [
  [/没有 SOL 付手续费|InsufficientFundsForFee|insufficient lamports|insufficient funds for rent/i, { title: '缺少手续费', message: '钱包里没有 SOL 付 Solana 网络手续费。', hint: '往你的 Solana 地址充入至少 0.01 SOL 后再试。' }],
  [/block height exceeded|has expired|blockhash not found|Transaction was not confirmed/i, { title: '交易未确认', message: '交易在有效期内没有被网络确认，资金没有变动。', hint: '常见原因是没有 SOL 付手续费或网络拥堵，确认余额后重试。' }],
  [/insufficient funds|insufficient balance|余额不足|exceeds balance|transfer amount exceeds/i, { title: '余额不足', message: '这笔交易需要的金额超过了可用余额。', hint: '减少金额，或先充值。' }],
  [/gas|intrinsic gas|fee cap|max fee per gas/i, { title: '缺少手续费', message: '这条链上的币不够付燃料费。', hint: '往这条链的地址转入少量它的币（ETH、BNB、POL 等）。' }],
  [/slippage|0x1771|exceeds desired|price impact|Price moved/i, { title: '价格变动', message: '成交价超出了滑点范围，交易已取消。', hint: '重新获取报价，或适当调高滑点。' }],
  [/user rejected|user denied|rejected the request/i, { title: '已取消', message: '你取消了签名。' }],
  [/No available|no route|404|流动性不足|暂无可用路线/i, { title: '暂无路线', message: '这两种资产之间暂时没有可用的兑换路线。', hint: '换一个支付资产或金额再试。' }],
  [/minimum|min.*amount|too small|低于最小/i, { title: '金额太小', message: '低于这条路线的最小金额。', hint: '提高金额后重试。' }],
  [/timeout|timed out|Failed to fetch|NetworkError|network|ECONN|502|503|504/i, { title: '网络问题', message: '暂时连不上服务，交易没有发出。', hint: '稍后再试。' }],
  [/nonce|already known|replacement/i, { title: '交易冲突', message: '上一笔交易还在处理中。', hint: '等它完成后再发下一笔。' }],
  [/reconciliation required|unresolved/i, { title: '订单待核对', message: '有一笔订单结果待确认，系统正在自动核对。', hint: '几分钟后自动恢复，不用重复操作。' }],
]

/** Strip long strings like signatures / hashes / addresses, keeping the human-readable part */
function strip(msg: string): string {
  return msg.replace(/\b[1-9A-HJ-NP-Za-km-z]{43,90}\b/g, '').replace(/0x[0-9a-fA-F]{40,}/g, '').replace(/\s{2,}/g, ' ').trim()
}

export function friendlyError(e: unknown, fallbackTitle = '操作失败'): FriendlyError {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e ?? '')
  // The rule table stores the simplified-Chinese source; translate here (t() must be evaluated at call time)
  for (const [re, out] of RULES) if (re.test(raw)) return { title: t(out.title), message: t(out.message), ...(out.hint ? { hint: t(out.hint) } : {}) }
  const cleaned = strip(raw)
  return { title: t(fallbackTitle), message: cleaned ? cleaned.slice(0, 120) : t('请稍后再试。') }
}

/**
 * User-cancelled actions (closing the verification panel, cancelling Face ID, rejecting a signature in the wallet) aren't errors — no red alert should pop (2026-09-29 goat:
 * closing the password screen while topping up fuel popped a full screen of raw transaction data). The signing library wraps the reason in its own error (Details: <localized "cancelled">) — recognize that too.
 */
const CANCEL_TEXT = /(^|Details:\s*)(已取消|Canceled|Cancelled)(\s|$|\.)|user rejected|user denied|rejected the request/i
export function isUserCancel(e: unknown): boolean {
  for (let x: unknown = e, i = 0; x && i < 6; x = (x as { cause?: unknown }).cause, i++) {
    // ★ Check both the class name and name: previously only the class name was checked (name ignored when a class name existed), but the 0x4 extension's "user rejected" is class Ox4Error with name = UnlockCancelled,
    //   which went unrecognized — the UI showed a red "request rejected" alert (2026-09-29 goat on the perp page); class names also change under production minification
    const o = x as { name?: string; code?: unknown; constructor?: { name?: string } }
    const names = [o.constructor?.name, o.name]
    // WalletRequired: on web without a wallet, tapping something that needs an account — the wallet entry is already open, so it's not an error
    if (names.some((n) => n === 'UnlockCancelled' || n === 'BiometricCancelled' || n === 'WalletRequired')) return true
    // Per EIP-1193, 4001 = user rejected (same code in the 0x4 extension)
    if (o.code === 4001) return true
    const msg = x instanceof Error ? x.message : typeof x === 'string' ? x : ''
    if (msg && CANCEL_TEXT.test(msg)) return true
  }
  return false
}

/** When the raw error carries transaction params, contract calls, signing-library versions, or long hex strings, it must not be shown to users as-is */
const RAW_TEXT = /Request Arguments|Raw Call Arguments|Contract Call|Version: viem|Docs: https?:|0x[0-9a-fA-F]{64,}/
/** Run everything through here before popping an alert: user cancellations return null (no alert); raw errors become one comprehensible line; everything else passes through */
export function toastErrorText(text: string): string | null {
  if (!text || isUserCancel(text)) return null
  if (text.length > 200 || RAW_TEXT.test(text)) {
    const f = friendlyError(text)
    return f.hint ? `${f.message} ${f.hint}` : f.message
  }
  return text
}

/**
 * Use this for all on-screen errors (popup alerts, form red text, panel states alike):
 * user cancellations return an empty string (callers show nothing); raw transaction data / hex becomes one comprehensible line; fallback when nothing can be extracted.
 * 2026-09-29: closing the verification panel while topping up fuel popped a full screen of transaction data — 100+ places across the app showed raw error text directly, all switched to here.
 */
export function errorText(e: unknown, fallback: string): string {
  if (isUserCancel(e)) return ''
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  if (!raw) return fallback
  return toastErrorText(raw) ?? ''
}
