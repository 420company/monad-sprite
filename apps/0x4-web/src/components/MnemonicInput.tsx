// Mnemonic grid input: one word per cell — no more dropped words or stray spaces from typing the whole string.
// Pasting the whole string auto-distributes into cells and switches 12 / 24 by word count.
import { useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { isMnemonicWord, MNEMONIC_LENGTHS, suggestMnemonicWords } from '@/lib/wallet'
import { t } from '@/lib/i18n'

const MAX = 24
const TOGGLES = [12, 24]

function splitWords(text: string): string[] {
  return text.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

export default function MnemonicInput({ onChange }: { onChange: (mnemonic: string, complete: boolean) => void }) {
  const [words, setWords] = useState<string[]>(() => Array(MAX).fill(''))
  const [count, setCount] = useState(12)
  const [show, setShow] = useState(true)
  const [focused, setFocused] = useState(-1)
  const inputs = useRef<(HTMLInputElement | null)[]>([])

  function commit(next: string[], n: number) {
    setWords(next)
    setCount(n)
    const used = next.slice(0, n)
    onChange(used.join(' ').trim(), used.every(Boolean))
  }

  function focusAt(i: number) {
    inputs.current[i]?.focus()
    inputs.current[i]?.select()
  }

  // Multi-word write: a whole string starting at the first cell sets the cell count by its own length; mid-way pastes only overwrite following cells
  function fill(parts: string[], from: number) {
    const next = [...words]
    for (let i = 0; i < parts.length && from + i < MAX; i++) next[from + i] = parts[i]
    const end = Math.min(from + parts.length, MAX)
    const n = from === 0 && (MNEMONIC_LENGTHS as readonly number[]).includes(parts.length)
      ? parts.length
      : Math.max(count, (MNEMONIC_LENGTHS as readonly number[]).find((l) => l >= end) ?? MAX)
    commit(next, n)
    focusAt(Math.min(end, n - 1))
  }

  function setWord(i: number, raw: string) {
    const parts = splitWords(raw)
    if (parts.length > 1) { fill(parts, i); return }
    const next = [...words]
    next[i] = parts[0] ?? ''
    commit(next, count)
  }

  const current = focused >= 0 ? words[focused] : ''
  // Leave complete words alone; candidates appear only after two letters typed — otherwise dozens of words flood the screen
  const suggestions = current.length >= 2 && !isMnemonicWord(current) ? suggestMnemonicWords(current) : []
  const lengths = [...new Set([...TOGGLES, count])].sort((a, b) => a - b)

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex gap-1 rounded-lg border border-line bg-card p-1" role="group" aria-label={t('助记词长度')}>
          {lengths.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => commit(words, n)}
              aria-pressed={count === n}
              className={`min-h-9 rounded-md px-3 text-[13px] ${count === n ? 'bg-accent font-medium text-bg' : 'text-muted'}`}
            >
              {t('{n} 个词', { n })}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="icon-button"
          aria-label={show ? t('隐藏助记词') : t('显示助记词')}
          aria-pressed={!show}
          data-tooltip={show ? t('隐藏助记词') : t('显示助记词')}
        >
          {show ? <Eye size={18} /> : <EyeOff size={18} />}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {words.slice(0, count).map((w, i) => (
          <div key={i} className="relative">
            <span className="number pointer-events-none absolute left-2 top-1/2 w-4 -translate-y-1/2 text-right text-xs text-muted">{i + 1}</span>
            <input
              ref={(el) => { inputs.current[i] = el }}
              value={w}
              type="text"
              inputMode="text"
              enterKeyHint={i === count - 1 ? 'done' : 'next'}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              aria-label={t('第 {n} 个单词', { n: i + 1 })}
              aria-invalid={!isMnemonicWord(w) || undefined}
              className={`ui-field min-h-11 py-2 pl-7 pr-2 text-[15px] ${show ? '' : 'field-masked'}`}
              onChange={(e) => setWord(i, e.target.value)}
              onFocus={() => setFocused(i)}
              onBlur={() => setFocused((f) => (f === i ? -1 : f))}
              onPaste={(e) => {
                const parts = splitWords(e.clipboardData.getData('text'))
                if (parts.length < 2) return
                e.preventDefault()
                fill(parts, i)
              }}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault()
                  // Space auto-completes when there's a single candidate — matches hardware-wallet input habits
                  if (suggestions.length === 1) setWord(i, suggestions[0])
                  if (i < count - 1) focusAt(i + 1)
                } else if (e.key === 'Backspace' && !words[i] && i > 0) {
                  e.preventDefault()
                  focusAt(i - 1)
                } else if (e.key === 'ArrowLeft' && i > 0 && e.currentTarget.selectionStart === 0) {
                  focusAt(i - 1)
                } else if (e.key === 'ArrowRight' && i < count - 1 && e.currentTarget.selectionStart === words[i].length) {
                  focusAt(i + 1)
                }
              }}
            />
          </div>
        ))}
      </div>

      <div className="mt-2 flex min-h-9 items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {show && suggestions.map((s) => (
            <button
              key={s}
              type="button"
              // Fill on press: pointerDown beats blur (on touch, mouseDown is too late — candidates vanish with the blur),
              // preventDefault keeps focus in the original cell
              onPointerDown={(e) => {
                e.preventDefault()
                const i = focused
                if (i < 0) return
                setWord(i, s)
                if (i < count - 1) focusAt(i + 1)
              }}
              className="min-h-8 rounded-md border border-line bg-card2 px-2.5 text-[13px]"
            >
              {s}
            </button>
          ))}
        </div>
        {words.slice(0, count).some(Boolean) && (
          <button type="button" className="text-action shrink-0" onClick={() => { commit(Array(MAX).fill(''), count); focusAt(0) }}>{t('清空')}</button>
        )}
      </div>
    </div>
  )
}
