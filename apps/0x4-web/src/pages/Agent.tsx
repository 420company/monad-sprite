// Zalien-gated AI trading agent (Monad hackathon).
// "Your Zalien NFT is the key to your personal AI trading agent":
//   connect wallet -> checkZalienHolder(address) on BNB Chain (read-only, no gas, no chain switch)
//   -> holder: unlock the agent chat (trades execute on Monad testnet)
//   -> non-holder: mint CTA linking to zalien.io
import { useCallback, useEffect, useState } from 'react'
import { Bot, ExternalLink, KeyRound, MessageSquareText, RefreshCw, ShieldCheck, Sparkles, Ticket, Wallet, Zap } from 'lucide-react'
import { checkAgentAccess, SPRITEPASS_CONTRACT, type AgentAccessResult } from '@monad-sprite/agent-gate'
import Button from '@/components/Button'
import AgentChat from '@/components/AgentChat'
import { isWalletConnected, useWallet } from '@/store/wallet'
import { WalletRequired } from '@/desktop/WalletRequired'
import { shortAddr } from '@/lib/format'
import { t } from '@/lib/i18n'
import { sendEvmTx } from '@/lib/evm'
import { MONAD_TESTNET_ID } from '@/lib/monadLauncher'
import { encodeFunctionData, type Hex } from 'viem'

const ZALIEN_MINT_URL = 'https://zalien.io'
const SPRITEPASS_MINT_ABI = [{ name: 'mint', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [{ name: '', type: 'uint256' }] }] as const

type GateState = { status: 'idle' } | { status: 'checking' } | { status: 'done'; result: AgentAccessResult } | { status: 'error'; message: string }

const STEPS = [
  { icon: Wallet, title: '连接钱包', desc: '支持 MetaMask 等 EVM 钱包' },
  { icon: KeyRound, title: '验证凭证', desc: 'Zalien（BSC）或 Sprite Pass（Monad）' },
  { icon: MessageSquareText, title: '一句话交易', desc: '自然语言下单，Monad 测试网执行' },
] as const

const CAPABILITIES = [
  { icon: Zap, title: '自然语言下单', desc: '“buy 0.1 MON of SPRITE”，不用学复杂界面' },
  { icon: ShieldCheck, title: '强制二次确认', desc: '每笔交易先弹确认卡，你点头才上链' },
  { icon: Sparkles, title: '实时查价', desc: '“price SPRITE”，bonding curve 链上报价' },
] as const

export default function Agent() {
  const connected = useWallet(isWalletConnected)
  const address = useWallet((s) => s.evmAccount?.address ?? s.evmAddress ?? null)
  const evmAccount = useWallet((s) => s.evmAccount)
  const [gate, setGate] = useState<GateState>({ status: 'idle' })
  const [attempt, setAttempt] = useState(0)
  const [minting, setMinting] = useState(false)
  const recheck = useCallback(() => setAttempt((n) => n + 1), [])

  useEffect(() => {
    if (!connected || !address) { setGate({ status: 'idle' }); return }
    let stale = false
    setGate({ status: 'checking' })
    checkAgentAccess(address)
      .then((result) => { if (!stale) setGate({ status: 'done', result }) })
      .catch((e: unknown) => { if (!stale) setGate({ status: 'error', message: e instanceof Error ? e.message : t('查询失败，请重试') }) })
    return () => { stale = true }
  }, [connected, address, attempt])

  const mintPass = useCallback(async () => {
    if (!evmAccount || minting) return
    setMinting(true)
    try {
      const data = encodeFunctionData({ abi: SPRITEPASS_MINT_ABI, functionName: 'mint' })
      await sendEvmTx(evmAccount, MONAD_TESTNET_ID, { to: SPRITEPASS_CONTRACT, data: data as Hex })
      recheck()
    } catch {
      /* user cancelled or tx failed — stay on the gate screen */
    } finally {
      setMinting(false)
    }
  }, [evmAccount, minting, recheck])

  const unlocked = gate.status === 'done' && gate.result.holder

  return (
    <div className="page-gutter mx-auto max-w-2xl py-6">
      {/* Hero */}
      <div className="relative mb-6 overflow-hidden rounded-3xl bg-gradient-to-br from-[#1a1033] via-[#2a1a4a] to-[#0f2a3a] p-6 text-white">
        <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-primary/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-8 h-40 w-40 rounded-full bg-accent/20 blur-3xl" />
        <div className="relative">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold tracking-wide">
            <Bot size={12} /> MONAD HACKATHON
          </div>
          <h1 className="text-2xl font-bold">{t('AI 交易员')}</h1>
          <p className="mt-1 max-w-md text-sm leading-relaxed text-white/70">
            {t('你的 NFT 就是你的交易员。Zalien（BSC）或 Sprite Pass（Monad）任一持有即解锁——一句话下单，全程你做主。')}
          </p>
          {unlocked && (
            <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-accent/25 px-2.5 py-1 text-xs font-semibold text-white">
              <KeyRound size={12} /> {gate.result.via === 'zalien'
                ? `${gate.result.zalienCount} Zalien${gate.result.zalienCount === 1 ? '' : 's'}`
                : t('Sprite Pass')} · {t('已解锁')}
            </span>
          )}
        </div>
      </div>

      {/* 3 steps */}
      {!unlocked && (
        <div className="mb-6 grid grid-cols-3 gap-2">
          {STEPS.map((s, i) => (
            <div key={s.title} className="rounded-2xl bg-card p-3 text-center">
              <div className="mx-auto mb-1.5 flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <s.icon size={18} />
              </div>
              <div className="text-xs font-semibold">{t(s.title)}</div>
              <div className="mt-0.5 text-[11px] leading-tight text-muted">{t(s.desc)}</div>
              {i < 2 && <div className="mt-1 text-[10px] text-muted">↓</div>}
            </div>
          ))}
        </div>
      )}

      {/* Capabilities */}
      {!unlocked && (
        <div className="mb-6 space-y-2">
          {CAPABILITIES.map((c) => (
            <div key={c.title} className="flex items-start gap-3 rounded-2xl bg-card p-3.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                <c.icon size={18} />
              </div>
              <div>
                <div className="text-sm font-semibold">{t(c.title)}</div>
                <div className="text-xs leading-relaxed text-muted">{t(c.desc)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Gate states */}
      {!connected || !address ? (
        <div className="space-y-4">
          <WalletRequired />
          <p className="text-center text-xs text-muted">{t('连接后自动检查你的 Zalien（BSC）或 Sprite Pass（Monad）持有')}</p>
        </div>
      ) : gate.status === 'checking' || gate.status === 'idle' ? (
        <div className="rounded-2xl bg-card p-6 text-center text-sm text-muted" role="status">
          <RefreshCw size={16} className="mx-auto mb-2 animate-spin" />
          {t('正在查询 {addr} 的凭证…', { addr: shortAddr(address) })}
        </div>
      ) : gate.status === 'error' ? (
        <div className="space-y-3 rounded-2xl bg-card p-6 text-center" role="alert">
          <p className="text-sm text-down">{gate.message}</p>
          <Button variant="secondary" size="sm" onClick={recheck}><RefreshCw size={14} /> {t('重试')}</Button>
        </div>
      ) : unlocked ? (
        <AgentChat key={gate.result.wallet} zalienCount={gate.result.zalienCount} />
      ) : (
        <MintCta wallet={gate.result.wallet} onRecheck={recheck} onMintPass={mintPass} minting={minting} />
      )}
    </div>
  )
}

/** Shown to wallets without a Zalien or SpritePass */
function MintCta({ wallet, onRecheck, onMintPass, minting }: { wallet: string; onRecheck: () => void; onMintPass: () => void; minting: boolean }) {
  return (
    <div className="space-y-4 rounded-3xl border border-accent/35 bg-accent/10 p-6">
      <div className="flex items-center gap-2 text-accent">
        <KeyRound size={18} />
        <h2 className="font-semibold">{t('解锁你的 AI 交易员')}</h2>
      </div>
      <p className="text-sm leading-relaxed">
        {t('{addr} 还没有解锁凭证。任选其一：', { addr: shortAddr(wallet) })}
      </p>

      {/* Free SpritePass on Monad testnet — one click */}
      <button
        type="button"
        onClick={onMintPass}
        disabled={minting}
        className="ui-button pearl-button min-h-12 w-full px-4 py-2.5 text-[15px] hover:brightness-105 disabled:opacity-60"
      >
        <span className="ui-button-content">
          <Ticket size={16} /> {minting ? t('铸造中…') : t('免费领取 Sprite Pass（Monad 测试网）')}
        </span>
      </button>

      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" />
        <span>{t('或')}</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <a href={ZALIEN_MINT_URL} target="_blank" rel="noreferrer" className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-line px-4 py-2.5 text-sm text-muted hover:text-fg">
        {t('去 zalien.io 铸造 Zalien · 0.1 BNB')} <ExternalLink size={14} />
      </a>

      <div className="flex items-center justify-between gap-3 text-xs text-muted">
        <span>{t('持有数据从链上实时读取')}</span>
        <button type="button" onClick={onRecheck} className="inline-flex shrink-0 items-center gap-1 text-primary">
          <RefreshCw size={12} /> {t('重新检查')}
        </button>
      </div>
    </div>
  )
}
