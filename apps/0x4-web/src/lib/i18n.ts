// Multi-language (2026-09-25): Simplified Chinese (source) / Traditional Chinese / English.
//
// Usage: UI strings as t('send'), with variables as t('n left: {n}', { n }).
//   - Dictionaries key off the Simplified source text (src/locales/en.json has "send": "Send") — no separate message IDs;
//     missing translations fall back to the Simplified original — never blank, never an ID.
//   - Traditional has no dictionary: converted on the fly with OpenCC using Taiwan wording (the 1.1MB table downloads only when Traditional is selected).
//   - ⚠️ t() must be called at render time. Module-level constants (e.g. nav label arrays) store only the Simplified source; t(label) at render,
//     otherwise they won't change on language switch.
//   - On language switch the app shell remounts wholesale via key={lang} (see App.tsx), re-rendering every page.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import en from '@/locales/en.json'

export type Lang = 'zh-Hans' | 'zh-Hant' | 'en'
/** auto = follow the system language */
export type LangSetting = Lang | 'auto'

export const LANG_OPTIONS: { value: LangSetting; label: string }[] = [
  { value: 'auto', label: '跟随系统' },
  { value: 'zh-Hans', label: '简体中文' },
  { value: 'zh-Hant', label: '繁體中文' },
  { value: 'en', label: 'English' },
]

/** System language → one of our three: HK/MO/TW / Hant → Traditional, other Chinese → Simplified, everything else → English */
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
  /** Whether the Traditional conversion table has loaded (Simplified shown until then) */
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
        // ⚠️ Hydration happens synchronously inside create(); useLang isn't assigned yet at that moment — calling prepare / setState directly throws and gets swallowed
        //    (verified 2026-09-25: selecting Traditional never loaded the table). Deferred to a microtask so the store exists first
        queueMicrotask(() => { useLang.setState({ lang }); void prepare(lang) })
      },
    },
  ),
)

/** Load OpenCC only when Traditional is selected (Simplified → Taiwan Traditional, Taiwan wording included) */
async function prepare(lang: Lang): Promise<void> {
  if (lang !== 'zh-Hant' || toHant) return
  useLang.setState({ ready: false })
  try {
    const OpenCC = await import('opencc-js/cn2t')
    toHant = OpenCC.Converter({ from: 'cn', to: 'twp' })
  } catch { /* Show Simplified first when loading fails */ }
  useLang.setState({ ready: true })
}

function fill(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

/**
 * Translate one UI string. src is the Simplified source text.
 * When the same Chinese word means different things in different places, add a context tag: t('open||ohlc').
 * The Chinese UI shows only "open" (before ||); the English dictionary keeps "open||ohlc": "O" and "open": "Open"
 * separate (falls back to the untagged key when the tagged one is missing).
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


/** Locale tag for date/number formatting: toLocaleString(locale()) — never hardcode 'zh-CN' again, or the English UI renders dates in Chinese format */
export function locale(): string {
  const { lang } = useLang.getState()
  return lang === 'en' ? 'en-US' : lang === 'zh-Hant' ? 'zh-TW' : 'zh-CN'
}
