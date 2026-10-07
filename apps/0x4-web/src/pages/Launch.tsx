// One-click token launch — Monad testnet (added 2026-10-07 for hackathon)
// Issues bonding-curve meme coins via the MemeLauncher contract (0x8ca1990c…45f, chain 10143)
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Rocket, ExternalLink } from 'lucide-react'
import Button from '@/components/Button'
import { toast } from '@/components/Toast'
import { t } from '@/lib/i18n'
import { isWalletConnected, useWallet } from '@/store/wallet'
import { WalletRequired } from '@/desktop/WalletRequired'
import { getEvmTokenBalance } from '@/lib/evm'
import { NATIVE_EVM } from '@/lib/chains'
import { fmtAmount } from '@/lib/format'
import {
  MONAD_TESTNET_ID,
  createLauncherToken,
  findCreatedToken,
} from '@/lib/monadLauncher'

export default function Launch() {
  const nav = useNavigate()
  const connected = useWallet(isWalletConnected)
  const evmAccount = useWallet((s) => s.evmAccount)
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [busy, setBusy] = useState(false)
  const [monBalance, setMonBalance] = useState<string | null>(null)

  useEffect(() => {
    if (!connected || !evmAccount) return
    getEvmTokenBalance(MONAD_TESTNET_ID, evmAccount.address, NATIVE_EVM)
      .then((b) => setMonBalance(fmtAmount(Number(b) / 1e18)))
      .catch(() => setMonBalance(null))
  }, [connected, evmAccount])

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
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10">
          <Rocket size={22} className="text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">{t('一键发币')}</h1>
          <p className="text-sm text-muted">{t('Monad 测试网 · bonding curve 发行')}</p>
        </div>
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
            <a
              href="https://faucet.monad.xyz"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary"
            >
              {t('没有测试币？去水龙头领')} <ExternalLink size={14} />
            </a>
          </div>

          <div className="rounded-2xl bg-card p-4 space-y-3">
            <label className="block">
              <span className="mb-1 block text-sm text-muted">{t('币名')}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Monad Sprite"
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
          </div>

          <Button onClick={submit} disabled={busy || !name.trim() || !symbol.trim()} className="w-full">
            {busy ? t('上链中…') : t('发行代币')}
          </Button>

          <p className="text-xs leading-relaxed text-muted">
            {t('经由 MemeLauncher 合约在 Monad 测试网发行，价格走 bonding curve（越早买越便宜）。发币后可在代币详情页直接买卖。')}
          </p>
        </div>
      )}
    </div>
  )
}
