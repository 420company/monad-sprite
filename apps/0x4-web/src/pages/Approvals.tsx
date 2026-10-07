// Approval check: list the wallet's outbound approvals and revoke them in one tap, so malicious contracts can't drain assets
import { useEffect, useState } from 'react'
import { ArrowLeft, RefreshCw, ShieldCheck, ShieldAlert } from 'lucide-react'
import Button from '@/components/Button'
import ChainBadge from '@/components/ChainBadge'
import { Input } from '@/components/Field'
import { toast } from '@/components/Toast'
import { scanEvm, scanSolana, revoke, type Approval } from '@/lib/approvals'
import { fmtAmount, shortAddr } from '@/lib/format'
import { useWallet } from '@/store/wallet'
import { useSettings } from '@/store/settings'
import { usePortfolio } from '@/store/portfolio'
import { t } from '@/lib/i18n'
import { useBack } from '@/lib/useBack'
import { errorText } from '@/lib/errors'

export default function Approvals() {
  // Back: go back if there is a previous page (its state / scroll get restored); push / deep-link opens go to /settings
  const back = useBack('/settings')
  const { address, evmAddress, wallet, evmAccount } = useWallet()
  const rpcUrl = useSettings((s) => s.rpcUrl)
  const holdings = usePortfolio((s) => s.holdings)
  const [list, setList] = useState<Approval[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [extra, setExtra] = useState('')
  const [scanning, setScanning] = useState(false)

  const scan = async () => {
    if (!address) return
    setScanning(true)
    try {
      const [sol, evm] = await Promise.all([scanSolana(rpcUrl, address).catch(() => []), evmAddress ? scanEvm(evmAddress, holdings, extra.trim() ? [extra.trim()] : []).catch(() => []) : Promise.resolve([])])
      setList([...sol, ...evm])
    } finally { setScanning(false) }
  }
  useEffect(() => { scan() }, [address, evmAddress, holdings.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const doRevoke = async (a: Approval) => {
    const key = `${a.chainId}:${a.token}:${a.spender}`
    setBusy(key)
    try { await revoke(a, { solana: wallet, evm: evmAccount, solanaRpc: rpcUrl }); toast.success(t('已撤销授权')); setList((l) => (l || []).filter((x) => `${x.chainId}:${x.token}:${x.spender}` !== key)) } catch (e) { toast.error(errorText(e, t('撤销失败'))) } finally { setBusy(null) }
  }

  return (
    <div className="safe-top px-4 pt-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><button onClick={back} className="-ml-2 rounded-full p-2 text-muted"><ArrowLeft size={22} /></button><h1 className="text-2xl font-bold">{t('管理授权')}</h1></div>
        <button onClick={scan} className={`rounded-full p-2 text-muted ${scanning ? 'animate-spin' : ''}`}><RefreshCw size={18} /></button>
      </div>
      <p className="mt-2 text-xs text-muted">{t('请检查存有疑惑的授权信息，必要时可取消授权。')}</p>
      <div className="mt-3 flex gap-2"><Input value={extra} onChange={(e) => setExtra(e.target.value.trim())} placeholder={t('检查合约地址是否授权')} spellCheck={false} /><Button variant="secondary" className="shrink-0 whitespace-nowrap" onClick={scan}>{t('检查')}</Button></div>
      <div className="mt-4">
        {list === null && <div className="skeleton h-16" />}
        {list?.map((a) => {
          const key = `${a.chainId}:${a.token}:${a.spender}`
          return (
            <div key={key} className="mb-2 flex items-center gap-3 rounded-2xl bg-card p-3">
              {a.amount === Infinity ? <ShieldAlert className="shrink-0 text-down" /> : <ShieldCheck className="shrink-0 text-muted" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-semibold">{a.symbol} <ChainBadge chainId={a.chainId} /></div>
                <div className="truncate text-xs text-muted">{t(a.spenderName)} · {shortAddr(a.spender, 6)}</div>
                <div className={`text-xs ${a.amount === Infinity ? 'text-down' : 'text-muted'}`}>{a.amount === Infinity ? t('无限授权') : t('额度 {amount}', { amount: fmtAmount(a.amount) })}</div>
              </div>
              <Button size="sm" variant="danger" loading={busy === key} onClick={() => doRevoke(a)}>{t('撤销')}</Button>
            </div>
          )
        })}
        {list && !list.length && <div className="py-12 text-center text-sm text-muted"><ShieldCheck className="mx-auto mb-2 text-up" size={32} />{t('没有发现对外授权，很安全')}</div>}
      </div>
    </div>
  )
}
