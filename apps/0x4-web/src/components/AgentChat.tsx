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
import { resolveLauncherToken } from '@/lib/agentTokens'
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

const EXAMPLES = ['price SPRITE', 'buy 0.1 MON of SPRITE', 'sell 100 SPRITE']

export default function AgentChat({ zalienCount }: { zalienCount: number }) {
  const evmAccount = useWallet((s) => s.evmAccount)
  const [msgs, setMsgs] = useState<Msg[]>(() => [
    {
      id: 0,
      from: 'agent',
      text:
        `Agent unlocked by your Zalien${zalienCount > 1 ? ` (${zalienCount} held)` : ''}. ` +
        'I trade MemeLauncher tokens on Monad testnet. Try "price SPRITE" or "buy 0.1 MON of SPRITE". ' +
        'I always ask before sending a transaction.',
    },
  ])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const nextId = useRef(1)
  // Synchronous lock so a double click cannot send the same proposal twice
  const sendingRef = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)

  const explorer = chainById(MONAD_TESTNET_ID)?.viem?.blockExplorers?.default.url

  // Keep the newest message in view
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs, thinking])

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
    if (intent.kind === 'unknown') return reply(intent.reason)

    setThinking(true)
    try {
      const found = await resolveLauncherToken(intent.token)
      if (!found.ok) return reply(found.error, 'error')
      const { token, duplicates } = found
      const dupNote = duplicates ? ` Note: ${duplicates + 1} tokens use the ticker ${token.symbol}; using the newest one (${shortAddr(token.address)}).` : ''

      if (intent.kind === 'price') {
        const price = await getLauncherPrice(token.address)
        return reply(
          `${token.symbol} (${token.name}): ${fmtWei(price, 8)} MON per token, read on-chain from the bonding curve. ` +
            `Reserve ${fmtWei(token.reserve)} MON, supply ${fmtWei(token.supply, 0)}.${dupNote}`,
        )
      }

      if (!evmAccount) return reply('Connect a wallet to trade.', 'error')
      const me = evmAccount.address

      if (intent.kind === 'buy') {
        const [balance, quote] = await Promise.all([
          getEvmTokenBalance(MONAD_TESTNET_ID, me, NATIVE_EVM),
          quoteLauncherBuy(token.address, intent.monWei),
        ])
        if (balance < intent.monWei) {
          return reply(`Not enough testnet MON: you have ${fmtWei(balance)} MON, this buy needs ${intent.amount} MON (plus gas). Get test MON at ${FAUCET_URL}`, 'error')
        }
        return proposeTx(`Here is the trade I would place. Please confirm.${dupNote}`, {
          side: 'buy', token, amountWei: intent.monWei, quoteWei: quote,
        })
      }

      // sell
      const [balance, quote] = await Promise.all([
        getEvmTokenBalance(MONAD_TESTNET_ID, me, token.address),
        quoteLauncherSell(token.address, intent.tokenWei),
      ])
      if (balance < intent.tokenWei) {
        return reply(`Not enough ${token.symbol}: you hold ${fmtWei(balance)}, tried to sell ${intent.amount}.`, 'error')
      }
      return proposeTx(`Here is the trade I would place. Please confirm.${dupNote}`, {
        side: 'sell', token, amountWei: intent.tokenWei, quoteWei: quote,
      })
    } catch (e) {
      reply(`Could not reach Monad testnet: ${e instanceof Error ? e.message.split('\n')[0] : 'unknown error'}`, 'error')
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
                <p
                  className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    m.from === 'user' ? 'bg-primary/15 text-fg' : m.tone === 'error' ? 'bg-down/10 text-down' : 'bg-background text-fg'
                  }`}
                >
                  {m.text}
                </p>
                {m.tx && <TxCard tx={m.tx} explorer={explorer} onConfirm={() => confirm(m.id, m.tx!)} onCancel={() => patchTx(m.id, { status: 'cancelled' })} />}
              </div>
            </div>
          </div>
        ))}
        {thinking && <p className="pl-9 text-xs text-muted">Reading Monad testnet...</p>}
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
      {tx.status === 'sending' && <p className="mt-3 text-xs text-muted">Waiting for your wallet and the chain...</p>}
      {tx.status === 'cancelled' && <p className="mt-3 text-xs text-muted">Cancelled. Nothing was sent.</p>}
      {tx.status === 'failed' && <p className="mt-3 text-xs text-down">{tx.error}</p>}
      {tx.status === 'done' && tx.hash && (
        <p className="mt-3 text-xs text-up">
          Confirmed on Monad testnet.{' '}
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
