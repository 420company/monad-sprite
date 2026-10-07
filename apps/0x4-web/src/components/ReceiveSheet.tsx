// 充值弹层：一次只看一条链，二维码 + 短地址，点一下就复制；其它链用顶部切换
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Check, Copy, Download } from 'lucide-react'
import Sheet from './Sheet'
import { PERP_ENABLED } from '@/lib/features'
import { toast } from './Toast'
import { isNative, saveImage, copyText } from '@/lib/native'
import { t } from '@/lib/i18n'
import { BTC_CHAIN_ID, chainById, SOLANA_CHAIN_ID } from '@/lib/chains'
import { ensureUnlocked } from '@/lib/vault/gate'
import { useWallet } from '@/store/wallet'
import { errorText } from '@/lib/errors'

type Net = 'solana' | 'evm' | 'btc'

// 支持的链只显示 logo（2026-09-25 goat：文字太多），名字放在 aria-label / title 里
const NETS: { id: Net; name: string; hint: string; chains: number[] }[] = [
  { id: 'evm', name: 'EVM', hint: '适用于 BNB Chain、Ethereum、Base、Arbitrum 等 EVM 网络', chains: [56, 1, 8453, 42161, 4663, 137, 10] },
  { id: 'solana', name: 'Solana', hint: '仅适用于 Solana 网络', chains: [SOLANA_CHAIN_ID] },
  { id: 'btc', name: 'Bitcoin', hint: '仅适用于比特币网络', chains: [BTC_CHAIN_ID] },
]

function useQr(text: string | null) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!text) return setUrl(null)
    // 深色底上用浅色码；margin 小一点让码更大
    QRCode.toDataURL(text, { width: 480, margin: 1, color: { dark: '#0b0f0c', light: '#ffffff' } }).then(setUrl).catch(() => setUrl(null))
  }, [text])
  return url
}

export default function ReceiveSheet({ open, onClose, address, evmAddress, initialNet = 'evm' }: { open: boolean; onClose: () => void; address: string | null; evmAddress: string | null; initialNet?: Net }) {
  // 比特币地址直接从钱包取（设置页等老调用处不用改）
  const btcAddress = useWallet((s) => s.btcAddress)
  const [net, setNet] = useState<Net>(initialNet)
  const [copied, setCopied] = useState(false)
  useEffect(() => { if (open) { setNet(initialNet); setCopied(false) } }, [open, initialNet])
  const cur = net === 'solana' ? address : net === 'btc' ? (btcAddress || null) : evmAddress
  // 比特币二维码用 bitcoin: 链接，别的钱包扫了直接进发送页
  const qr = useQr(cur && net === 'btc' ? `bitcoin:${cur}` : cur)
  // 老钱包的比特币地址要解锁一次才算得出来（之后存进金库，锁着也能看）
  const [unlocking, setUnlocking] = useState(false)
  const unlockForBtc = async () => {
    setUnlocking(true)
    try { await ensureUnlocked(t('生成比特币地址')) } catch { /* 用户取消 */ } finally { setUnlocking(false) }
  }
  const info = NETS.find((n) => n.id === net)!
  const copy = () => {
    if (!cur) return
    copyText(cur).then(() => { setCopied(true); toast.success(t('地址已复制')); window.setTimeout(() => setCopied(false), 1500) })
  }
  const [saving, setSaving] = useState(false)
  const saveQr = async () => {
    if (!qr || saving) return
    setSaving(true)
    try {
      await saveImage(qr, t('0x4-{net}-收款码.png', { net }))
      toast.success(isNative ? t('已保存到相册') : t('二维码已下载'))
    } catch (e) {
      const code = (e as { code?: string }).code
      toast.error(code === 'DENIED' ? t('没有相册权限，请在系统设置里允许 0x4 添加照片') : errorText(e, t('保存失败')))
    } finally { setSaving(false) }
  }
  return (
    <Sheet open={open} onClose={onClose} title={t('充值')}>
      {/* 网络切换 */}
      <div className="flex rounded-2xl bg-card2 p-1">
        {NETS.filter((n) => n.id === 'solana' || evmAddress).map((n) => (
          <button key={n.id} onClick={() => setNet(n.id)} className={`flex-1 rounded-xl py-2 text-sm font-semibold transition ${net === n.id ? 'bg-accent text-bg' : 'text-muted'}`}>{n.name}</button>
        ))}
      </div>

      {net === 'btc' && !btcAddress ? (
        <div className="glass-lite mt-5 rounded-2xl px-4 py-6 text-center">
          <p className="text-sm text-muted">{t('验证一次即可生成比特币地址')}</p>
          <button onClick={unlockForBtc} disabled={unlocking} className="mx-auto mt-3 flex min-h-10 items-center rounded-full bg-accent px-5 text-[13px] font-semibold text-bg disabled:opacity-50">{t('验证并生成')}</button>
        </div>
      ) : <>
      {/* 二维码 */}
      <div className="mx-auto mt-5 flex h-48 w-48 items-center justify-center overflow-hidden rounded-2xl bg-white p-2">
        {qr ? <img src={qr} alt={t('收款二维码')} className="h-full w-full" /> : <span className="text-xs text-bg/60">{t('生成中…')}</span>}
      </div>

      {/* 地址：一行显示完整（字号随屏宽缩放，不折行）；复制按钮在第二行居中（2026-09-25 goat 要求） */}
      <div className="glass-lite mt-4 rounded-2xl px-3 py-3 text-center">
        <div className="whitespace-nowrap font-mono text-[clamp(10px,3.1vw,13px)] tracking-tight" aria-label={t('收款地址')}>{cur || '--'}</div>
        <button onClick={copy} className="mx-auto mt-2.5 flex min-h-10 items-center gap-1.5 rounded-full bg-card2 px-4 text-[13px] font-semibold" aria-label={t('复制地址')}>
          {copied ? <Check size={16} className="text-accent" /> : <Copy size={16} />}{copied ? t('已复制') : t('复制地址')}
        </button>
      </div>
      <button onClick={saveQr} disabled={!qr || saving} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-card2 text-sm font-semibold disabled:opacity-50">
        <Download size={16} />{isNative ? t('保存二维码到相册') : t('下载二维码')}
      </button>
      </>}
      <div className="mt-3 text-center text-xs text-muted">
        <div>{t(info.hint)}</div>
        <div className="mt-2.5 flex flex-wrap justify-center gap-2.5">
          {info.chains.map((id) => chainById(id)).filter(Boolean).map((c) => (
            <img key={c!.id} src={c!.logo} alt={c!.name} title={c!.name} className="h-7 w-7 rounded-full bg-card2" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
          ))}
        </div>
        {PERP_ENABLED && net === 'evm' && <div className="mt-2 text-[11px] text-warning">{t('合约交易保证金为 BNB Chain 上的 USDT，燃料费为 BNB')}</div>}
        {net === 'btc' && <div className="mt-2 text-[11px] text-warning">{t('注意：该地址仅适用于原生比特币。')}</div>}
      </div>

    </Sheet>
  )
}
