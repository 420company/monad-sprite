// Zalien-gated agent page (added 2026-10-07 for hackathon).
// "Your Zalien NFT is the key to your personal AI trading agent":
//   connect wallet -> checkZalienHolder(address) on BNB Chain (read-only, no gas, no chain switch)
//   -> holder: unlock the agent chat (trades execute on Monad testnet)
//   -> non-holder: mint CTA linking to zalien.io
// Wallet connection reuses the existing 0x4 wallet stack (store/wallet + desktop/WalletRequired).
import { useCallback, useEffect, useState } from 'react'
import { Bot, ExternalLink, KeyRound, RefreshCw } from 'lucide-react'
import { checkZalienHolder, type GateResult } from '@monad-sprite/agent-gate'
import Button from '@/components/Button'
import AgentChat from '@/components/AgentChat'
import { isWalletConnected, useWallet } from '@/store/wallet'
import { WalletRequired } from '@/desktop/WalletRequired'
import { shortAddr } from '@/lib/format'

const ZALIEN_MINT_URL = 'https://zalien.io'

type GateState = { status: 'idle' } | { status: 'checking' } | { status: 'done'; result: GateResult } | { status: 'error'; message: string }

export default function Agent() {
  const connected = useWallet(isWalletConnected)
  const address = useWallet((s) => s.evmAccount?.address ?? s.evmAddress ?? null)
  const [gate, setGate] = useState<GateState>({ status: 'idle' })
  const [attempt, setAttempt] = useState(0)
  const recheck = useCallback(() => setAttempt((n) => n + 1), [])

  // Re-check whenever the connected account changes (or the user asks to re-check)
  useEffect(() => {
    if (!connected || !address) { setGate({ status: 'idle' }); return }
    let stale = false
    setGate({ status: 'checking' })
    checkZalienHolder(address)
      .then((result) => { if (!stale) setGate({ status: 'done', result }) })
      .catch((e: unknown) => { if (!stale) setGate({ status: 'error', message: e instanceof Error ? e.message : 'Could not check this wallet.' }) })
    return () => { stale = true }
  }, [connected, address, attempt])

  return (
    <div className="page-gutter mx-auto max-w-2xl py-6">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10">
          <Bot size={22} className="text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">Zalien Agent</h1>
          <p className="text-sm text-muted">Identity on BNB Chain · Trades on Monad testnet</p>
        </div>
        {gate.status === 'done' && gate.result.holder && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent">
            <KeyRound size={12} /> {gate.result.count} Zalien{gate.result.count === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {!connected || !address ? (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-muted">
            Your Zalien NFT is the key to your personal AI trading agent. Connect your wallet and we will check your Zaliens on BNB Chain.
            It is a read-only check: no signature, no gas, no network switch.
          </p>
          <WalletRequired />
        </div>
      ) : gate.status === 'checking' || gate.status === 'idle' ? (
        <div className="rounded-2xl bg-card p-6 text-center text-sm text-muted" role="status">
          Checking Zaliens for {shortAddr(address)} on BNB Chain...
        </div>
      ) : gate.status === 'error' ? (
        <div className="space-y-3 rounded-2xl bg-card p-6 text-center" role="alert">
          <p className="text-sm text-down">{gate.message}</p>
          <Button variant="secondary" size="sm" onClick={recheck}><RefreshCw size={14} /> Try again</Button>
        </div>
      ) : gate.result.holder ? (
        <AgentChat key={gate.result.wallet} zalienCount={gate.result.count} />
      ) : (
        <MintCta wallet={gate.result.wallet} onRecheck={recheck} />
      )}
    </div>
  )
}

/** Shown to wallets without a Zalien */
function MintCta({ wallet, onRecheck }: { wallet: string; onRecheck: () => void }) {
  return (
    <div className="space-y-4 rounded-2xl border border-accent/35 bg-accent/10 p-6">
      <div className="flex items-center gap-2 text-accent">
        <KeyRound size={18} />
        <h2 className="font-semibold">No Zalien found</h2>
      </div>
      <p className="text-sm leading-relaxed text-fg">
        {shortAddr(wallet)} does not hold a Zalien Universe NFT on BNB Chain. Each Zalien unlocks one personal AI trading agent.
      </p>
      <a href={ZALIEN_MINT_URL} target="_blank" rel="noreferrer" className="ui-button pearl-button min-h-12 w-full px-4 py-2.5 text-[15px] hover:brightness-105">
        <span className="ui-button-content">Mint a Zalien on zalien.io · 0.1 BNB <ExternalLink size={14} /></span>
      </a>
      <div className="flex items-center justify-between gap-3 text-xs text-muted">
        <span>Just minted, or the check failed? Holdings are read live from BNB Chain.</span>
        <button type="button" onClick={onRecheck} className="inline-flex shrink-0 items-center gap-1 text-primary">
          <RefreshCw size={12} /> Re-check
        </button>
      </div>
    </div>
  )
}
