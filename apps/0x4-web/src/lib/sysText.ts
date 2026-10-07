// 服务端发来的动态文字：通知中心、群聊系统消息、带参数的报错。
//
// 2026-09-26 起服务端给这些文字附带模板 key（简体原文，比如 '{name} 关注了你，回关即成为好友'）和参数，
// 这里用 t(key, params) 按界面语言渲染。老数据只有渲染好的简体整句：先去掉旧 emoji（cleanSysText），
// 再用下面的模板表反解出参数，同样 t() 渲染；反解不了就原样显示。
//
// 模板表必须覆盖服务端所有模板（server/src/texts.ts，测试会核对），外加已经不再发、但库里还存着的旧句子。
import { t } from '@/lib/i18n'
import { GIFT_NAMES } from '@/components/gifts/GiftIcon'

export type TplParams = Record<string, string | number>
export interface ParsedText { key: string; params: TplParams }

/** 当前服务端在用的模板（通知 / 推送 / 群系统消息），和 server/src/texts.ts 一一对应 */
export const CURRENT_TEMPLATES = [
  // 通知中心（同时是推送正文）
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
  // 小精灵合约逐笔确认（2026-09-28）：申请确认、授权核对不过、批准后没下单
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
  // 只推送、不进通知中心
  '{name} 发了新动态：{text}',
  '{name} 发了图片',
  '{name} 赞了你的评论',
  '{name} 赞了你的动态',
  '{name} 开仓 {symbol}',
  '{name} 买入了 {symbol}',
  '{name} 邀请你视频通话',
  '{name} 邀请你语音通话',
  '0x4 官方：{text}',
  // 群聊系统消息
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
  // 禁止群成员私信（2026-09-29）
  '{name} 关闭了群成员私信',
  '{name} 开启了群成员私信',
  '原群主已注销账号，{name} 成为新群主',
  '{name} 发起了群会议',
]

/** 服务端已经不再发、但库里还有的旧句子 */
export const LEGACY_TEMPLATES = [
  '{name} 给你发了一条加密私信',
  '{name} 给你发来新消息',
  '{name} 在群里 @ 了你：{text}',
  '{name} 关注了你',
]

/** 旧句子反解后改用新模板显示（中文界面也显示新说法）。私信提醒 2026-09-26 统一成「给你发送了消息」 */
const LEGACY_ALIAS: Record<string, string> = {
  '{name} 给你发了一条加密私信': '{name} 给你发送了消息',
  '{name} 给你发来新消息': '{name} 给你发送了消息',
}

/** 服务端报错里带参数的几句（报错没有 key，一律靠反解） */
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
  // Zalien 领养凭证（2026-09-27）
  'Zalien #{n} 不在你的钱包中',
  'Zalien #{n} 已被领养',
  'Zalien #{n} 已被领养，请刷新后重试',
  'Zalien #{n} 的免费领养期已被使用，请刷新后重试',
  'Zalien #{n} 已不在你的钱包中，无法续期',
  '每个账号最多同时领养 {n} 只小精灵',
]

export const ALL_TEMPLATES = [...CURRENT_TEMPLATES, ...LEGACY_TEMPLATES, ...ERROR_TEMPLATES]

// ── 反解 ─────────────────────────────────────────────────────────────
// 数字类参数限定成数字，免得「{name} 转给你 ${amount}」吃掉带附言那句的「：附言」；
// 币种符号可以为空（门槛没填符号时是「持有 5 」）；其余参数（昵称、群名、正文）可以是任意字符
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

// 字面文字多的先试：「{name} 关注了你，回关即成为好友」要排在旧的「{name} 关注了你」前面
const MATCHERS = ALL_TEMPLATES.map(compile).sort((a, b) => b.literal - a.literal || a.names.length - b.names.length)

/** 简体整句 → 模板 + 参数；认不出返回 null */
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

// ── 渲染 ─────────────────────────────────────────────────────────────
/** 旧礼物名：2026-09-25 换成 meme 版之前的名字 */
const LEGACY_GIFT: Record<string, string> = { 玫瑰: '韭菜', 啤酒: '大阳线' }

/** 参数里要跟着界面语言走的只有礼物名；昵称、群名、正文原样 */
function localizeParams(params: unknown, giftId?: unknown): TplParams {
  const p: TplParams = {}
  if (params && typeof params === 'object') for (const [k, v] of Object.entries(params)) if (typeof v === 'string' || typeof v === 'number') p[k] = v
  if (typeof p.gift === 'string') {
    const byId = typeof giftId === 'string' ? GIFT_NAMES[giftId] : undefined
    const name = p.gift.replace(LEAD, '')   // 旧文字是「一个🌹玫瑰」
    p.gift = t(byId || LEGACY_GIFT[name] || name)
  }
  return p
}

/**
 * 服务端动态文字按界面语言显示。有 key 用 key；没有就反解 text；都不行原样显示（去掉旧 emoji）。
 * giftId：群里的送礼消息 meta 带着，礼物名按 id 取前端这套名字
 */
export function renderServerText(text: string, key?: unknown, params?: unknown, giftId?: unknown): string {
  if (typeof key === 'string' && key) return t(key, localizeParams(params, giftId))
  // 先按原文反解（昵称本身以 emoji 开头的别被清掉），不行再去掉旧 emoji 反解（「📡 信号：…」）
  const hit = parseServerText(text)
  if (hit) return t(hit.key, localizeParams(hit.params, giftId))
  const cleaned = cleanSysText(text)
  const again = parseServerText(cleaned)
  return again ? t(again.key, localizeParams(again.params, giftId)) : cleaned
}

/** 群聊系统消息：meta 里带 key / params（2026-09-26 起），老消息只有 text */
export function renderSysMessage(m: { text: string; meta?: Record<string, unknown> }): string {
  return renderServerText(m.text, m.meta?.key, m.meta?.params, m.meta?.giftId)
}

/** 接口报错：固定句子直接 t()（src/locales/parts/server.json），带参数的先反解 */
export function translateServerError(msg: string): string {
  const hit = parseServerText(msg)
  return hit ? t(hit.key, hit.params) : t(msg)
}

// ── 旧 emoji 清理 ────────────────────────────────────────────────────
// 2026-09-25 起服务器不再往系统文字里拼 emoji（「📡 信号」「🤖 AI」「🪰 果蝇」、送礼的「一个🌹玫瑰」），
// 数据库里已存的旧消息显示时也去掉，新旧消息看起来一致。只动开头那串 emoji 和「个」后面紧跟的礼物 emoji，
// 用户自己打的正文不碰。

const LEAD = /^(?:\p{Extended_Pictographic}\uFE0F?\s*)+/u
const GIFT = /(一个|\d+ 个)\p{Extended_Pictographic}\uFE0F?/u

export function cleanSysText(text: string): string {
  return text.replace(LEAD, '').replace(GIFT, '$1')
}

/** 旧版私信转账消息是「💸 转账 $1.00」，现在只发「转账 $1.00」 */
export function cleanDmText(text: string): string {
  return text.startsWith('💸 转账 $') ? text.slice(3) : text
}
