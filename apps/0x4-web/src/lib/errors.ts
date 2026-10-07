// 把链上 / 接口的原始报错翻成用户能懂的一句话：去掉签名哈希、英文堆栈，按常见原因映射。
// 返回 { title, message, hint }，给弹窗用；认不出的错只保留前 120 个字符。
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

/** 去掉签名 / 哈希 / 地址这类长串，保留人能读的部分 */
function strip(msg: string): string {
  return msg.replace(/\b[1-9A-HJ-NP-Za-km-z]{43,90}\b/g, '').replace(/0x[0-9a-fA-F]{40,}/g, '').replace(/\s{2,}/g, ' ').trim()
}

export function friendlyError(e: unknown, fallbackTitle = '操作失败'): FriendlyError {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e ?? '')
  // 规则表存简体原文，这里再翻译（t() 必须在调用时求值）
  for (const [re, out] of RULES) if (re.test(raw)) return { title: t(out.title), message: t(out.message), ...(out.hint ? { hint: t(out.hint) } : {}) }
  const cleaned = strip(raw)
  return { title: t(fallbackTitle), message: cleaned ? cleaned.slice(0, 120) : t('请稍后再试。') }
}

/**
 * 用户自己取消的（关掉验证面板、面容 ID 取消、在钱包里拒绝签名）不算错误，不该弹红色提示（2026-09-29 goat：
 * 补燃料费时在输入密码界面点关闭，弹出一整屏交易原始数据）。签名库会把原因包在自己的报错里（Details: 已取消），也要认出来。
 */
const CANCEL_TEXT = /(^|Details:\s*)(已取消|Canceled|Cancelled)(\s|$|\.)|user rejected|user denied|rejected the request/i
export function isUserCancel(e: unknown): boolean {
  for (let x: unknown = e, i = 0; x && i < 6; x = (x as { cause?: unknown }).cause, i++) {
    // ★类名和 name 两个都看：以前只看类名（有类名就不看 name），0x4 插件的「用户拒绝」是 Ox4Error 类、name = UnlockCancelled，
    //   认不出来，界面上直接显示「你拒绝了这个请求」红字（2026-09-29 goat 合约页）；正式包压缩后类名也会变
    const o = x as { name?: string; code?: unknown; constructor?: { name?: string } }
    const names = [o.constructor?.name, o.name]
    // WalletRequired：网页版没钱包时点了要账号的操作，已经打开钱包入口，不算错误
    if (names.some((n) => n === 'UnlockCancelled' || n === 'BiometricCancelled' || n === 'WalletRequired')) return true
    // EIP-1193 约定 4001 = 用户拒绝（0x4 插件同一个码）
    if (o.code === 4001) return true
    const msg = x instanceof Error ? x.message : typeof x === 'string' ? x : ''
    if (msg && CANCEL_TEXT.test(msg)) return true
  }
  return false
}

/** 原始报错里夹着交易参数、合约调用、签名库版本、长串十六进制这类东西，就不能原样给用户看 */
const RAW_TEXT = /Request Arguments|Raw Call Arguments|Contract Call|Version: viem|Docs: https?:|0x[0-9a-fA-F]{64,}/
/** 弹提示前统一过一遍：用户取消返回 null（不弹）；原始报错换成一句能看懂的话；其余原样 */
export function toastErrorText(text: string): string | null {
  if (!text || isUserCancel(text)) return null
  if (text.length > 200 || RAW_TEXT.test(text)) {
    const f = friendlyError(text)
    return f.hint ? `${f.message} ${f.hint}` : f.message
  }
  return text
}

/**
 * 界面上显示报错统一用这个（弹出提示、表单红字、面板状态都一样）：
 * 用户自己取消的返回空串（调用方据此什么都不显示）；夹着交易原始数据 / 十六进制的换成能看懂的一句话；拿不到内容用 fallback。
 * 2026-09-29：补燃料费时关掉验证面板弹出一整屏交易数据，全 App 一百多处直接显示报错原文，统一改用这里。
 */
export function errorText(e: unknown, fallback: string): string {
  if (isUserCancel(e)) return ''
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  if (!raw) return fallback
  return toastErrorText(raw) ?? ''
}
