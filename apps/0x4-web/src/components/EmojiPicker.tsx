// Emoji panel: shared by DMs / groups / posts / comments. Hand-rolled — no third-party emoji libraries (those drag in hundreds of KB of data).
// All emoji render in system fonts — native Apple emoji on iPhone; only up to Unicode 13, displayable from iOS 14 / Android 11.
// Interaction mirrors WeChat: tap the smiley → keyboard dismisses, panel slides up; tap the input again (or the keyboard button) → panel collapses, keyboard returns.
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

// ---------- Pure functions (unit-tested) ----------

/** Insert an emoji at the [start, end) selection (replaces selected text). Returns null without inserting past maxLength */
export function insertAt(value: string, emoji: string, start: number, end: number = start, maxLength?: number): { value: string; caret: number } | null {
  const s = Math.max(0, Math.min(start, value.length))
  const e = Math.max(s, Math.min(end, value.length))
  const next = value.slice(0, s) + emoji + value.slice(e)
  if (maxLength != null && next.length > maxLength) return null
  return { value: next, caret: s + emoji.length }
}

/** Delete one grapheme before the cursor (one emoji / emoji with variation selector counts as one); with a selection, delete the selection */
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

/** Recently used: newest first, deduped, at most RECENT_MAX */
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
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)) } catch { /* Unwritable in private mode etc. — doesn't affect usage */ }
}

// ---------- Input binding ----------

type Field = HTMLInputElement | HTMLTextAreaElement

/**
 * Attach the emoji panel to an input. The returned fieldProps spread onto the input / textarea (with ref),
 * remembering the cursor position and collapsing the panel when the input is tapped.
 */
export function useEmojiInput<T extends Field>(value: string, setValue: (v: string) => void, maxLength?: number) {
  const ref = useRef<T>(null)
  const [open, setOpen] = useState(false)
  // selectionStart is unreliable after blur in some WebViews — keep our own copy
  const caret = useRef<{ start: number; end: number } | null>(null)
  const remember = useCallback(() => {
    const el = ref.current
    if (el && el.selectionStart != null) caret.current = { start: el.selectionStart, end: el.selectionEnd ?? el.selectionStart }
  }, [])
  const sel = () => caret.current && caret.current.start <= value.length ? caret.current : { start: value.length, end: value.length }

  const toggle = () => {
    const el = ref.current
    if (open) {
      // Collapse the panel, bring the keyboard back, restore the cursor to where the insert happened
      setOpen(false)
      if (el) { el.focus(); const c = sel(); try { el.setSelectionRange(c.start, c.end) } catch { /* Some input types unsupported */ } }
    } else {
      remember()
      el?.blur()   // Dismiss the soft keyboard
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
    // User tapped the input = wants to type: collapse the panel, let the keyboard out
    onFocus: () => setOpen(false),
  }
  /** Collapse panel and keyboard: called after sending and when tapping the chat history area (2026-09-25 goat: the keyboard used to stay up after sending) */
  const dismiss = () => { setOpen(false); ref.current?.blur() }
  return { open, setOpen, toggle, pick, backspace, fieldProps, dismiss }
}

// ---------- Panel ----------

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Segoe UI Symbol", sans-serif'

export default function EmojiPicker({ onPick, onBackspace, className = '' }: { onPick: (emoji: string) => void; onBackspace?: () => void; className?: string }) {
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const cats: Category[] = [{ id: 'recent', label: '最近使用', Icon: Clock, list: recent }, ...EMOJI_CATEGORIES]
  // Land on "Recent" when there's recent usage, otherwise start at smileys
  const [active, setActive] = useState(() => (recent.length ? 0 : 1))
  const pager = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = pager.current
    if (el) el.scrollLeft = active * el.clientWidth
  }, []) // eslint-disable-line react-hooks/exhaustive-deps — only position once on open

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
