// 表情面板：私聊 / 群聊 / 发帖 / 评论共用。自己写，不引第三方表情库（那些动辄几百 KB 数据）。
// 表情全部用系统字体渲染，iPhone 上就是苹果原生表情；只收 Unicode 13 以内的，iOS 14 / Android 11 起都能显示。
// 交互照微信：点笑脸按钮 → 键盘收起、面板顶上来；再点输入框（或点键盘按钮）→ 面板收起、键盘回来。
import { useCallback, useEffect, useRef, useState } from 'react'
import { Apple, Clock, Delete, Hand, Lightbulb, PawPrint, Smile, Heart, type LucideIcon } from 'lucide-react'
import { t } from '@/lib/i18n'

export const RECENT_KEY = '0x4.recentEmoji'
export const RECENT_MAX = 24

interface Category { id: string; label: string; Icon: LucideIcon; list: string[] }

const split = (s: string) => s.trim().split(/\s+/)

export const EMOJI_CATEGORIES: Category[] = [
  { id: 'smileys', label: '笑脸', Icon: Smile, list: split(`
    😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤨 😐
    😶 😏 😒 🙄 😬 😌 😔 🤤 😴 😷 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😲 😳 🥺
    😨 😰 😥 😢 😭 😱 😞 😩 🥱 😤 😡 🤬 😈 💀 💩 🤡 👻 👽 🤖 🙈 🙉 🙊`) },
  { id: 'people', label: '手势与人', Icon: Hand, list: split(`
    👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅
    💪 🦾 👀 🧠 👄 👶 🧒 👦 👧 🧑 👱 👨 👩 🧔 👴 👵 🙋 🙆 🙅 🤷 🤦 🙇 💁 🕺 💃 👯 🏃 🚶`) },
  { id: 'animals', label: '动物', Icon: PawPrint, list: split(`
    🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞
    🐜 🐢 🐍 🦎 🐙 🦑 🦐 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🦓 🦍 🐘 🦒 🦘 🐂 🐎 🐖 🐑 🐐 🦌 🐕 🐈 🐓 🦜
    🦢 🐇 🦔 🐾 🌵 🌴 🌱 🍀 🌸 🌹 🌻 🍁`) },
  { id: 'food', label: '食物', Icon: Apple, list: split(`
    🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🌶️ 🌽 🥕 🧄 🥔 🥐 🍞 🥖 🧀 🥚 🍳 🥞
    🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🌮 🌯 🥗 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍙 🍚 🍡 🍦 🍰 🎂 🍮 🍭 🍬 🍫 🍿
    🍩 🍪 🥜 🍯 🥛 ☕ 🍵 🧋 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🍾 🧊`) },
  { id: 'objects', label: '活动与物品', Icon: Lightbulb, list: split(`
    ⚽ 🏀 🏈 ⚾ 🎾 🏐 🏓 🏸 🥊 ⛳ 🎣 🏆 🥇 🥈 🥉 🏅 🎮 🕹️ 🎲 🎯 🎳 🎸 🎹 🎤 🎧 🎬 🎨 🎉 🎊 🎈 🎁 🧧
    🚀 ✈️ 🚗 🏎️ 🚲 ⛵ 🏠 🏝️ 🌋 🎡 📱 💻 ⌚ 📷 🔋 💡 📚 ✏️ 📌 📎 🔑 🔒 🔨 💣 💊 💰 💵 💸 💎 🪙 📈 📉
    📊 ⏰ ⌛ 🔔 📢`) },
  { id: 'symbols', label: '符号', Icon: Heart, list: split(`
    ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 💢 💥 💫 💦 💨 💬 💭 💤 ✨ ⭐ 🌟 ⚡ 🔥
    🌈 ☀️ 🌙 ❄️ ✅ ✔️ ❌ ➕ ➖ ❗ ❓ ‼️ ⁉️ ⚠️ 🚫 ⛔ 🔞 ♻️ 🆗 🆒 🆕 🆙 🔝 🔜 🆘 ⬆️ ⬇️ ➡️ ⬅️ 🔴 🟠 🟡
    🟢 🔵 🟣 ⚫ ⚪`) },
]

// ---------- 纯函数（有单测） ----------

/** 在 [start, end) 选区处插入表情（有选中文字就替换掉）。超过 maxLength 返回 null，不插 */
export function insertAt(value: string, emoji: string, start: number, end: number = start, maxLength?: number): { value: string; caret: number } | null {
  const s = Math.max(0, Math.min(start, value.length))
  const e = Math.max(s, Math.min(end, value.length))
  const next = value.slice(0, s) + emoji + value.slice(e)
  if (maxLength != null && next.length > maxLength) return null
  return { value: next, caret: s + emoji.length }
}

/** 删掉光标前一个字（按字形算，一个表情 / 带变体符的表情算一个）；有选区就删选区 */
export function deleteBefore(value: string, start: number, end: number = start): { value: string; caret: number } {
  const s = Math.max(0, Math.min(start, value.length))
  const e = Math.max(s, Math.min(end, value.length))
  if (e > s) return { value: value.slice(0, s) + value.slice(e), caret: s }
  if (s === 0) return { value, caret: 0 }
  const head = value.slice(0, s)
  let last = ''
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    for (const seg of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(head)) last = seg.segment
  } else last = Array.from(head).at(-1) || ''
  return { value: head.slice(0, head.length - last.length) + value.slice(s), caret: s - last.length }
}

/** 最近使用：新的排最前、去重、最多 RECENT_MAX 个 */
export function pushRecent(list: string[], emoji: string, max = RECENT_MAX): string[] {
  return [emoji, ...list.filter((x) => x !== emoji)].slice(0, max)
}

export function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : []
  } catch { return [] }
}

function saveRecent(list: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)) } catch { /* 隐私模式等写不进去，不影响使用 */ }
}

// ---------- 输入框绑定 ----------

type Field = HTMLInputElement | HTMLTextAreaElement

/**
 * 把表情面板接到一个输入框上。返回的 fieldProps 展开到 input / textarea 上（带 ref），
 * 负责记住光标位置、点输入框时收起面板。
 */
export function useEmojiInput<T extends Field>(value: string, setValue: (v: string) => void, maxLength?: number) {
  const ref = useRef<T>(null)
  const [open, setOpen] = useState(false)
  // 失焦后 selectionStart 在部分 WebView 上不可靠，自己记一份
  const caret = useRef<{ start: number; end: number } | null>(null)
  const remember = useCallback(() => {
    const el = ref.current
    if (el && el.selectionStart != null) caret.current = { start: el.selectionStart, end: el.selectionEnd ?? el.selectionStart }
  }, [])
  const sel = () => caret.current && caret.current.start <= value.length ? caret.current : { start: value.length, end: value.length }

  const toggle = () => {
    const el = ref.current
    if (open) {
      // 收起面板、键盘回来，光标放回刚才插入的位置
      setOpen(false)
      if (el) { el.focus(); const c = sel(); try { el.setSelectionRange(c.start, c.end) } catch { /* 个别输入类型不支持 */ } }
    } else {
      remember()
      el?.blur()   // 收起软键盘
      setOpen(true)
    }
  }
  const pick = (emoji: string) => {
    const c = sel()
    const r = insertAt(value, emoji, c.start, c.end, maxLength)
    if (!r) return
    setValue(r.value)
    caret.current = { start: r.caret, end: r.caret }
  }
  const backspace = () => {
    const c = sel()
    const r = deleteBefore(value, c.start, c.end)
    setValue(r.value)
    caret.current = { start: r.caret, end: r.caret }
  }
  const fieldProps = {
    ref,
    onSelect: remember,
    onBlur: remember,
    // 用户点输入框 = 要打字：面板收起，让键盘出来
    onFocus: () => setOpen(false),
  }
  /** 收起面板和键盘：发送后、点聊天记录区域时调用（2026-09-25 goat：发完消息键盘不收回） */
  const dismiss = () => { setOpen(false); ref.current?.blur() }
  return { open, setOpen, toggle, pick, backspace, fieldProps, dismiss }
}

// ---------- 面板 ----------

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Segoe UI Symbol", sans-serif'

export default function EmojiPicker({ onPick, onBackspace, className = '' }: { onPick: (emoji: string) => void; onBackspace?: () => void; className?: string }) {
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const cats: Category[] = [{ id: 'recent', label: '最近使用', Icon: Clock, list: recent }, ...EMOJI_CATEGORIES]
  // 有最近使用就停在「最近」，没有就从笑脸开始
  const [active, setActive] = useState(() => (recent.length ? 0 : 1))
  const pager = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = pager.current
    if (el) el.scrollLeft = active * el.clientWidth
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- 只在打开时定位一次

  const go = (i: number) => {
    const el = pager.current
    if (!el) return
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({ left: i * el.clientWidth, behavior: smooth ? 'smooth' : 'auto' })
    setActive(i)
  }
  const onScroll = () => {
    const el = pager.current
    if (!el || !el.clientWidth) return
    const i = Math.round(el.scrollLeft / el.clientWidth)
    if (i !== active) setActive(i)
  }
  const pick = (e: string) => {
    onPick(e)
    const next = pushRecent(recent, e)
    setRecent(next)
    saveRecent(next)
  }

  return (
    <div className={`select-none ${className}`} role="group" aria-label={t('表情')}>
      <div ref={pager} onScroll={onScroll} className="no-scrollbar flex h-[216px] snap-x snap-mandatory overflow-x-auto overscroll-x-contain">
        {cats.map((c) => (
          <section key={c.id} className="h-full w-full shrink-0 snap-start snap-always overflow-y-auto overscroll-y-contain px-1.5 pb-2" aria-label={t(c.label)}>
            <div className="px-1.5 pb-1 pt-2 text-[11px] font-medium text-muted">{t(c.label)}</div>
            {c.list.length ? (
              <div className="grid grid-cols-8 gap-0.5">
                {c.list.map((e) => (
                  <button key={e} type="button" onClick={() => pick(e)} aria-label={e}
                    className="flex aspect-square items-center justify-center rounded-lg text-[26px] leading-none transition-transform active:scale-90 active:bg-card2"
                    style={{ fontFamily: EMOJI_FONT }}>{e}</button>
                ))}
              </div>
            ) : <div className="flex h-32 items-center justify-center text-xs text-muted">{t('用过的表情会出现在这里')}</div>}
          </section>
        ))}
      </div>
      <div className="flex items-center gap-0.5 border-t border-line px-1.5 pt-1" role="tablist" aria-label={t('表情分类')}>
        {cats.map((c, i) => (
          <button key={c.id} type="button" role="tab" aria-selected={active === i} aria-label={t(c.label)} title={t(c.label)} onClick={() => go(i)}
            className={`flex h-9 flex-1 items-center justify-center rounded-lg transition-colors ${active === i ? 'bg-card2 text-fg' : 'text-muted'}`}>
            <c.Icon size={18} strokeWidth={active === i ? 2.2 : 1.8} />
          </button>
        ))}
        {onBackspace && (
          <button type="button" onClick={onBackspace} aria-label={t('删除')} title={t('删除')} className="flex h-9 flex-1 items-center justify-center rounded-lg text-muted active:bg-card2">
            <Delete size={19} strokeWidth={1.8} />
          </button>
        )}
      </div>
    </div>
  )
}
