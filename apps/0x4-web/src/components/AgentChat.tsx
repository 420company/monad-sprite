// Sprite AI agent chat — full LLM agent powered by /api/agent (router.ai, 150+ models).
// The agent can chat about anything, trade Monad testnet memecoins, generate images,
// and run code. Write operations return UNSIGNED tx payloads — the user signs in MetaMask.
// Nothing is signed or sent until the user presses Confirm on the card.
import { useEffect, useRef, useState } from 'react'
import { Bot, ExternalLink, Image as ImageIcon, Send } from 'lucide-react'
import type { Hex } from 'viem'
import Button from '@/components/Button'
import { useWallet } from '@/store/wallet'
import { needWallet } from '@/desktop/walletGate'
import { chainById } from '@/lib/chains'
import { errorText } from '@/lib/errors'
import { shortAddr } from '@/lib/format'
import { sendEvmTx } from '@/lib/evm'

/** Hard guard: the agent may only send real transactions on Monad testnet */
const AGENT_CHAIN_ID = 10143
const FAUCET_URL = 'https://faucet.monad.xyz'

/** Rotating status lines while the agent thinks */
const THINKING_LINES = [
  'Thinking…',
  'Checking the chain…',
  'Putting it together…',
]

type TxStatus = 'pending' | 'sending' | 'done' | 'failed' | 'cancelled'

/** Unsigned tx payload from /api/agent */
interface AgentTx {
  to: string
  data: string
  value: string
  description: string
}

interface TxProposal extends AgentTx {
  status: TxStatus
  hash?: Hex
  error?: string
}

interface Msg {
  id: number
  from: 'user' | 'agent'
  text: string
  tone?: 'error'
  tx?: TxProposal
  imageUrl?: string
}

/**
 * Typewriter reveal for the latest agent message — feels alive like a real assistant.
 */
function StreamText({ text, done }: { text: string; done: boolean }) {
  const [shown, setShown] = useState(done ? text.length : 0)
  useEffect(() => {
    if (done) { setShown(text.length); return }
    setShown(0)
    const t = setInterval(() => {
      setShown((n) => {
        if (n >= text.length) { clearInterval(t); return n }
        return n + 3
      })
    }, 12)
    return () => clearInterval(t)
  }, [text, done])
  const partial = text.slice(0, shown)
  return (
    <span>
      {renderRich(partial)}
      {!done && shown < text.length && <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-primary align-middle" />}
    </span>
  )
}

/**
 * Minimal rich-text renderer for agent messages (no deps):
 * **bold**, `code`, and •/- bullet lists. Everything else is escaped plain text.
 */
function renderRich(text: string): React.ReactNode[] {
  const lines = text.split('\n')
  const out: React.ReactNode[] = []
  let list: string[] = []
  const flushList = () => {
    if (list.length) {
      out.push(
        <ul key={`ul-${out.length}`} className="my-1 space-y-0.5">
          {list.map((item, i) => (
            <li key={i} className="flex gap-1.5"><span className="text-primary">•</span><span>{renderInline(item)}</span></li>
          ))}
        </ul>,
      )
      list = []
    }
  }
  lines.forEach((line) => {
    const m = line.match(/^\s*[•\-]\s+(.*)$/)
    if (m) { list.push(m[1]); return }
    flushList()
    if (line.trim() === '') { out.push(<div key={`sp-${out.length}`} className="h-1.5" />); return }
    out.push(<p key={`p-${out.length}`}>{renderInline(line)}</p>)
  })
  flushList()
  return out
}

/** **bold** and `code` within one line */
function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) parts.push(<strong key={k++} className="font-semibold">{tok.slice(2, -2)}</strong>)
    else parts.push(<code key={k++} className="rounded bg-primary/10 px-1 py-0.5 font-mono text-[13px]">{tok.slice(1, -1)}</code>)
    last = m.index + tok.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

const EXAMPLES = [
  'price SPRITE',
  'buy 0.1 MON of SPRITE',
  'draw a cyberpunk cat meme',
  'what can you do?',
]

interface ApiReply {
  reply: string
  tx?: AgentTx | null
  image_url?: string | null
  error?: string
}

export default function AgentChat({ zalienCount }: { zalienCount: number }) {
  const evmAccount = useWallet((s) => s.evmAccount)
  const [msgs, setMsgs] = useState<Msg[]>(() => [
    {
      id: 0,
      from: 'agent',
      text:
        `Hey! Your Zalien${zalienCount > 1 ? `s (${zalienCount} held)` : ''} unlocked me. ` +
        `I'm **Sprite**, your AI agent on Monad testnet.\n\n` +
        `I can trade memecoins, generate images, run code, and chat about anything — ` +
        `just ask. Try **"price SPRITE"** or **"draw me a meme"**.`,
    },
  ])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [thinkLine, setThinkLine] = useState(0)
  const nextId = useRef(1)
  const sendingRef = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)
  // Conversation history sent to the backend (user/assistant only)
  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  // Model selection
  const [models, setModels] = useState<Array<{ id: string; label: string; group: string }>>([])
  const [model, setModel] = useState('claude-sonnet-4-5-20250929')

  const explorer = chainById(AGENT_CHAIN_ID)?.viem?.blockExplorers?.default.url

  // Load available models once
  useEffect(() => {
    fetch('/api/models')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.models)) {
          setModels(d.models.filter((m: { group: string }) => m.group === 'chat'))
          if (d.default) setModel(d.default)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs, thinking])

  useEffect(() => {
    if (!thinking) return
    const t = setInterval(() => setThinkLine((n) => (n + 1) % THINKING_LINES.length), 1200)
    return () => clearInterval(t)
  }, [thinking])

  const push = (m: Omit<Msg, 'id'>) => setMsgs((list) => [...list, { ...m, id: nextId.current++ }])
  const reply = (text: string, tone?: 'error') => push({ from: 'agent', text, tone })
  const patchTx = (id: number, patch: Partial<TxProposal>) =>
    setMsgs((list) => list.map((m) => (m.id === id && m.tx ? { ...m, tx: { ...m.tx, ...patch } } : m)))

  /** Only one open proposal at a time */
  const proposeTx = (text: string, tx: AgentTx) =>
    setMsgs((list) => [
      ...list.map((m) => (m.tx?.status === 'pending' ? { ...m, tx: { ...m.tx, status: 'cancelled' as const } } : m)),
      { id: nextId.current++, from: 'agent', text, tx: { ...tx, status: 'pending' } },
    ])

  const handle = async (line: string) => {
    const text = line.trim()
    if (!text || thinking) return
    setInput('')
    push({ from: 'user', text })
    historyRef.current.push({ role: 'user', content: text })

    setThinking(true)
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: historyRef.current.slice(-20),
          wallet: evmAccount?.address,
          model,
        }),
      })
      const data = (await res.json()) as ApiReply
      if (!res.ok) {
        historyRef.current.pop()
        return reply(`Backend hiccup: ${data.error || res.status}. Try again in a moment.`, 'error')
      }
      historyRef.current.push({ role: 'assistant', content: data.reply })

      if (data.tx) {
        // Agent wants the user to sign a transaction
        proposeTx(
          data.reply || data.tx.description,
          data.tx,
        )
      } else if (data.image_url) {
        push({ from: 'agent', text: data.reply, imageUrl: data.image_url })
      } else {
        reply(data.reply)
      }
    } catch (e) {
      historyRef.current.pop()
      reply(`Couldn't reach the agent: ${e instanceof Error ? e.message.split('\n')[0] : 'network error'}.`, 'error')
    } finally {
      setThinking(false)
    }
  }

  const confirm = async (id: number, tx: TxProposal) => {
    if (tx.status !== 'pending' || sendingRef.current) return
    if (!evmAccount || needWallet()) return
    sendingRef.current = true
    patchTx(id, { status: 'sending' })
    try {
      const hash = await sendEvmTx(evmAccount, AGENT_CHAIN_ID, {
        to: tx.to as Hex,
        data: tx.data as Hex,
        value: tx.value,
      })
      patchTx(id, { status: 'done', hash })
    } catch (e) {
      patchTx(id, { status: 'failed', error: errorText(e, 'Transaction failed') || 'Cancelled in wallet' })
    } finally {
      sendingRef.current = false
    }
  }

  return (
    <div className="flex min-h-[60vh] flex-col rounded-2xl bg-card">
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: '60vh' }} aria-live="polite">
        {msgs.map((m) => (
          <div key={m.id} className={`flex ${m.from === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] space-y-2 ${m.from === 'user' ? '' : 'flex gap-2'}`}>
              {m.from === 'agent' && (
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10" aria-hidden="true">
                  <Bot size={15} className="text-primary" />
                </span>
              )}
              <div className="min-w-0 space-y-2">
                <div
                  className={`break-words rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed shadow-sm ${
                    m.from === 'user' ? 'bg-primary/15 text-fg' : m.tone === 'error' ? 'bg-down/10 text-down' : 'bg-background text-fg'
                  }`}
                >
                  {m.from === 'agent' && !m.tx && !m.imageUrl ? (
                    <StreamText text={m.text} done={m.id !== msgs[msgs.length - 1]?.id || !thinking} />
                  ) : (
                    <span className="whitespace-pre-wrap">{m.text}</span>
                  )}
                </div>
                {m.imageUrl && (
                  <div className="overflow-hidden rounded-2xl border border-line">
                    <img src={m.imageUrl} alt="AI generated" className="max-h-80 w-full object-cover" loading="lazy" />
                    <a
                      href={m.imageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 px-3 py-2 text-xs text-primary"
                    >
                      <ImageIcon size={12} /> Open full size
                    </a>
                  </div>
                )}
                {m.tx && <TxCard tx={m.tx} explorer={explorer} onConfirm={() => confirm(m.id, m.tx!)} onCancel={() => patchTx(m.id, { status: 'cancelled' })} />}
              </div>
            </div>
          </div>
        ))}
        {thinking && <p className="pl-9 text-xs text-muted">{THINKING_LINES[thinkLine]}</p>}
      </div>

      <div className="border-t border-line p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => setInput(ex)} className="rounded-full bg-background px-3 py-1 text-xs text-muted hover:text-fg">
              {ex}
            </button>
          ))}
          {models.length > 0 && (
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              aria-label="Choose AI model"
              className="ml-auto max-w-[180px] truncate rounded-full bg-background px-3 py-1 text-xs text-muted outline-none ring-primary/30 focus:ring-2"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void handle(input)
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything, or trade: &quot;buy 0.1 MON of SPRITE&quot;"
            aria-label="Message the agent"
            maxLength={2000}
            className="min-w-0 flex-1 rounded-xl bg-background px-3 py-2.5 text-[15px] outline-none ring-primary/30 focus:ring-2"
          />
          <Button type="submit" size="sm" disabled={thinking || !input.trim()} aria-label="Send">
            <Send size={16} />
          </Button>
        </form>
        <p className="mt-1.5 text-[11px] text-muted">
          Testnet only — trades need your wallet signature. Get MON at <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="text-primary">{FAUCET_URL}</a>
        </p>
      </div>
    </div>
  )
}

/** Confirmation card for one proposed transaction */
function TxCard({ tx, explorer, onConfirm, onCancel }: { tx: TxProposal; explorer?: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="rounded-2xl border border-up/30 p-3 text-sm">
      <div className="mb-2 font-semibold text-up">Review &amp; sign</div>
      <p className="mb-2 text-fg">{tx.description}</p>
      <dl className="space-y-1">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">To</dt>
          <dd className="font-mono text-right text-xs">{shortAddr(tx.to)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Value</dt>
          <dd className="number text-right font-medium">{tx.value === '0' ? '0 MON' : `${Number(tx.value) / 1e18} MON`}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Network</dt>
          <dd className="text-right">Monad testnet ({AGENT_CHAIN_ID})</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-muted">The agent prepared this — nothing moves until you sign in your wallet.</p>

      {tx.status === 'pending' && (
        <div className="mt-3 flex gap-2">
          <Button variant="up" size="sm" className="flex-1" onClick={onConfirm}>
            Confirm in wallet
          </Button>
          <Button variant="secondary" size="sm" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
      {tx.status === 'sending' && <p className="mt-3 text-xs text-muted">Waiting for your wallet signature and the chain…</p>}
      {tx.status === 'cancelled' && <p className="mt-3 text-xs text-muted">No worries — cancelled, nothing left your wallet.</p>}
      {tx.status === 'failed' && <p className="mt-3 text-xs text-down">{tx.error}</p>}
      {tx.status === 'done' && tx.hash && (
        <p className="mt-3 text-xs text-up">
          Done — it&apos;s on-chain.{' '}
          {explorer ? (
            <a href={`${explorer}/tx/${tx.hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary">
              View transaction <ExternalLink size={12} />
            </a>
          ) : (
            <span className="font-mono">{shortAddr(tx.hash)}</span>
          )}
        </p>
      )}
    </div>
  )
}
