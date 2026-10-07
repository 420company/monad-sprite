// 翻译守护（2026-09-29 goat：英文界面里验证身份面板冒出中文）：
// ① 界面文件（src 下所有 .tsx）里，t() / tpl() 之外不许有用户看得见的中文。对照表这类「先写简体、显示时再 t()」的写法
//    要登记在下面的 ALLOW 里并写清原因；新写的界面文字直接包 t()，不要往 ALLOW 里加。
// ② 代码里 t('中文…') 用到的每个键，en.json 都要有英文（带「||语境」的键查不到时退回不带标记的，和 lib/i18n.ts 一致）。
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import en from '@/locales/en.json'

const SRC = join(__dirname, '..')
const HAN = /[一-鿿]/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'locales' && name !== 'node_modules') walk(p, out) }
    // __ 开头的是本地临时预览页（验收截图用，不打包进 App）
    else if (/\.(tsx?|ts)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.startsWith('__')) out.push(p)
  }
  return out
}

interface Lit { start: number; end: number; text: string }
/** 简单词法：去掉注释，记下每个字符串字面量的位置（模板字符串里的 ${} 表达式按代码看） */
function lex(src: string): { code: string; lits: Lit[] } {
  const out = src.split('')
  const lits: Lit[] = []
  let i = 0
  const blank = (a: number, b: number) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' ' }
  const tplStack: number[] = []   // 模板字符串里 ${ 的花括号深度
  let braceDepth = 0
  const readString = (q: string, resume = false) => {
    const s = i; if (!resume) i++
    let text = ''
    while (i < src.length) {
      const c = src[i]
      if (c === '\\') { text += src[i + 1] ?? ''; i += 2; continue }
      if (q === '`' && c === '$' && src[i + 1] === '{') { lits.push({ start: s, end: i, text }); tplStack.push(braceDepth); braceDepth++; i += 2; return }
      if (c === q) { i++; lits.push({ start: s, end: i, text }); return }
      if (c === '\n' && q !== '`') { lits.push({ start: s, end: i, text }); return }
      text += c; i++
    }
  }
  while (i < src.length) {
    const c = src[i], n = src[i + 1]
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; blank(i, end); i = end; continue }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; continue }
    if (c === "'" || c === '"' || c === '`') { readString(c); continue }
    if (c === '{') { braceDepth++; i++; continue }
    if (c === '}') {
      braceDepth--
      if (tplStack.length && tplStack[tplStack.length - 1] === braceDepth) { tplStack.pop(); i++; readString('`', true); continue }
      i++; continue
    }
    i++
  }
  return { code: out.join(''), lits }
}

/** t( / tpl( 调用覆盖的区间（括号配平，跳过字符串） */
function tSpans(code: string, lits: Lit[]): [number, number][] {
  const spans: [number, number][] = []
  const inLit = (p: number) => lits.some((l) => p >= l.start && p < l.end)
  for (const m of code.matchAll(/\b(?:t|tpl)\(/g)) {
    const open = m.index! + m[0].length - 1
    if (inLit(open)) continue
    let depth = 0, k = open
    for (; k < code.length; k++) {
      if (inLit(k)) continue
      if (code[k] === '(') depth++
      else if (code[k] === ')') { depth--; if (depth === 0) break }
    }
    spans.push([open, k])
  }
  return spans
}

/**
 * 允许留在 t() 之外的中文字面量：文件 → { 字面量原文: 原因 }。原因写清楚是「显示时再 t()」「不给用户看」还是「数据 / 协议」。
 * 只收已经核实过的；新写的界面文字请直接包 t()。
 */
const DISPLAY_LATER = '对照表：写简体原文，显示时再 t()'
const ALLOW: Record<string, Record<string, string>> = {
  'src/components/BtcSendForm.tsx': {
    '快': DISPLAY_LATER,
    '约 10 分钟': DISPLAY_LATER,
    '标准': DISPLAY_LATER,
    '约 1 小时': DISPLAY_LATER,
    '省': DISPLAY_LATER,
    '约 1 天': DISPLAY_LATER,
  },
  'src/components/ChatList.tsx': {
    '全部': DISPLAY_LATER,
    '群聊': DISPLAY_LATER,
    '私信': DISPLAY_LATER,
  },
  'src/components/Comments.tsx': {
    '举报评论': '举报工单内容，给客服看，不在 App 里显示',
    '动态：': '举报工单内容，给客服看，不在 App 里显示',
    'n评论：': '举报工单内容，给客服看，不在 App 里显示',
    'n评论者：': '举报工单内容，给客服看，不在 App 里显示',
    'n内容：': '举报工单内容，给客服看，不在 App 里显示',
  },
  'src/components/EmojiPicker.tsx': {
    '笑脸': DISPLAY_LATER,
    '手势与人': DISPLAY_LATER,
    '动物': DISPLAY_LATER,
    '食物': DISPLAY_LATER,
    '活动与物品': DISPLAY_LATER,
    '符号': DISPLAY_LATER,
    '最近使用': DISPLAY_LATER,
  },
  'src/components/FlyHolds.tsx': {
    '拿着': DISPLAY_LATER,
    '已建议出本': DISPLAY_LATER,
    '已出本': DISPLAY_LATER,
    '已卖出': DISPLAY_LATER,
  },
  'src/components/FlySheet.tsx': {
    '保守': DISPLAY_LATER,
    '信号足够强时才交易': DISPLAY_LATER,
    '均衡': DISPLAY_LATER,
    '兼顾信号强度与交易频率': DISPLAY_LATER,
    '激进': DISPLAY_LATER,
    '信号较弱时也会交易，交易更频繁': DISPLAY_LATER,
    '余额不足': '判断报错 / 消息里有没有这几个字（逻辑用，不显示）',
    '自己选': DISPLAY_LATER,
    '自动找币': DISPLAY_LATER,
    '热门': DISPLAY_LATER,
    '最新': DISPLAY_LATER,
    '两者': DISPLAY_LATER,
    '资金费率': DISPLAY_LATER,
    '多空双方的资金成本': DISPLAY_LATER,
    '持仓量': DISPLAY_LATER,
    '市场整体仓位的增减': DISPLAY_LATER,
  },
  'src/components/FlyTradeSettings.tsx': {
    '快进快出': DISPLAY_LATER,
    '小精灵自己判断什么时候卖': DISPLAY_LATER,
    '翻倍出本': DISPLAY_LATER,
    '买入后交给你；涨到 2 倍时建议卖一半拿回本金，剩下的继续拿着': DISPLAY_LATER,
    '钻石手': DISPLAY_LATER,
    '买入后交给你，只提醒，永远不替你卖': DISPLAY_LATER,
  },
  'src/components/GiftSheet.tsx': {
    '余额': '判断报错 / 消息里有没有这几个字（逻辑用，不显示）',
  },
  'src/components/Guide.tsx': {
    '发现 → 冲': DISPLAY_LATER,
    '发现页看热门榜，粘贴合约地址就能加自选。任何链的币都可以用你钱包里任意资产直接买。': DISPLAY_LATER,
    '交易即社交': DISPLAY_LATER,
    '每笔买卖会自动变成动态，关注厉害的交易者，看排行榜和社区战绩，好友流里跟着冲。': DISPLAY_LATER,
    '聊天、开播、PK': DISPLAY_LATER,
    '每个币都有一间房。开直播和别的主播 PK，或者开个会面对面聊。私钥只在你手机里。': DISPLAY_LATER,
  },
  'src/components/Layout.tsx': {
    '资产': DISPLAY_LATER,
    '发现': DISPLAY_LATER,
    '社区': DISPLAY_LATER,
    '直播': DISPLAY_LATER,
    '我': DISPLAY_LATER,
  },
  'src/components/Leaderboard.tsx': {
    '24小时': DISPLAY_LATER,
    '7天': DISPLAY_LATER,
    '30天': DISPLAY_LATER,
    '全部': DISPLAY_LATER,
  },
  'src/components/NotificationSheet.tsx': {
    '私信': DISPLAY_LATER,
    '评论': DISPLAY_LATER,
    '群里 @ 我': DISPLAY_LATER,
    '礼物和红包': DISPLAY_LATER,
    '新粉丝': DISPLAY_LATER,
    '点赞': DISPLAY_LATER,
    '官方公告': DISPLAY_LATER,
    '发帖': DISPLAY_LATER,
    '合约开仓': DISPLAY_LATER,
    '买入代币': DISPLAY_LATER,
    '开播': DISPLAY_LATER,
  },
  // 直播改造（2026-09-30）
  'src/live/PkHost.tsx': {
    '所有人': DISPLAY_LATER,
    '互相关注的人': DISPLAY_LATER,
    '不接收': DISPLAY_LATER,
  },
  'src/live/RankSheet.tsx': {
    'PK 胜场': DISPLAY_LATER,
    '送礼': DISPLAY_LATER,
    '今天': DISPLAY_LATER,
    '本周': DISPLAY_LATER,
  },
  'src/components/PerpChart.tsx': {
    '15分': DISPLAY_LATER,
    '1时': DISPLAY_LATER,
    '4时': DISPLAY_LATER,
    '日': DISPLAY_LATER,
  },
  'src/components/RealModeSheet.tsx': {
    '这是一个生物脑模型的交易实验，不保证盈利，任何模式都可能亏损投入的资金。': DISPLAY_LATER,
    '现货模式下，没有开启全自动时每一笔都由我签名；开启全自动后，BNB Chain 上的买卖按我设定的每日额度自动执行。平台不保管我的资产；合约模式下资金在我自己的合约账户，我授权的交易密钥不能提币。': DISPLAY_LATER,
    '本功能不构成投资建议，盈亏自负。': DISPLAY_LATER,
    '现货交易': DISPLAY_LATER,
    '合约交易': DISPLAY_LATER,
  },
  'src/components/ReceiveSheet.tsx': {
    '适用于 BNB Chain、Ethereum、Base、Arbitrum 等 EVM 网络': DISPLAY_LATER,
    '仅适用于 Solana 网络': DISPLAY_LATER,
    '仅适用于比特币网络': DISPLAY_LATER,
  },
  'src/components/RedPacketSheet.tsx': {
    '余额不足': '判断报错 / 消息里有没有这几个字（逻辑用，不显示）',
  },
  'src/components/TransferSheet.tsx': {
    '余额不足': '判断报错 / 消息里有没有这几个字（逻辑用，不显示）',
  },
  'src/components/gifts/GiftIcon.tsx': {
    '韭菜': DISPLAY_LATER,
    '大阳线': DISPLAY_LATER,
    '冲': DISPLAY_LATER,
    '火箭': DISPLAY_LATER,
    '登月': DISPLAY_LATER,
    '钻石手': DISPLAY_LATER,
    '巨鲸': DISPLAY_LATER,
    '兰博': DISPLAY_LATER,
    '礼物': DISPLAY_LATER,
    '个': '解析旧礼物消息时定位礼物名用（逻辑用，不显示）',
  },
  'src/pages/Activity.tsx': {
    '全部': DISPLAY_LATER,
  },
  'src/pages/Discover.tsx': {
    '全部': DISPLAY_LATER,
  },
  'src/pages/DmChat.tsx': {
    '转账 $': '转账后自动发的私信正文（存成消息内容给对方看）；改成按语言显示需要调整消息格式，已列入建议',
  },
  'src/pages/FlyDetail.tsx': {
    '合约自动下单暂停维护中，只记录信号不下单': DISPLAY_LATER,
    '合约授权没有通过核对，请在「交易方式」里重新授权，现在只记录信号不下单': DISPLAY_LATER,
    '正在核对合约授权，核对完成前只记录信号不下单': DISPLAY_LATER,
    '小精灵已经不在合约模式，这一单没有下': DISPLAY_LATER,
    '小精灵已暂停，这一单没有下': DISPLAY_LATER,
    '小精灵已到期，这一单没有下': DISPLAY_LATER,
    '服务器没有放行这一单，没有下单': DISPLAY_LATER,
    '暂时无法向服务器确认能否下单，这一轮不下单': DISPLAY_LATER,
    '余额不足': '判断报错 / 消息里有没有这几个字（逻辑用，不显示）',
    '现在': DISPLAY_LATER,
    '交易||tab': DISPLAY_LATER,
    '风控': DISPLAY_LATER,
    '数据': DISPLAY_LATER,
  },
  'src/pages/FlyWatch.tsx': {
    '教堂': '中英对照表，按语言直接取对应列',
    '房间': '中英对照表，按语言直接取对应列',
    '派对广场': '中英对照表，按语言直接取对应列',
  },
  'src/pages/GroupChat.tsx': {
    '@所有人': '群聊 @全体 的协议字样，服务器按它识别，显示给用户时也作为消息原文',
    '10 分钟': DISPLAY_LATER,
    '1 小时': DISPLAY_LATER,
    '1 天': DISPLAY_LATER,
    '7 天': DISPLAY_LATER,
    '永久': DISPLAY_LATER,
    ' 发了': '从服务器消息里取发红包的人名（逻辑用，不显示）',
  },
  'src/pages/Perp.tsx': {
    '多': '合约成交记成动态时的名字（存进数据给所有人看）；改成按语言显示需要调整数据格式，已列入建议',
    '空': '合约成交记成动态时的名字（存进数据给所有人看）；改成按语言显示需要调整数据格式，已列入建议',
    ' 永续 · 开': '合约成交记成动态时的名字（存进数据给所有人看）；改成按语言显示需要调整数据格式，已列入建议',
    ' 永续 · 平': '合约成交记成动态时的名字（存进数据给所有人看）；改成按语言显示需要调整数据格式，已列入建议',
  },
  // 电脑端合约终端记成交动态，和手机合约页同一格式（同上理由）
  'src/desktop/pages/PerpTerminal.tsx': {
    '多': '合约成交记成动态时的名字（存进数据给所有人看），和手机合约页同一格式',
    '空': '合约成交记成动态时的名字（存进数据给所有人看），和手机合约页同一格式',
    ' 永续 · 开': '合约成交记成动态时的名字（存进数据给所有人看），和手机合约页同一格式',
    ' 永续 · 平': '合约成交记成动态时的名字（存进数据给所有人看），和手机合约页同一格式',
  },
  'src/pages/Profile.tsx': {
    '7天': DISPLAY_LATER,
    '30天': DISPLAY_LATER,
    '全部': DISPLAY_LATER,
    '动态': DISPLAY_LATER,
    '交易': DISPLAY_LATER,
    '持仓': DISPLAY_LATER,
    '买入': DISPLAY_LATER,
    '卖出': DISPLAY_LATER,
    '已平仓': DISPLAY_LATER,
  },
  'src/pages/Room.tsx': {
    // 2026-09-30 随机视频下线，举报原因表一起删了
    '门票': '判断报错 / 消息里有没有这几个字（逻辑用，不显示）',
    '移出': '服务器报错原文，只用来判断是哪种情况，不显示',
    '无法进入这个直播间': '服务器报错原文，只用来判断是哪种情况，不显示',
    '你已被移出这场直播': '服务器报错原文，只用来判断是哪种情况，不显示',
    '房间已结束': '服务器报错原文，只用来判断是哪种情况，不显示',
  },
  'src/pages/Settings.tsx': {
    '关注': DISPLAY_LATER,
    '粉丝': DISPLAY_LATER,
    '帖子': DISPLAY_LATER,
    '语言 / Language': '语言切换入口刻意中英双语，任何语言下都认得出',
    '跟随系统 / System': '语言切换入口刻意中英双语，任何语言下都认得出',
  },
  'src/pages/Support.tsx': {
    '账户': DISPLAY_LATER,
    '充值提现': DISPLAY_LATER,
    '交易': DISPLAY_LATER,
    '举报': DISPLAY_LATER,
    '其他': DISPLAY_LATER,
    '待客服处理': DISPLAY_LATER,
    '客服已回复': DISPLAY_LATER,
    '已解决': DISPLAY_LATER,
    '已关闭': DISPLAY_LATER,
  },
  'src/pages/Swap.tsx': {
    '进行中': DISPLAY_LATER,
    '已完成': DISPLAY_LATER,
    '失败': DISPLAY_LATER,
  },
}

function violations() {
  const out: { file: string; line: number; text: string }[] = []
  for (const f of walk(SRC).filter((p) => p.endsWith('.tsx'))) {
    const rel = relative(join(SRC, '..'), f)
    const src = readFileSync(f, 'utf8')
    const { code, lits } = lex(src)
    const spans = tSpans(code, lits)
    const allow = ALLOW[rel] || {}
    const lineOf = (p: number) => src.slice(0, p).split('\n').length
    for (const l of lits) {
      // 着色器源码（GLSL）写在模板字符串里，里面的 // 注释不显示给用户
      const text = /gl_FragColor|precision\s+\w+p\s+float/.test(l.text) ? l.text.replace(/\/\/[^\n]*/g, '') : l.text
      if (!HAN.test(text)) continue
      if (spans.some(([a, b]) => l.start > a && l.start < b)) continue
      if (l.text in allow) continue
      out.push({ file: rel, line: lineOf(l.start), text: l.text })
    }
    // 字符串和注释都去掉之后还剩中文 = JSX 里直接写的文字
    let bare = code.split('')
    for (const l of lits) for (let k = l.start; k < l.end; k++) if (bare[k] !== '\n') bare[k] = ' '
    const rest = bare.join('')
    for (const m of rest.matchAll(/[一-鿿][^<>{}\n]*/g)) {
      const text = m[0].trim()
      if (text in allow) continue
      out.push({ file: rel, line: lineOf(m.index!), text })
    }
  }
  return out
}

describe('翻译守护', () => {
  it('界面里没有 t() 之外的中文（对照表登记在 ALLOW 并写明原因）', () => {
    const v = violations().map((x) => `${x.file}:${x.line} ${x.text}`)
    // 排查时：I18N_GUARD_DUMP=文件路径 npx vitest run src/lib/i18nGuard.test.ts，完整清单写到那个文件
    if (process.env.I18N_GUARD_DUMP) writeFileSync(process.env.I18N_GUARD_DUMP, v.join('\n'))
    expect(v).toEqual([])
  })

  it('允许清单里「显示时再 t()」的对照表词条，en.json 都有英文', () => {
    const EN = en as Record<string, string>
    const missing = Object.entries(ALLOW).flatMap(([f, m]) => Object.entries(m).filter(([k, why]) => why === DISPLAY_LATER && EN[k] === undefined && EN[k.split('||')[0]] === undefined).map(([k]) => `${f}: ${k}`))
    expect(missing).toEqual([])
  })

  it('代码里 t() 用到的中文键在 en.json 都有英文', () => {
    const EN = en as Record<string, string>
    const missing: string[] = []
    for (const f of walk(SRC)) {
      const { code, lits } = lex(readFileSync(f, 'utf8'))
      for (const m of code.matchAll(/\bt\(\s*/g)) {
        const p = m.index! + m[0].length
        const l = lits.find((x) => x.start === p)
        if (!l || !HAN.test(l.text)) continue
        const after = code.slice(l.end).trimStart()[0]
        if (after !== ',' && after !== ')') continue   // t('…' + x) 这类拼接不是固定键
        const base = l.text.split('||')[0]
        if (EN[l.text] === undefined && EN[base] === undefined) missing.push(`${relative(SRC, f)}: ${l.text}`)
      }
    }
    expect([...new Set(missing)]).toEqual([])
  })
})

export { DISPLAY_LATER }
