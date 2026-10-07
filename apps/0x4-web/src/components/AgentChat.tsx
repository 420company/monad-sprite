// Zalien agent chat (added 2026-10-07 for hackathon).
// The holder types a trading intent ("buy 0.1 MON of SPRITE", "sell 100 SPRITE", "price SPRITE"),
// a small local parser (lib/agentIntent.ts) turns it into an action, and every trade is shown as a
// confirmation card first. Nothing is signed or sent until the user presses Confirm on that card.
// Execution goes through lib/monadLauncher.ts, which only ever targets Monad testnet (chain 10143).
import { useEffect, useRef, useState } from 'react'
import { Bot, ExternalLink, Send } from 'lucide-react'
import { formatEther, type Hex } from 'viem'
import Button from '@/components/Button'
import { useWallet } from '@/store/wallet'
import { needWallet } from '@/desktop/walletGate'
import { chainById, NATIVE_EVM } from '@/lib/chains'
import { getEvmTokenBalance } from '@/lib/evm'
import { errorText } from '@/lib/errors'
import { fmtAmount, shortAddr } from '@/lib/format'
import { HELP_TEXT, parseIntent } from '@/lib/agentIntent'
import { launcherTokens, resolveLauncherToken } from '@/lib/agentTokens'
import {
  MONAD_TESTNET_ID,
  buyLauncherToken,
  getLauncherPrice,
  quoteLauncherBuy,
  quoteLauncherSell,
  sellLauncherToken,
  type LauncherToken,
} from '@/lib/monadLauncher'

/** Hard guard: the agent may only send real transactions on Monad testnet */
const AGENT_CHAIN_ID = 10143
const FAUCET_URL = 'https://faucet.monad.xyz'

/** Rotating status lines while the agent "thinks" — gives it a living feel */
const THINKING_LINES = [
  'Reading Monad testnet…',
  'Checking the bonding curve…',
  'Asking the chain…',
]

type TxStatus = 'pending' | 'sending' | 'done' | 'failed' | 'cancelled'

interface TxProposal {
  side: 'buy' | 'sell'
  token: LauncherToken
  /** buy: MON wei to spend; sell: token wei to sell */
  amountWei: bigint
  /** buy: estimated tokens out; sell: estimated MON out */
  quoteWei: bigint
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
}

/** Wei (18 decimals) to a short display string */
const fmtWei = (wei: bigint, digits = 4) => fmtAmount(Number(formatEther(wei)), digits)

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

const EXAMPLES = ['price SPRITE', 'buy 0.1 MON of SPRITE', 'portfolio']

export default function AgentChat({ zalienCount }: { zalienCount: number }) {
  const evmAccount = useWallet((s) => s.evmAccount)
  const [msgs, setMsgs] = useState<Msg[]>(() => [
    {
      id: 0,
      from: 'agent',
      text:
        `Hey! Your Zalien${zalienCount > 1 ? `s (${zalienCount} held)` : ''} unlocked me. ` +
        `I'm your on-chain trader for Monad testnet — I can check prices, buy and sell bonding-curve tokens, ` +
        `and show your portfolio. Let me take a quick look at your wallet…`,
    },
  ])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [thinkLine, setThinkLine] = useState(0)
  const nextId = useRef(1)
  // Synchronous lock so a double click cannot send the same proposal twice
  const sendingRef = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)
  const briefedRef = useRef(false)

  const explorer = chainById(MONAD_TESTNET_ID)?.viem?.blockExplorers?.default.url

  // Keep the newest message in view
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs, thinking])

  // Rotate the thinking line so it feels alive
  useEffect(() => {
    if (!thinking) return
    const t = setInterval(() => setThinkLine((n) => (n + 1) % THINKING_LINES.length), 1200)
    return () => clearInterval(t)
  }, [thinking])

  // Proactive portfolio briefing right after unlock: MON balance + launcher holdings
  useEffect(() => {
    if (briefedRef.current || !evmAccount) return
    briefedRef.current = true
    ;(async () => {
      try {
        const me = evmAccount.address
        const [monBal, tokens] = await Promise.all([
          getEvmTokenBalance(MONAD_TESTNET_ID, me, NATIVE_EVM),
          launcherTokens(),
        ])
        const holdings: { token: LauncherToken; bal: bigint }[] = []
        for (const tk of tokens) {
          try {
            const b = await getEvmTokenBalance(MONAD_TESTNET_ID, me, tk.address)
            if (b > 0n) holdings.push({ token: tk, bal: b })
          } catch { /* skip unreadable balances */ }
        }
        const monStr = fmtWei(monBal)
        if (!holdings.length) {
          push({
            from: 'agent',
            text:
              `You've got **${monStr} MON** in the wallet and no launcher tokens yet.\n\n` +
              `Want me to check a price, or shall we grab some \`SPRITE\` to start? Try **"price SPRITE"**.`,
          })
        } else {
          const lines = holdings.map((h) => `• **${fmtWei(h.bal, 2)}** ${h.token.symbol}`).join('\n')
          push({
            from: 'agent',
            text:
              `Here's what I see:\n${lines}\n• **${monStr} MON** ready to trade\n\n` +
              `Say **"portfolio"** anytime for a refresh, or tell me what to buy.`,
          })
        }
      } catch {
        push({ from: 'agent', text: 'Wallet check hiccuped — but I\'m ready. Try "price SPRITE" or "portfolio".' })
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evmAccount])

  const push = (m: Omit<Msg, 'id'>) => setMsgs((list) => [...list, { ...m, id: nextId.current++ }])
  const reply = (text: string, tone?: 'error') => push({ from: 'agent', text, tone })
  const patchTx = (id: number, patch: Partial<TxProposal>) =>
    setMsgs((list) => list.map((m) => (m.id === id && m.tx ? { ...m, tx: { ...m.tx, ...patch } } : m)))

  /** Only one open proposal at a time: a new one cancels any card still waiting for confirmation */
  const proposeTx = (text: string, tx: Omit<TxProposal, 'status'>) =>
    setMsgs((list) => [
      ...list.map((m) => (m.tx?.status === 'pending' ? { ...m, tx: { ...m.tx, status: 'cancelled' as const } } : m)),
      { id: nextId.current++, from: 'agent', text, tx: { ...tx, status: 'pending' } },
    ])

  const handle = async (line: string) => {
    const text = line.trim()
    if (!text || thinking) return
    setInput('')
    push({ from: 'user', text })
    const intent = parseIntent(text)
    if (intent.kind === 'help') return reply(HELP_TEXT)
    if (intent.kind === 'unknown') return reply(`Hmm, I didn't catch that. ${intent.reason}`)

    setThinking(true)
    try {
      // Portfolio: MON balance + every launcher token holding
      if (intent.kind === 'portfolio') {
        if (!evmAccount) return reply('Connect a wallet first and I\'ll show you everything in it.', 'error')
        const me = evmAccount.address
        const [monBal, tokens] = await Promise.all([
          getEvmTokenBalance(MONAD_TESTNET_ID, me, NATIVE_EVM),
          launcherTokens(),
        ])
        const holdings: { token: LauncherToken; bal: bigint }[] = []
        for (const tk of tokens) {
          try {
            const b = await getEvmTokenBalance(MONAD_TESTNET_ID, me, tk.address)
            if (b > 0n) holdings.push({ token: tk, bal: b })
          } catch { /* skip */ }
        }
        if (!holdings.length) {
          return reply(`Your wallet holds **${fmtWei(monBal)} MON** and no launcher tokens yet.\n\nSay **"price SPRITE"** and let's change that.`)
        }
        const lines = holdings.map((h) => `• **${fmtWei(h.bal, 2)}** ${h.token.symbol} (${h.token.name})`).join('\n')
        return reply(`Here's your Monad testnet portfolio:\n${lines}\n• **${fmtWei(monBal)} MON**\n\nWant to buy more of something, or cash out?`)
      }

      const found = await resolveLauncherToken(intent.token)
      if (!found.ok) return reply(found.error, 'error')
      const { token, duplicates } = found
      const dupNote = duplicates ? ` (Heads up: ${duplicates + 1} tokens share the ticker ${token.symbol} — I'm using the newest, ${shortAddr(token.address)}.)` : ''

      if (intent.kind === 'price') {
        const price = await getLauncherPrice(token.address)
        return reply(
          `**${token.symbol}** (${token.name}) is going for **${fmtWei(price, 8)} MON** per token right now, straight off the bonding curve.\n\n` +
            `• Reserve: **${fmtWei(token.reserve)} MON**\n• Supply: **${fmtWei(token.supply, 0)}** tokens${dupNote}\n\nWant some?`,
        )
      }

      if (!evmAccount) return reply('Connect a wallet first — I can\'t trade without one.', 'error')
      const me = evmAccount.address

      if (intent.kind === 'buy') {
        const [balance, quote] = await Promise.all([
          getEvmTokenBalance(MONAD_TESTNET_ID, me, NATIVE_EVM),
          quoteLauncherBuy(token.address, intent.monWei),
        ])
        if (balance < intent.monWei) {
          return reply(
            `That'd cost **${intent.amount} MON** plus gas, but you've only got **${fmtWei(balance)} MON**.\n\n` +
              `Top up at \`${FAUCET_URL}\` and we'll try again.`,
            'error',
          )
        }
        return proposeTx(`Got it — **${intent.amount} MON** into **${token.symbol}**, about **${fmtWei(quote, 2)}** tokens at the current curve. Take a look and confirm if you're happy.${dupNote}`, {
          side: 'buy', token, amountWei: intent.monWei, quoteWei: quote,
        })
      }

      // sell
      const [balance, quote] = await Promise.all([
        getEvmTokenBalance(MONAD_TESTNET_ID, me, token.address),
        quoteLauncherSell(token.address, intent.tokenWei),
      ])
      if (balance < intent.tokenWei) {
        return reply(`You only hold **${fmtWei(balance)} ${token.symbol}**, so selling ${intent.amount} won't work.\n\nWant to sell what you've got instead?`, 'error')
      }
      return proposeTx(`Selling **${intent.amount} ${token.symbol}** should get you back about **${fmtWei(quote, 6)} MON**. Confirm and I'll send it.${dupNote}`, {
        side: 'sell', token, amountWei: intent.tokenWei, quoteWei: quote,
      })
    } catch (e) {
      reply(`The chain didn't answer: ${e instanceof Error ? e.message.split('\n')[0] : 'unknown error'}. Give it a moment and try again.`, 'error')
    } finally {
      setThinking(false)
    }
  }

  const confirm = async (id: number, tx: TxProposal) => {
    if (tx.status !== 'pending' || sendingRef.current) return
    if (!evmAccount || needWallet()) return
    // Belt and braces: refuse anything that is not Monad testnet, even if the launcher module changes
    if (MONAD_TESTNET_ID !== AGENT_CHAIN_ID) {
      patchTx(id, { status: 'failed', error: 'Agent trading is limited to Monad testnet (chain 10143).' })
      return
    }
    sendingRef.current = true
    patchTx(id, { status: 'sending' })
    try {
      const hash =
        tx.side === 'buy'
          ? await buyLauncherToken(evmAccount, tx.token.address, tx.amountWei)
          : await sellLauncherToken(evmAccount, tx.token.address, tx.amountWei)
      patchTx(id, { status: 'done', hash })
    } catch (e) {
      // errorText returns '' when the user rejected the request in their wallet
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
                  {m.from === 'agent' && !m.tx ? (
                    <StreamText text={m.text} done={m.id !== msgs[msgs.length - 1]?.id || !thinking} />
                  ) : (
                    <span className="whitespace-pre-wrap">{m.text}</span>
                  )}
                </div>
                {m.tx && <TxCard tx={m.tx} explorer={explorer} onConfirm={() => confirm(m.id, m.tx!)} onCancel={() => patchTx(m.id, { status: 'cancelled' })} />}
              </div>
            </div>
          </div>
        ))}
        {thinking && <p className="pl-9 text-xs text-muted">{THINKING_LINES[thinkLine]}</p>}
      </div>

      <div className="border-t border-line p-3">
        <div className="mb-2 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => setInput(ex)} className="rounded-full bg-background px-3 py-1 text-xs text-muted hover:text-fg">
              {ex}
            </button>
          ))}
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
            placeholder='e.g. "buy 0.1 MON of SPRITE"'
            aria-label="Message the agent"
            maxLength={200}
            className="min-w-0 flex-1 rounded-xl bg-background px-3 py-2.5 text-[15px] outline-none ring-primary/30 focus:ring-2"
          />
          <Button type="submit" size="sm" disabled={thinking || !input.trim()} aria-label="Send">
            <Send size={16} />
          </Button>
        </form>
      </div>
    </div>
  )
}

/** Confirmation card for one proposed trade */
function TxCard({ tx, explorer, onConfirm, onCancel }: { tx: TxProposal; explorer?: string; onConfirm: () => void; onCancel: () => void }) {
  const buy = tx.side === 'buy'
  const rows: [string, string][] = buy
    ? [
        ['You pay', `${fmtWei(tx.amountWei, 6)} MON`],
        ['You get (est.)', `${fmtWei(tx.quoteWei)} ${tx.token.symbol}`],
      ]
    : [
        ['You sell', `${fmtWei(tx.amountWei, 6)} ${tx.token.symbol}`],
        ['You get (est.)', `${fmtWei(tx.quoteWei, 6)} MON`],
      ]
  rows.push(['Token', `${tx.token.name} (${shortAddr(tx.token.address)})`], ['Network', `Monad testnet (chain ${AGENT_CHAIN_ID})`])

  return (
    <div className={`rounded-2xl border p-3 text-sm ${buy ? 'border-up/30' : 'border-down/30'}`}>
      <div className={`mb-2 font-semibold ${buy ? 'text-up' : 'text-down'}`}>
        {buy ? 'Buy' : 'Sell'} {tx.token.symbol}
      </div>
      <dl className="space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-muted">{k}</dt>
            <dd className="number text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted">Estimate only: the final amount follows the bonding curve at execution time.</p>

      {tx.status === 'pending' && (
        <div className="mt-3 flex gap-2">
          <Button variant={buy ? 'up' : 'down'} size="sm" className="flex-1" onClick={onConfirm}>
            Confirm {buy ? 'buy' : 'sell'}
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
          Done — it's on-chain.{' '}
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
