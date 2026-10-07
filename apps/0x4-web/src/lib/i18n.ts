// 多语言（2026-09-25）：简体中文（原文）/ 繁體中文 / English。
//
// 用法：界面文字写成 t('发送')、带变量的写成 t('还有 {n} 个', { n })。
//   · 字典用简体原文当索引（src/locales/en.json 里是 "发送": "Send"），不用给每句话另起代号；
//     查不到翻译就原样显示简体，不会出现空白或代号。
//   · 繁体不存字典：用 OpenCC 按台湾用词即时转换（只有选了繁体才下载那 1.1MB 转换表）。
//   · ⚠️ t() 必须在渲染时调用。写在模块顶层的常量（比如导航标签数组）只存简体原文，渲染时再 t(label)，
//     否则切换语言后它们不会变。
//   · 切换语言时 App 外壳用 key={lang} 整体重挂一次（见 App.tsx），所有页面重新渲染。
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import en from '@/locales/en.json'

export type Lang = 'zh-Hans' | 'zh-Hant' | 'en'
/** auto = 跟随系统语言 */
export type LangSetting = Lang | 'auto'

export const LANG_OPTIONS: { value: LangSetting; label: string }[] = [
  { value: 'auto', label: '跟随系统' },
  { value: 'zh-Hans', label: '简体中文' },
  { value: 'zh-Hant', label: '繁體中文' },
  { value: 'en', label: 'English' },
]

/** 系统语言 → 我们支持的三种之一：港澳台 / Hant 走繁体，其余中文走简体，别的一律英文 */
export function systemLang(list: readonly string[] = typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : []): Lang {
  for (const raw of list) {
    const l = (raw || '').toLowerCase()
    if (!l.startsWith('zh')) continue
    return /hant|-tw|-hk|-mo/.test(l) ? 'zh-Hant' : 'zh-Hans'
  }
  return 'en'
}

const EN = en as Record<string, string>
let toHant: ((s: string) => string) | null = null
const hantCache = new Map<string, string>()

interface LangState {
  setting: LangSetting
  lang: Lang
  /** 繁体转换表加载好了没有（没好之前先显示简体） */
  ready: boolean
  setLang: (s: LangSetting) => void
}

export const useLang = create<LangState>()(
  persist(
    (set) => ({
      setting: 'auto',
      lang: systemLang(),
      ready: true,
      setLang(setting) {
        const lang = setting === 'auto' ? systemLang() : setting
        set({ setting, lang })
        void prepare(lang)
      },
    }),
    {
      name: '0x4.lang',
      partialize: (s) => ({ setting: s.setting }),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        const lang = state.setting === 'auto' ? systemLang() : state.setting
        // ⚠️ 注水在 create() 里同步发生，那一刻 useLang 还没赋值，直接调 prepare / setState 会抛错并被吞掉
        //    （2026-09-25 实测：选了繁体，转换表从没加载）。放到微任务里等 store 建好再做
        queueMicrotask(() => { useLang.setState({ lang }); void prepare(lang) })
      },
    },
  ),
)

/** 选了繁体才去加载 OpenCC（简→台湾繁体，含台湾常用词） */
async function prepare(lang: Lang): Promise<void> {
  if (lang !== 'zh-Hant' || toHant) return
  useLang.setState({ ready: false })
  try {
    const OpenCC = await import('opencc-js/cn2t')
    toHant = OpenCC.Converter({ from: 'cn', to: 'twp' })
  } catch { /* 加载失败就先显示简体 */ }
  useLang.setState({ ready: true })
}

function fill(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

/**
 * 翻译一句界面文字。src 是简体原文。
 * 同一个中文词在不同地方意思不同时，加语境标记：t('开||ohlc')。中文界面只显示 || 前面的「开」，
 * 英文字典里 "开||ohlc": "O"、"开": "Open" 各管各的（查不到带标记的就退回不带标记的）。
 */
export function t(src: string, vars?: Record<string, string | number>): string {
  const { lang } = useLang.getState()
  const bar = src.indexOf('||')
  const base = bar >= 0 ? src.slice(0, bar) : src
  if (lang === 'en') return fill(EN[src] ?? EN[base] ?? base, vars)
  if (lang === 'zh-Hant' && toHant) {
    let h = hantCache.get(base)
    if (h === undefined) { h = toHant(base); hantCache.set(base, h) }
    return fill(h, vars)
  }
  return fill(base, vars)
}


/** 日期 / 数字格式用的地区标签：toLocaleString(locale()) —— 别再写死 'zh-CN'，英文界面会显示「2026年9月」 */
export function locale(): string {
  const { lang } = useLang.getState()
  return lang === 'en' ? 'en-US' : lang === 'zh-Hant' ? 'zh-TW' : 'zh-CN'
}
