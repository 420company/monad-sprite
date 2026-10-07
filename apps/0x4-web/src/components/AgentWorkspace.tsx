// Sprite agent workspace — full-screen personal agent interface (Muse-style).
// Sidebar with conversation history, main chat area, slim top bar with model picker.
// All agent capabilities preserved: trading (unsigned tx + wallet confirm), images, code.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bot, ChevronLeft, Image as ImageIcon, Mic, Paperclip, PanelLeft, Plus, Send, Square, Trash2, ExternalLink,
} from 'lucide-react'
import type { Hex } from 'viem'
import { useWallet } from '@/store/wallet'
import { needWallet } from '@/desktop/walletGate'
import { chainById } from '@/lib/chains'
import { errorText } from '@/lib/errors'
import { shortAddr } from '@/lib/format'
import { sendEvmTx } from '@/lib/evm'
import { t } from '@/lib/i18n'

const AGENT_CHAIN_ID = 10143
const FAUCET_URL = 'https://faucet.monad.xyz'

const THINKING_LINES = ['Thinking…', 'Checking the chain…', 'Putting it together…']

type TxStatus = 'pending' | 'sending' | 'done' | 'failed' | 'cancelled'

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

export interface ChatMsg {
  id: number
  from: 'user' | 'agent'
  text: string
  tone?: 'error'
  tx?: TxProposal
  imageUrl?: string
  images?: string[]
  videoId?: string
  videoUrl?: string
  videoStatus?: 'generating' | 'ready' | 'failed'
  audioBase64?: string
}

interface Conversation {
  id: string
  title: string
  messages: ChatMsg[]
  model: string
  updatedAt: number
}

interface ApiReply {
  reply: string
  tx?: AgentTx | null
  image_url?: string | null
  video_id?: string | null
  audio_base64?: string | null
  error?: string
}

const CONV_KEY = 'sprite-conversations-v1'

function loadConvs(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONV_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as Conversation[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function saveConvs(convs: Conversation[]) {
  try {
    localStorage.setItem(CONV_KEY, JSON.stringify(convs.slice(0, 30)))
  } catch {
    /* storage full — ignore */
  }
}

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

// ---------- rich text ----------

function StreamText({ text, done }: { text: string; done: boolean }) {
  const [shown, setShown] = useState(done ? text.length : 0)
  useEffect(() => {
    if (done) { setShown(text.length); return }
    setShown(0)
    const tId = setInterval(() => {
      setShown((n) => {
        if (n >= text.length) { clearInterval(tId); return n }
        return n + 3
      })
    }, 12)
    return () => clearInterval(tId)
  }, [text, done])
  return (
    <span>
      {renderRich(text.slice(0, shown))}
      {!done && shown < text.length && (
        <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-primary align-middle" />
      )}
    </span>
  )
}

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

// ---------- tx card ----------

function TxCard({ tx, explorer, onConfirm, onCancel }: {
  tx: TxProposal
  explorer?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="rounded-2xl border border-up/30 bg-card p-4 text-sm">
      <div className="mb-2 font-semibold text-up">{t('确认并签名')}</div>
      <p className="mb-2">{tx.description}</p>
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
      <p className="mt-2 text-xs text-muted">{t('Agent 已准备好——钱包签名之前不会动用任何资金。')}</p>
      {tx.status === 'pending' && (
        <div className="mt-3 flex gap-2">
          <button onClick={onConfirm} className="ui-button pearl-button flex-1 px-4 py-2 text-sm">
            <span className="ui-button-content">{t('钱包确认')}</span>
          </button>
          <button onClick={onCancel} className="flex-1 rounded-xl border border-line px-4 py-2 text-sm text-muted hover:text-fg">
            {t('取消')}
          </button>
        </div>
      )}
      {tx.status === 'sending' && <p className="mt-3 text-xs text-muted">{t('等待钱包签名和上链…')}</p>}
      {tx.status === 'cancelled' && <p className="mt-3 text-xs text-muted">{t('已取消，没有动你的钱包。')}</p>}
      {tx.status === 'failed' && <p className="mt-3 text-xs text-down">{tx.error}</p>}
      {tx.status === 'done' && tx.hash && (
        <p className="mt-3 text-xs text-up">
          {t('上链成功。')}{' '}
          {explorer ? (
            <a href={`${explorer}/tx/${tx.hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary">
              {t('查看交易')} <ExternalLink size={12} />
            </a>
          ) : (
            <span className="font-mono">{shortAddr(tx.hash)}</span>
          )}
        </p>
      )}
    </div>
  )
}

// ---------- video card (polls until ready) ----------

function VideoCard({ videoId }: { videoId: string }) {
  const [status, setStatus] = useState<'generating' | 'ready' | 'failed'>('generating')
  const [videoUrl, setVideoUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let attempts = 0
    const poll = async () => {
      attempts++
      try {
        const r = await fetch(`/api/video?id=${encodeURIComponent(videoId)}`)
        const data = await r.json()
        if (cancelled) return
        const videoUrl = data.url || data.video_url
        if (data.status === 'completed' && videoUrl) {
          setVideoUrl(videoUrl)
          setStatus('ready')
          return
        }
        if (data.status === 'failed' || attempts > 60) {
          setStatus('failed')
          return
        }
      } catch {
        if (attempts > 60) {
          setStatus('failed')
          return
        }
      }
      if (!cancelled) setTimeout(poll, 5000)
    }
    poll()
    return () => { cancelled = true }
  }, [videoId])

  if (status === 'failed') {
    return (
      <div className="rounded-2xl border border-line bg-card p-4 text-sm text-muted">
        {t('视频生成失败，请重试')}
      </div>
    )
  }

  if (status === 'generating' || !videoUrl) {
    return (
      <div className="rounded-2xl border border-line bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <div className="text-sm">
            <div className="font-medium">{t('视频生成中…')}</div>
            <div className="text-xs text-muted">{t('通常需要 1-3 分钟，你可以继续聊天')}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <video src={videoUrl} controls className="max-h-96 w-full" preload="metadata" />
      <a href={videoUrl} target="_blank" rel="noreferrer" download className="flex items-center gap-1 px-3 py-2 text-xs text-primary">
        <ImageIcon size={12} /> {t('下载视频')}
      </a>
    </div>
  )
}

// ---------- audio player ----------

function AudioPlayer({ base64 }: { base64: string }) {
  const url = `data:audio/mpeg;base64,${base64}`
  return (
    <div className="rounded-2xl border border-line bg-card p-3">
      <audio src={url} controls className="w-full" preload="metadata" />
    </div>
  )
}

// ---------- message bubble ----------

function MessageBubble({ msg, isLast, thinking, explorer, onConfirmTx, onCancelTx }: {
  msg: ChatMsg
  isLast: boolean
  thinking: boolean
  explorer?: string
  onConfirmTx: (id: number, tx: TxProposal) => void
  onCancelTx: (id: number) => void
}) {
  const isUser = msg.from === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] md:max-w-[75%] ${isUser ? '' : 'flex gap-3'}`}>
        {!isUser && (
          <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10" aria-hidden="true">
            <Bot size={16} className="text-primary" />
          </span>
        )}
        <div className="min-w-0 space-y-2">
          <div
            className={`break-words rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
              isUser
                ? 'bg-primary text-white'
                : msg.tone === 'error'
                  ? 'bg-down/10 text-down'
                  : 'bg-card text-fg'
            }`}
          >
            {!isUser && !msg.tx && !msg.imageUrl ? (
              <StreamText text={msg.text} done={!isLast || !thinking} />
            ) : (
              <span className="whitespace-pre-wrap">{msg.text}</span>
            )}
          </div>
          {msg.images && msg.images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {msg.images.map((src, i) => (
                <img key={i} src={src} alt={`upload ${i + 1}`} className="max-h-48 rounded-xl border border-line object-cover" />
              ))}
            </div>
          )}
          {msg.imageUrl && (
            <div className="overflow-hidden rounded-2xl border border-line bg-card">
              <img src={msg.imageUrl} alt="AI generated" className="max-h-96 w-full object-cover" loading="lazy" />
              <a href={msg.imageUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-3 py-2 text-xs text-primary">
                <ImageIcon size={12} /> {t('查看原图')}
              </a>
            </div>
          )}
          {msg.videoId && <VideoCard videoId={msg.videoId} />}
          {msg.audioBase64 && <AudioPlayer base64={msg.audioBase64} />}
          {msg.tx && (
            <TxCard tx={msg.tx} explorer={explorer} onConfirm={() => onConfirmTx(msg.id, msg.tx!)} onCancel={() => onCancelTx(msg.id)} />
          )}
        </div>
      </div>
    </div>
  )
}

// ---------- main workspace ----------

const EXAMPLES = ['price SPRITE', 'buy 0.1 MON of SPRITE', 'draw a cyberpunk cat meme', 'what can you do?']

interface ModelOption {
  id: string
  label: string
  group: string
  cost?: string
  discount?: number | null
}

export default function AgentWorkspace({ zalienCount, onExit }: { zalienCount: number; onExit: () => void }) {
  const evmAccount = useWallet((s) => s.evmAccount)
  const [convs, setConvs] = useState<Conversation[]>(() => loadConvs())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [thinkLine, setThinkLine] = useState(0)
  const [models, setModels] = useState<ModelOption[]>([])
  const [listening, setListening] = useState(false)
  const [attachedImages, setAttachedImages] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const nextId = useRef(1)
  const sendingRef = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; content: string; images?: string[] }>>([])
  const recogRef = useRef<{ stop: () => void } | null>(null)

  const explorer = chainById(AGENT_CHAIN_ID)?.viem?.blockExplorers?.default.url
  const active = convs.find((c) => c.id === activeId) ?? null
  const msgs: ChatMsg[] = active?.messages ?? []
  const model = active?.model ?? 'deepseek-v4-flash'

  // Load models
  useEffect(() => {
    fetch('/api/models')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.models)) {
          setModels(d.models.filter((m: { group: string }) => m.group === 'chat'))
          // apply server default to conversations without explicit model
          if (d.default) {
            setConvs((cs) => {
              if (cs.length === 0) return cs
              return cs.map((c) => (c.model === 'deepseek-v4-flash' ? c : c))
            })
          }
        }
      })
      .catch(() => {})
  }, [])

  // Persist conversations
  useEffect(() => {
    saveConvs(convs)
  }, [convs])

  // Auto-scroll
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs, thinking])

  // Thinking indicator rotation
  useEffect(() => {
    if (!thinking) return
    const tId = setInterval(() => setThinkLine((n) => (n + 1) % THINKING_LINES.length), 1200)
    return () => clearInterval(tId)
  }, [thinking])

  const newConversation = useCallback(() => {
    const c: Conversation = {
      id: uid(),
      title: t('新的对话'),
      messages: [
        {
          id: 0,
          from: 'agent',
          text:
            `Hey! Your Zalien${zalienCount > 1 ? `s (${zalienCount} held)` : ''} unlocked me. ` +
            `I'm **Sprite**, your AI agent on Monad testnet.\n\n` +
            `I can trade memecoins, generate images, run code, and chat about anything — ` +
            `just ask. Try **"price SPRITE"** or **"draw me a meme"**.`,
        },
      ],
      model: 'deepseek-v4-flash',
      updatedAt: Date.now(),
    }
    setConvs((cs) => [c, ...cs])
    setActiveId(c.id)
    historyRef.current = []
    nextId.current = 1
  }, [zalienCount])

  // Start with a fresh conversation if none
  useEffect(() => {
    if (convs.length === 0 && !activeId) newConversation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateActive = useCallback((patch: (c: Conversation) => Conversation) => {
    setConvs((cs) => cs.map((c) => (c.id === activeId ? { ...patch(c), updatedAt: Date.now() } : c)))
  }, [activeId])

  const push = useCallback((m: Omit<ChatMsg, 'id'>) => {
    const id = nextId.current++
    updateActive((c) => {
      const messages = [...c.messages, { ...m, id }]
      // auto-title from first user message
      const title = c.messages.length <= 1 && m.from === 'user'
        ? m.text.slice(0, 30) || c.title
        : c.title
      return { ...c, messages, title }
    })
  }, [updateActive])

  const reply = useCallback((text: string, tone?: 'error') => push({ from: 'agent', text, tone }), [push])

  const patchTx = useCallback((id: number, patch: Partial<TxProposal>) => {
    updateActive((c) => ({
      ...c,
      messages: c.messages.map((m) => (m.id === id && m.tx ? { ...m, tx: { ...m.tx, ...patch } } : m)),
    }))
  }, [updateActive])

  const proposeTx = useCallback((text: string, tx: AgentTx) => {
    const id = nextId.current++
    updateActive((c) => ({
      ...c,
      messages: [
        ...c.messages.map((m) => (m.tx?.status === 'pending' ? { ...m, tx: { ...m.tx, status: 'cancelled' as const } } : m)),
        { id, from: 'agent', text, tx: { ...tx, status: 'pending' } },
      ],
    }))
  }, [updateActive])

  const handle = useCallback(async (line: string) => {
    const text = line.trim()
    const images = attachedImages.slice()
    if ((!text && images.length === 0) || thinking || !activeId) return
    setInput('')
    setAttachedImages([])
    push({ from: 'user', text: text || t('(图片)'), images: images.length > 0 ? images : undefined })
    historyRef.current.push({ role: 'user', content: text, images: images.length > 0 ? images : undefined })
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
      if (data.tx) proposeTx(data.reply || data.tx.description, data.tx)
      else if (data.image_url) push({ from: 'agent', text: data.reply, imageUrl: data.image_url })
      else if (data.video_id) push({ from: 'agent', text: data.reply, videoId: data.video_id })
      else if (data.audio_base64) push({ from: 'agent', text: data.reply, audioBase64: data.audio_base64 })
      else reply(data.reply)
    } catch (e) {
      historyRef.current.pop()
      reply(`Couldn't reach the agent: ${e instanceof Error ? e.message.split('\n')[0] : 'network error'}.`, 'error')
    } finally {
      setThinking(false)
    }
  }, [thinking, activeId, push, reply, proposeTx, evmAccount?.address, model])

  const confirmTx = useCallback(async (id: number, tx: TxProposal) => {
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
  }, [evmAccount, patchTx])

  const cancelTx = useCallback((id: number) => patchTx(id, { status: 'cancelled' }), [patchTx])

  const deleteConv = useCallback((id: string) => {
    setConvs((cs) => {
      const next = cs.filter((c) => c.id !== id)
      if (activeId === id) setActiveId(next[0]?.id ?? null)
      return next
    })
  }, [activeId])

  const switchConv = useCallback((id: string) => {
    setActiveId(id)
    // rebuild history from messages (text only)
    const c = convs.find((x) => x.id === id)
    if (c) {
      historyRef.current = c.messages
        .filter((m) => !m.tx && !m.imageUrl)
        .map((m) => ({ role: m.from === 'user' ? 'user' : 'assistant', content: m.text }))
      nextId.current = Math.max(0, ...c.messages.map((m) => m.id)) + 1
    }
    if (window.innerWidth < 768) setSidebarOpen(false)
  }, [convs])

  const setModel = useCallback((modelId: string) => {
    updateActive((c) => ({ ...c, model: modelId }))
  }, [updateActive])

  // Voice input (Web Speech API)
  const toggleListen = useCallback(() => {
    const SR = (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
      .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition
    if (!SR) return reply(t('这个浏览器不支持语音输入'), 'error')
    if (listening) {
      recogRef.current?.stop()
      setListening(false)
      return
    }
    try {
      const recog = new (SR as new () => {
        lang: string; interimResults: boolean
        onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
        onend: (() => void) | null
        start: () => void; stop: () => void
      })()
      recog.lang = 'zh-CN'
      recog.interimResults = true
      recog.onresult = (e) => {
        const last = e.results[e.results.length - 1]
        const transcript = last[0]?.transcript ?? ''
        if (transcript) setInput(transcript)
      }
      recog.onend = () => setListening(false)
      recogRef.current = recog
      recog.start()
      setListening(true)
    } catch {
      setListening(false)
    }
  }, [listening, reply])

  const currentModel = models.find((m) => m.id === model)

  return (
    <div className="fixed inset-0 z-50 flex bg-background text-fg">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-0'
        } shrink-0 overflow-hidden border-r border-line bg-card transition-all duration-200`}
      >
        <div className="flex h-full w-64 flex-col">
          <div className="flex items-center gap-2 border-b border-line p-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
              <Bot size={16} className="text-primary" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">Sprite</div>
              <div className="truncate text-[11px] text-muted">{t('你的 AI agent')}</div>
            </div>
            <button
              onClick={onExit}
              className="rounded-lg p-1.5 text-muted hover:bg-background hover:text-fg"
              title={t('返回')}
            >
              <ChevronLeft size={16} />
            </button>
          </div>

          <div className="p-3">
            <button
              onClick={newConversation}
              className="flex w-full items-center gap-2 rounded-xl bg-primary/10 px-3 py-2.5 text-sm font-medium text-primary hover:bg-primary/15"
            >
              <Plus size={16} /> {t('新的对话')}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {convs.map((c) => (
              <div
                key={c.id}
                className={`group mb-1 flex items-center gap-1 rounded-xl px-3 py-2.5 text-sm ${
                  c.id === activeId ? 'bg-background font-medium' : 'text-muted hover:bg-background/60 hover:text-fg'
                }`}
              >
                <button onClick={() => switchConv(c.id)} className="min-w-0 flex-1 truncate text-left">
                  {c.title}
                </button>
                <button
                  onClick={() => deleteConv(c.id)}
                  className="shrink-0 rounded p-1 text-muted opacity-0 hover:text-down group-hover:opacity-100"
                  title={t('删除')}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {convs.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-muted">{t('还没有对话')}</p>
            )}
          </div>

          <div className="border-t border-line p-3 text-[11px] text-muted">
            {t('Monad 测试网 · 交易需钱包签名')}
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 md:px-4">
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className="rounded-lg p-2 text-muted hover:bg-card hover:text-fg"
            title={t('边栏')}
          >
            <PanelLeft size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{active?.title || 'Sprite'}</div>
          </div>
          {models.length > 0 && (
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              aria-label={t('选择模型')}
              className="max-w-[160px] truncate rounded-lg bg-card px-2.5 py-1.5 text-xs outline-none ring-primary/30 focus:ring-2 md:max-w-[220px]"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}{m.cost ? ` · ${m.cost}` : ''}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={newConversation}
            className="rounded-lg p-2 text-muted hover:bg-card hover:text-fg md:hidden"
            title={t('新的对话')}
          >
            <Plus size={18} />
          </button>
        </header>

        {/* Messages */}
        <div ref={listRef} className="flex-1 space-y-5 overflow-y-auto px-4 py-6 md:px-8" aria-live="polite">
          <div className="mx-auto max-w-3xl space-y-5">
            {msgs.map((m) => (
              <MessageBubble
                key={m.id}
                msg={m}
                isLast={m.id === msgs[msgs.length - 1]?.id}
                thinking={thinking}
                explorer={explorer}
                onConfirmTx={confirmTx}
                onCancelTx={cancelTx}
              />
            ))}
            {thinking && (
              <div className="flex gap-3">
                <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot size={16} className="text-primary" />
                </span>
                <p className="py-2 text-sm text-muted">{THINKING_LINES[thinkLine]}</p>
              </div>
            )}
            {msgs.length <= 1 && !thinking && (
              <div className="flex flex-wrap gap-2 pt-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => void handle(ex)}
                    className="rounded-full border border-line bg-card px-4 py-2 text-sm text-muted hover:border-primary/40 hover:text-fg"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Input */}
        <div className="shrink-0 border-t border-line px-4 py-3 md:px-8">
          <div className="mx-auto max-w-3xl">
            {attachedImages.length > 0 && (
              <div className="mb-2 flex gap-2">
                {attachedImages.map((src, i) => (
                  <div key={i} className="relative">
                    <img src={src} alt={`attach ${i + 1}`} className="h-16 w-16 rounded-xl border border-line object-cover" />
                    <button
                      type="button"
                      onClick={() => setAttachedImages((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-down text-[10px] text-white"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void handle(input)
              }}
              className="flex items-end gap-2 rounded-2xl border border-line bg-card p-2 focus-within:border-primary/50"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []).slice(0, 4)
                  for (const f of files) {
                    if (f.size > 5 * 1024 * 1024) continue
                    const reader = new FileReader()
                    reader.onload = () => {
                      const url = reader.result as string
                      setAttachedImages((prev) => [...prev.slice(0, 3), url])
                    }
                    reader.readAsDataURL(f)
                  }
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-xl p-2.5 text-muted hover:bg-background hover:text-fg"
                title={t('上传图片')}
              >
                <Paperclip size={18} />
              </button>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void handle(input)
                  }
                }}
                placeholder={t('问 Sprite 任何事，或交易："buy 0.1 MON of SPRITE"')}
                rows={1}
                maxLength={2000}
                className="max-h-32 min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] outline-none placeholder:text-muted/70"
              />
              <button
                type="button"
                onClick={toggleListen}
                className={`rounded-xl p-2.5 hover:bg-background ${listening ? 'text-down' : 'text-muted hover:text-fg'}`}
                title={t('语音输入')}
              >
                {listening ? <Square size={18} /> : <Mic size={18} />}
              </button>
              <button
                type="submit"
                disabled={thinking || (!input.trim() && attachedImages.length === 0)}
                className="rounded-xl bg-primary p-2.5 text-white disabled:opacity-40"
                title={t('发送')}
              >
                <Send size={18} />
              </button>
            </form>
            <p className="mt-2 text-center text-[11px] text-muted">
              {t('测试网模式 · 交易需要你的钱包签名 · MON 水龙头')}{' '}
              <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="text-primary">{FAUCET_URL}</a>
              {currentModel?.cost && <span className="ml-2">· {currentModel.label} {currentModel.cost}</span>}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
