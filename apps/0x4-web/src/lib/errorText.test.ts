// Unified filtering of UI-displayed errors (2026-09-29 goat: when topping up gas fees, the verification panel was dismissed and a whole screen of raw transaction data popped up)
import { describe, expect, it } from 'vitest'
import { errorText, isUserCancel, toastErrorText } from './errors'
import { UnlockCancelled } from './vault/gate'

// What a real signing-library error looks like: the reason is wrapped in Details, followed by the whole block of transaction parameters
const viemLike = (details: string) => Object.assign(new Error(`An unknown error occurred while executing the contract function.

Request Arguments:
  from:  0xbc1d9760bd6ca468ca9fb5ff2cfbeac35d86c973
  to:    0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c
  data:  0x${'0'.repeat(600)}2710${'0'.repeat(300)}

Details: ${details}
Version: viem@2.56.5`), { name: 'TransactionExecutionError' })

describe('报错过滤', () => {
  it('关掉验证面板（本身、被签名库包一层、在 cause 里）都认成取消，不显示', () => {
    expect(isUserCancel(new UnlockCancelled())).toBe(true)
    expect(errorText(new UnlockCancelled(), '补充失败')).toBe('')
    expect(errorText(viemLike('已取消'), '补充失败')).toBe('')
    expect(errorText(Object.assign(new Error('wrapped'), { cause: new UnlockCancelled() }), '补充失败')).toBe('')
    expect(toastErrorText(viemLike('Canceled').message)).toBeNull()
  })
  it('0x4 插件的「用户拒绝」（Ox4Error 类、name = UnlockCancelled、code 4001、中文原话）认成取消（2026-09-29 合约页显示「你拒绝了这个请求」红字）', async () => {
    const { Ox4Error } = await import('./vault/extension')
    expect(isUserCancel(new Ox4Error(4001, '你拒绝了这个请求'))).toBe(true)
    expect(errorText(new Ox4Error(4001, '你拒绝了这个请求'), '读取失败')).toBe('')
    // After the release build is minified, class names shrink to one letter: name / code must be recognized too
    class e extends Error { name = 'UnlockCancelled' }
    expect(isUserCancel(new e('x'))).toBe(true)
    expect(isUserCancel(Object.assign(new Error('你拒绝了这个请求'), { code: 4001 }))).toBe(true)
    // Positive control: extension locked (4900) is an ordinary error
    expect(isUserCancel(new Ox4Error(4900, '钱包已锁定'))).toBe(false)
  })
  it('夹着交易原始数据的报错换成一句能看懂的话，不出现十六进制', () => {
    const out = errorText(viemLike('insufficient funds for gas * price + value'), '补充失败')
    expect(out).not.toMatch(/0x[0-9a-f]{20,}|Request Arguments|viem/i)
    expect(out.length).toBeGreaterThan(0)
    expect(out.length).toBeLessThan(200)
  })
  it('对照：正常的中文报错原样显示；没有内容用兜底文字', () => {
    expect(errorText(new Error('余额不足'), '转账失败')).toBe('余额不足')
    expect(errorText(new Error(''), '转账失败')).toBe('转账失败')
    expect(errorText(null, '转账失败')).toBe('转账失败')
  })
})
