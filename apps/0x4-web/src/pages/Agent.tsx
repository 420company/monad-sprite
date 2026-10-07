// Sprite agent entry — full-screen personal agent.
// Gate: clean full-screen unlock screen (wallet + NFT check).
// Unlocked: full-screen AgentWorkspace (Muse-style chat interface).
import { useCallback, useEffect, useState } from 'react'
import { Bot, ExternalLink, KeyRound, RefreshCw, Ticket, X } from 'lucide-react'
import { checkAgentAccess, SPRITEPASS_CONTRACT, type AgentAccessResult } from '@monad-sprite/agent-gate'
import { isWalletConnected, useWallet } from '@/store/wallet'
import { WalletRequired } from '@/desktop/WalletRequired'
import { shortAddr } from '@/lib/format'
import { t } from '@/lib/i18n'
import { sendEvmTx } from '@/lib/evm'
import { MONAD_TESTNET_ID } from '@/lib/monadLauncher'
import { encodeFunctionData, type Hex } from 'viem'
import AgentWorkspace from '@/components/AgentWorkspace'

const ZALIEN_MINT_URL = 'https://zalien.io'
const SPRITEPASS_MINT_ABI = [{ name: 'mint', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [{ name: '', type: 'uint256' }] }] as const

type GateState = { status: 'idle' } | { status: 'checking' } | { status: 'done'; result: AgentAccessResult } | { status: 'error'; message: string }

export default function Agent() {
  const connected = useWallet(isWalletConnected)
  const address = useWallet((s) => s.evmAccount?.address ?? s.evmAddress ?? null)
  const evmAccount = useWallet((s) => s.evmAccount)
  const [gate, setGate] = useState<GateState>({ status: 'idle' })
  const [attempt, setAttempt] = useState(0)
  const [minting, setMinting] = useState(false)
  const [dismissed, setDismissed] = useState(false)
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

  // Unlocked → full-screen agent workspace
  if (unlocked && !dismissed) {
    return <AgentWorkspace zalienCount={gate.result.zalienCount} onExit={() => setDismissed(true)} />
  }

  // Gate → clean full-screen entry
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background p-6">
      <button
        onClick={() => setDismissed(true)}
        className="absolute right-4 top-4 rounded-lg p-2 text-muted hover:bg-card hover:text-fg"
        title={t('返回')}
      >
        <X size={20} />
      </button>

      <div className="w-full max-w-md text-center">
        <span className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10">
          <Bot size={36} className="text-primary" />
        </span>
        <h1 className="text-2xl font-bold">Sprite</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {t('你的个人 AI agent。聊天、交易、画图、写代码——一个入口，全能助手。')}
        </p>
        <p className="mt-1 text-xs text-muted">
          {t('Zalien（BSC）或 Sprite Pass（Monad）持有即解锁')}
        </p>

        <div className="mt-8">
          {!connected || !address ? (
            <div className="space-y-3">
              <WalletRequired />
              <p className="text-xs text-muted">{t('连接钱包后自动检查解锁凭证')}</p>
            </div>
          ) : gate.status === 'checking' || gate.status === 'idle' ? (
            <div className="rounded-2xl bg-card p-6 text-sm text-muted" role="status">
              <RefreshCw size={16} className="mx-auto mb-2 animate-spin" />
              {t('正在查询 {addr} 的凭证…', { addr: shortAddr(address) })}
            </div>
          ) : gate.status === 'error' ? (
            <div className="space-y-3 rounded-2xl bg-card p-6" role="alert">
              <p className="text-sm text-down">{gate.message}</p>
              <button onClick={recheck} className="rounded-xl border border-line px-4 py-2 text-sm text-muted hover:text-fg">
                <RefreshCw size={14} className="mr-1 inline" /> {t('重试')}
              </button>
            </div>
          ) : (
            <div className="space-y-4 rounded-3xl border border-accent/35 bg-accent/10 p-6 text-left">
              <div className="flex items-center gap-2 text-accent">
                <KeyRound size={18} />
                <h2 className="font-semibold">{t('解锁你的 Sprite')}</h2>
              </div>
              <p className="text-sm leading-relaxed text-muted">
                {t('{addr} 还没有解锁凭证。任选其一：', { addr: shortAddr(gate.result.wallet) })}
              </p>
              <button
                type="button"
                onClick={mintPass}
                disabled={minting}
                className="ui-button pearl-button min-h-12 w-full px-4 py-2.5 text-[15px] disabled:opacity-60"
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
              <a
                href={ZALIEN_MINT_URL}
                target="_blank"
                rel="noreferrer"
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-line px-4 py-2.5 text-sm text-muted hover:text-fg"
              >
                {t('去 zalien.io 铸造 Zalien · 0.1 BNB')} <ExternalLink size={14} />
              </a>
              <div className="flex items-center justify-between gap-3 text-xs text-muted">
                <span>{t('持有数据从链上实时读取')}</span>
                <button type="button" onClick={recheck} className="inline-flex shrink-0 items-center gap-1 text-primary">
                  <RefreshCw size={12} /> {t('重新检查')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Dismissed workspace → re-enter */}
        {dismissed && unlocked && (
          <button
            onClick={() => setDismissed(false)}
            className="ui-button pearl-button mt-6 px-8 py-3 text-[15px]"
          >
            <span className="ui-button-content">
              <Bot size={16} /> {t('进入 Sprite')}
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
