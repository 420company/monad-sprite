// 数字、金额、地址的格式化工具
import { t } from '@/lib/i18n'

/** 美元金额：大数用 K/M/B 缩写，小数按精度显示 */
/** 钱袋子金额：余额、保证金、手续费、盈亏。永远两位小数。
 *
 *  别用 fmtUsd 显示这类数——它对小于 1 的数会走「代币价格」分支，
 *  为的是把 BONK 那种 $0.00001234 显示清楚。用在账户余额上就会变成
 *  「可用保证金 $0.036576」，一眼就不专业。 */
export function fmtMoney(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '--'
  if (n === 0) return '$0.00'
  // 不到 1 分钱的余额，写出精确值没有意义，说明它约等于没有
  if (Math.abs(n) < 0.005) return n > 0 ? '<$0.01' : '>-$0.01'
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtUsd(n: number | undefined | null, opts: { compact?: boolean } = {}): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '--'
  const abs = Math.abs(n)
  if (opts.compact) {
    if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
    if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
    if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  }
  if (abs >= 1) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (abs === 0) return '$0.00'
  // 小于 1 美元的代币价格：显示足够的有效数字，超小价格用下标形式 0.0₅123
  if (abs < 0.0001) {
    const s = abs.toExponential(3) // 例如 1.234e-7
    const [mant, exp] = s.split('e')
    const zeros = Math.abs(Number(exp)) - 1
    const digits = mant.replace('.', '').slice(0, 4)
    const sub = String(zeros).replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)])
    return `${n < 0 ? '-' : ''}$0.0${sub}${digits}`
  }
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`
}

/** 代币数量 */
export function fmtAmount(n: number | undefined | null, maxDigits = 4): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '--'
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e4) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return n.toLocaleString('en-US', { maximumFractionDigits: maxDigits })
}

/** 百分比变化，带正负号 */
export function fmtPct(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '--'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

/** 地址缩写：AbCd…WxYz */
/** 地址当名字显示时的短格式：前 5 后 3（如 0x420…000，goat 2026-09-25 定）。只在资料里没有昵称时兜底；服务端默认昵称 2026-09-29 起是 User + 编号（server/src/userSeq.ts） */
export function shortId(addr: string): string {
  if (!addr) return ''
  return addr.length <= 9 ? addr : `${addr.slice(0, 5)}…${addr.slice(-3)}`
}

export function shortAddr(addr: string, n = 4): string {
  if (!addr) return ''
  if (addr.length <= n * 2 + 1) return addr
  return `${addr.slice(0, n)}…${addr.slice(-n)}`
}

/** 相对时间：几分钟前 / 几小时前 / 几天前 */
export function timeAgo(ts?: number | null): string {
  if (!ts) return '--'
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return t('刚刚')
  if (m < 60) return t('{n} 分钟前', { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('{n} 小时前', { n: h })
  const d = Math.floor(h / 24)
  if (d < 30) return t('{n} 天前', { n: d })
  const mo = Math.floor(d / 30)
  if (mo < 12) return t('{n} 个月前', { n: mo })
  return t('{n} 年前', { n: Math.floor(mo / 12) })
}

/** 把用户输入的十进制数量转换为最小单位（避免浮点误差） */
export function toBaseUnits(amount: string | number, decimals: number): bigint {
  const s = String(amount).trim()
  if (!s || Number.isNaN(Number(s))) return 0n
  const [int, frac = ''] = s.split('.')
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals)
  return BigInt(int || '0') * 10n ** BigInt(decimals) + BigInt(fracPadded || '0')
}

/** 最小单位转十进制数量 */
export function fromBaseUnits(raw: bigint | number | string, decimals: number): number {
  return Number(raw) / 10 ** decimals
}

/** 合约动态 / 交易记录的代币名是写入时拼好的「SOL 多 1x」（存在服务器上），显示时把方向词按当前语言换掉 */
export function sideLabel(symbol: string): string {
  return symbol.replace(/(^|\s)(多|空)(?=\s|$)/g, (_m, pre: string, side: string) => pre + t(side))
}
