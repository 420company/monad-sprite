// One-click token launch — Monad testnet (Monad hackathon)
// Issues bonding-curve meme coins via the MemeLauncher contract (chain 10143)
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, ExternalLink, Rocket, TrendingUp } from 'lucide-react'
import Button from '@/components/Button'
import { toast } from '@/components/Toast'
import { t } from '@/lib/i18n'
import { isWalletConnected, useWallet } from '@/store/wallet'
import { WalletRequired } from '@/desktop/WalletRequired'
import { getEvmTokenBalance } from '@/lib/evm'
import { NATIVE_EVM } from '@/lib/chains'
import { fmtAmount, shortAddr } from '@/lib/format'
import {
  LAUNCHER_ADDRESS,
  MONAD_TESTNET_ID,
  createLauncherToken,
  findCreatedToken,
  getLauncherToken,
  listLauncherTokens,
  type LauncherToken,
} from '@/lib/monadLauncher'

const HOW_IT_WORKS = [
  { title: '填写币名', desc: '起个名字、定个符号，10 秒搞定' },
  { title: '签名上链', desc: '一笔交易，代币合约自动部署' },
  { title: '开始交易', desc: 'bonding curve 定价，越早买越便宜' },
] as const

/** Emoji icon picker — pure UI (the contract only stores name/symbol on-chain) */
const ICON_CHOICES = ['🚀', '🐱', '🐶', '🦄', '🐸', '🔥', '💎', '🌙', '⚡', '🍌', '🐳', '👻'] as const

export default function Launch() {
  const nav = useNavigate()
  const connected = useWallet(isWalletConnected)
  const evmAccount = useWallet((s) => s.evmAccount)
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [icon, setIcon] = useState<string>(ICON_CHOICES[0])
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [monBalance, setMonBalance] = useState<string | null>(null)
  const [recent, setRecent] = useState<LauncherToken[] | null>(null)

  useEffect(() => {
    if (!connected || !evmAccount) return
    getEvmTokenBalance(MONAD_TESTNET_ID, evmAccount.address, NATIVE_EVM)
      .then((b) => setMonBalance(fmtAmount(Number(b) / 1e18)))
      .catch(() => setMonBalance(null))
  }, [connected, evmAccount])

  // Recent launches, live from the Launcher contract
  useEffect(() => {
    let stale = false
    listLauncherTokens(10)
      .then(async (addrs) => {
        const infos = await Promise.all(addrs.slice(-6).reverse().map((a) => getLauncherToken(a)))
        if (!stale) setRecent(infos.filter((x): x is LauncherToken => x !== null))
      })
      .catch(() => { if (!stale) setRecent([]) })
    return () => { stale = true }
  }, [])

  const submit = async () => {
    if (!evmAccount) return
    const n = name.trim()
    const s = symbol.trim().toUpperCase()
    if (!n || !s) {
      toast.info(t('请填写币名和符号'))
      return
    }
    setBusy(true)
    try {
      const hash = await createLauncherToken(evmAccount, n, s)
      toast.info(t('发币交易已上链，正在确认…'))
      const token = await findCreatedToken(hash)
      if (token) {
        nav(`/token/monad-testnet/${token}`)
      } else {
        toast.info(t('发币成功（{hash}）', { hash: `${hash.slice(0, 10)}…` }))
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('发币失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-gutter mx-auto max-w-lg py-6">
      {/* Hero */}
      <div className="relative mb-6 overflow-hidden rounded-3xl bg-gradient-to-br from-[#2a1033] via-[#3a1a2a] to-[#0f2a3a] p-6 text-white">
        <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-primary/30 blur-3xl" />
        <div className="relative">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold tracking-wide">
            <Rocket size={12} /> MONAD TESTNET
          </div>
          <h1 className="text-2xl font-bold">{t('一键发币')}</h1>
          <p className="mt-1 max-w-md text-sm leading-relaxed text-white/70">
            {t('在 Monad 测试网上发行你的 meme 币。bonding curve 自动定价：越早买越便宜，卖出随时变现，无需做市商。')}
          </p>
        </div>
      </div>

      {/* How it works */}
      <div className="mb-6 grid grid-cols-3 gap-2">
        {HOW_IT_WORKS.map((s, i) => (
          <div key={s.title} className="rounded-2xl bg-card p-3 text-center">
            <div className="mx-auto mb-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
              {i + 1}
            </div>
            <div className="text-xs font-semibold">{t(s.title)}</div>
            <div className="mt-0.5 text-[11px] leading-tight text-muted">{t(s.desc)}</div>
          </div>
        ))}
      </div>

      {!connected ? (
        <WalletRequired />
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl bg-card p-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-muted">{t('测试网 MON 余额')}</span>
              <span className="number font-semibold">{monBalance ?? '--'}</span>
            </div>
            <a href="https://faucet.monad.xyz" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary">
              {t('没有测试币？去水龙头领')} <ExternalLink size={14} />
            </a>
          </div>

          <div className="space-y-3 rounded-2xl bg-card p-4">
            <div>
              <span className="mb-1.5 block text-sm text-muted">{t('图标')}</span>
              <div className="flex flex-wrap gap-1.5">
                {ICON_CHOICES.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setIcon(e)}
                    aria-label={t('选择图标 {e}', { e })}
                    className={`flex h-10 w-10 items-center justify-center rounded-xl text-xl transition ${
                      icon === e ? 'bg-primary/20 ring-2 ring-primary' : 'bg-background hover:bg-background/70'
                    }`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="mb-1 block text-sm text-muted">{t('币名')}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('比如：Monad Sprite')}
                maxLength={32}
                className="w-full rounded-xl bg-background px-3 py-2.5 text-[15px] outline-none ring-primary/30 focus:ring-2"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-muted">{t('符号')}</span>
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                placeholder="SPRITE"
                maxLength={10}
                className="w-full rounded-xl bg-background px-3 py-2.5 text-[15px] uppercase outline-none ring-primary/30 focus:ring-2"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-muted">{t('简介（选填）')}</span>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder={t('一句话介绍你的币，比如：第一只登上 Monad 的猫')}
                maxLength={140}
                rows={2}
                className="w-full resize-none rounded-xl bg-background px-3 py-2.5 text-[15px] outline-none ring-primary/30 focus:ring-2"
              />
            </label>
          </div>

          {/* Live preview — pump.fun style card */}
          <div className="rounded-2xl border border-line bg-card p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t('预览')}</div>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-2xl">
                {icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{name.trim() || t('你的币名')}</div>
                <div className="text-xs text-muted">${symbol.trim() || 'TICKER'}</div>
                {desc.trim() && <div className="mt-0.5 truncate text-xs text-muted">{desc.trim()}</div>}
              </div>
              <span className="shrink-0 rounded-full bg-accent/15 px-2 py-1 text-[11px] font-semibold text-accent">
                bonding curve
              </span>
            </div>
          </div>

          <Button onClick={submit} disabled={busy || !name.trim() || !symbol.trim()} className="w-full">
            <Rocket size={16} /> {busy ? t('上链中…') : t('发行代币')}
          </Button>

          <p className="text-xs leading-relaxed text-muted">
            {t('经由 MemeLauncher 合约（{addr}）在 Monad 测试网发行。', { addr: shortAddr(LAUNCHER_ADDRESS) })}
          </p>
        </div>
      )}

      {/* Recent launches */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <TrendingUp size={16} className="text-primary" />
          <h2 className="font-semibold">{t('最新发射')}</h2>
        </div>
        {recent === null ? (
          <div className="rounded-2xl bg-card p-6 text-center text-sm text-muted">{t('正在从链上读取…')}</div>
        ) : recent.length === 0 ? (
          <div className="rounded-2xl bg-card p-6 text-center text-sm text-muted">{t('还没有人发币，来当第一个')}</div>
        ) : (
          <div className="space-y-2">
            {recent.map((tk) => (
              <Link
                key={tk.address}
                to={`/token/monad-testnet/${tk.address}`}
                className="flex items-center gap-3 rounded-2xl bg-card p-3.5 transition hover:bg-card/80"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                  {tk.symbol.slice(0, 2)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{tk.name}</div>
                  <div className="text-xs text-muted">${tk.symbol} · {shortAddr(tk.address)}</div>
                </div>
                <ChevronRight size={16} className="shrink-0 text-muted" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
