// Server-sent dynamic strings: notification center, group system messages, parameterized errors.
//
// Since 2026-09-26 the server attaches a template key (Simplified Chinese source) plus params to these strings,
// which are rendered here via t(key, params) in the UI language. Old data only has fully-rendered Simplified Chinese sentences: first strip legacy emoji (cleanSysText),
// then reverse-resolve params through the template table below and render with t() the same way; show as-is when unresolvable.
//
// The template table must cover every server template (server/src/texts.ts — tests verify this), plus old sentences no longer sent but still stored in the DB.
import { t } from '@/lib/i18n'
import { GIFT_NAMES } from '@/components/gifts/GiftIcon'

export type TplParams = Record<string, string | number>
export interface ParsedText { key: string; params: TplParams }

/** Templates currently used by the server (notifications / pushes / group system messages), one-to-one with server/src/texts.ts */
export const CURRENT_TEMPLATES = [
  // Notification center (also the push body)
  '{name} 给你发送了消息',
  '你关注的 {name} 开播了：{title}',
  '你关注的 {name} 开播了（付费直播）：{title}',
  '你的直播「{title}」已被平台关闭：{reason}',
  '你的会议「{title}」已被平台关闭：{reason}',
  '有人在「{group}」里 @ 了你',
  '有人在群里 @ 了你',
  '「{group}」的群主 @ 了所有人',
  '群主在群里 @ 了所有人',
  '{name} 回关了你，你们成为好友，可以私聊了',
  '你和 {name} 成为好友，可以私聊了',
  '{name} 关注了你，回关即成为好友',
  '{name} 评论了你的动态：{text}',
  '你的一条动态违反社区规范，已被删除',
  '你的一条评论违反社区规范，已被删除',
  '{name} 送给 {to} 一个{gift}',
  '{name} 送给 {to} 一个{gift}：{msg}',
  '{name} 送给 {to} {n} 个{gift}',
  '{name} 送给 {to} {n} 个{gift}：{msg}',
  '{name} 转给你 ${amount}',
  '{name} 转给你 ${amount}：{note}',
  '你因持仓不再满足门槛被移出「{group}」',
  '{name} 申请加入「{group}」',
  '你加入「{group}」的申请已通过',
  '你加入「{group}」的申请未通过',
  '你的账号因违反社区规范被限制，目前只能浏览。如有异议请在「我 → 联系客服」申诉',
  '你的账号限制已解除',
  '你的账号刚在一台新电脑上登录（{device}，北京时间 {time}）。不是你本人操作的话，点这里让它下线',
  '你已被指定为官方社区「{group}」的群主',
  '官方社区「{group}」的群主已由平台更换',
  '你的群「{group}」已被认证为官方社区',
  '客服回复了你的工单「{title}」',
  '你的工单「{title}」已解决',
  '你的工单「{title}」已关闭',
  // Per-trade sprite contract confirmations (2026-09-28): request confirm, auth mismatch, approved but never ordered
  '小精灵 {name} 想开多 {coin}（保证金 ${margin}，{lev} 倍），请在 10 分钟内确认',
  '小精灵 {name} 想开空 {coin}（保证金 ${margin}，{lev} 倍），请在 10 分钟内确认',
  '小精灵 {name} 想平多 {coin}（保证金 ${margin}，{lev} 倍），请在 10 分钟内确认',
  '小精灵 {name} 想平空 {coin}（保证金 ${margin}，{lev} 倍），请在 10 分钟内确认',
  '小精灵 {name} 的合约授权没有通过核对，请在「交易方式」里重新授权',
  '小精灵 {name} 没有执行你确认的交易：价格已经变化',
  '小精灵 {name} 没有执行你确认的交易：确认已过期',
  '小精灵 {name} 没有执行你确认的交易：交易所没有接受这笔订单',
  '小精灵 {name} 没有执行你确认的交易：下单前条件不满足，这笔没有下单',
  '{name} 在你离开时提了 {n} 次交易申请',
  '没有收到小精灵 {name} 这笔确认交易的执行结果，请在「合约」页核对持仓',
  // Push only — never enters the notification center
  '{name} 发了新动态：{text}',
  '{name} 发了图片',
  '{name} 赞了你的评论',
  '{name} 赞了你的动态',
  '{name} 开仓 {symbol}',
  '{name} 买入了 {symbol}',
  '{name} 邀请你视频通话',
  '{name} 邀请你语音通话',
  '0x4 官方：{text}',
  // Group system messages
  '管理员设置了进群门槛：持有「{symbol}」',
  '管理员设置了进群门槛：持有「{symbol}」{n} 个',
  '管理员设置了进群门槛：持有 {n} {symbol}',
  '管理员取消了进群门槛',
  '持仓复核：{n} 位成员不再满足门槛，已移出',
  '{name} 加入了群',
  '{name} 已被移出群',
  '{name} 已被封禁',
  '{from} 打赏了 {to} {amount} {symbol}',
  '{from} 打赏了 {to} {amount} {symbol}：{msg}',
  '{name} 发了一个红包',
  '{name} 发了一个红包：{msg}',
  '{name} 领到了 {amount} {symbol}',
  '{name} 领到了 {amount} {symbol}，红包已领完',
  '红包已过期，剩余 {amount} {symbol} 已退回',
  '{name} 发了一个 ${amount} 的余额红包',
  '{name} 领到了 ${amount}',
  '余额红包过期，剩余 ${amount} 已退回',
  '信号：{symbol} 1 小时 {change}%，现价 ${price}，24h 成交 ${vol}K',
  'AI 助手还没配置（服务器缺少 ANTHROPIC_API_KEY）',
  'AI：{answer}',
  'AI 暂时不可用：{error}',
  '发起了投票：{question}',
  '群名已改为「{name}」',
  '群公告已更新',
  '群公告已删除',
  '已开启全体禁言，只有群主和管理员可以发言',
  '已关闭全体禁言',
  '{name} 已被禁言',
  '{name} 已解除禁言',
  // Group members barred from DMs (2026-09-29)
  '{name} 关闭了群成员私信',
  '{name} 开启了群成员私信',
  '原群主已注销账号，{name} 成为新群主',
  '{name} 发起了群会议',
]

/** Old sentences the server no longer sends but the DB still holds */
export const LEGACY_TEMPLATES = [
  '{name} 给你发了一条加密私信',
  '{name} 给你发来新消息',
  '{name} 在群里 @ 了你：{text}',
  '{name} 关注了你',
]

/** Old sentences are re-rendered with new templates after reverse-resolution (new wording even in Chinese UI). DM reminders were unified on 2026-09-26 */
const LEGACY_ALIAS: Record<string, string> = {
  '{name} 给你发了一条加密私信': '{name} 给你发送了消息',
  '{name} 给你发来新消息': '{name} 给你发送了消息',
}

/** Parameterized server errors (errors carry no key — always reverse-resolved) */
export const ERROR_TEMPLATES = [
  '还没到账（当前 {bal} {symbol}），请稍后再试',
  '余额不足，需要 ${n}',
  '最少提现 ${n}',
  '提现失败：{error}',
  '文件不能超过 {n}MB',
  '最多关联 {n} 个钱包',
  '需要持有 {n} 个「{symbol}」才能加入（当前 {holding} 个）',
  '需要持有 「{symbol}」才能加入（当前 {holding} 个）',
  '需要持有至少 {n} {symbol} 才能加入（当前 {holding}）',
  // Zalien adoption voucher (2026-09-27)
  'Zalien #{n} 不在你的钱包中',
  'Zalien #{n} 已被领养',
  'Zalien #{n} 已被领养，请刷新后重试',
  'Zalien #{n} 的免费领养期已被使用，请刷新后重试',
  'Zalien #{n} 已不在你的钱包中，无法续期',
  '每个账号最多同时领养 {n} 只小精灵',
]

export const ALL_TEMPLATES = [...CURRENT_TEMPLATES, ...LEGACY_TEMPLATES, ...ERROR_TEMPLATES]

// ── Reverse resolution ─────────────────────────────────────────────────────────────
// Numeric params are restricted to numbers, so "{name} transferred ${amount}" can't swallow the note-separator of the with-note variant;
// Token symbol may be empty ("holding 5 " when the threshold has no symbol); other params (nickname, group name, body) accept any characters
const NUM = '[-+]?\\d[\\d,]*(?:\\.\\d+)?(?:e[-+]?\\d+)?'
const PARAM_RE: Record<string, string> = { n: NUM, amount: NUM, bal: NUM, holding: NUM, price: NUM, vol: NUM, change: NUM, symbol: '[\\s\\S]*?' }
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

interface Matcher { key: string; re: RegExp; names: string[]; literal: number }

function compile(key: string): Matcher {
  const names: string[] = []
  let src = ''
  let literal = 0
  let last = 0
  for (const m of key.matchAll(/\{(\w+)\}/g)) {
    const lit = key.slice(last, m.index)
    src += esc(lit)
    literal += lit.length
    names.push(m[1])
    src += `(${PARAM_RE[m[1]] ?? '[\\s\\S]+?'})`
    last = m.index! + m[0].length
  }
  const tail = key.slice(last)
  src += esc(tail)
  literal += tail.length
  return { key, re: new RegExp(`^${src}$`), names, literal }
}

// Try more-literal templates first: the longer follow-template must come before its shorter prefix (otherwise the short one matches first)
const MATCHERS = ALL_TEMPLATES.map(compile).sort((a, b) => b.literal - a.literal || a.names.length - b.names.length)

/** Simplified Chinese sentence → template + params; null when unrecognized */
export function parseServerText(text: string): ParsedText | null {
  for (const m of MATCHERS) {
    const hit = m.re.exec(text)
    if (!hit) continue
    const params: TplParams = {}
    m.names.forEach((n, i) => { params[n] = hit[i + 1] })
    return { key: LEGACY_ALIAS[m.key] ?? m.key, params }
  }
  return null
}

// ── Rendering ────────────────────────────────────────────────────────
/** Old gift names: pre-2026-09-25 names before the meme-edition rename */
const LEGACY_GIFT: Record<string, string> = { 玫瑰: '韭菜', 啤酒: '大阳线' }

/** Only gift names follow the UI language among params; nicknames, group names, and bodies stay as-is */
function localizeParams(params: unknown, giftId?: unknown): TplParams {
  const p: TplParams = {}
  if (params && typeof params === 'object') for (const [k, v] of Object.entries(params)) if (typeof v === 'string' || typeof v === 'number') p[k] = v
  if (typeof p.gift === 'string') {
    const byId = typeof giftId === 'string' ? GIFT_NAMES[giftId] : undefined
    const name = p.gift.replace(LEAD, '')   // The old wording was a gift-rose message
    p.gift = t(byId || LEGACY_GIFT[name] || name)
  }
  return p
}

/**
 * Server dynamic strings are shown in the UI language. Use the key when present; otherwise reverse-resolve text; show as-is (legacy emoji stripped) when neither works.
 * giftId: gift messages in groups carry it in meta; gift names are taken from the frontend's name set by id.
 */
export function renderServerText(text: string, key?: unknown, params?: unknown, giftId?: unknown): string {
  if (typeof key === 'string' && key) return t(key, localizeParams(params, giftId))
  // First reverse-resolve the raw text (don't strip nicknames that start with emoji themselves); if that fails, strip legacy emoji and retry ("📡 signal: …")
  const hit = parseServerText(text)
  if (hit) return t(hit.key, localizeParams(hit.params, giftId))
  const cleaned = cleanSysText(text)
  const again = parseServerText(cleaned)
  return again ? t(again.key, localizeParams(again.params, giftId)) : cleaned
}

/** Group system messages: key / params in meta (since 2026-09-26); old messages only have text */
export function renderSysMessage(m: { text: string; meta?: Record<string, unknown> }): string {
  return renderServerText(m.text, m.meta?.key, m.meta?.params, m.meta?.giftId)
}

/** API errors: fixed sentences go straight through t() (src/locales/parts/server.json); parameterized ones are reverse-resolved first */
export function translateServerError(msg: string): string {
  const hit = parseServerText(msg)
  return hit ? t(hit.key, hit.params) : t(msg)
}

// ── Legacy emoji cleanup ─────────────────────────────────────────────────
// Since 2026-09-25 the server no longer embeds emoji in system strings ("📡", "🤖", "🪰", gift rose),
// and already-stored messages have them stripped at display time so old and new look alike. Only the leading emoji run and the gift emoji right after the measure word are touched —
// body text the user typed themselves is never touched.

const LEAD = /^(?:\p{Extended_Pictographic}\uFE0F?\s*)+/u
const GIFT = /(一个|\d+ 个)\p{Extended_Pictographic}\uFE0F?/u

export function cleanSysText(text: string): string {
  return text.replace(LEAD, '').replace(GIFT, '$1')
}

/** Legacy DM transfer messages were "💸 transfer $1.00"; now only "transfer $1.00" is sent */
export function cleanDmText(text: string): string {
  return text.startsWith('💸 转账 $') ? text.slice(3) : text
}
