// Link-an-external-wallet UI: desktop scans a code, phones jump straight to the wallet app.
// Requests exactly one signature, then disconnects — no session kept.
import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, Smartphone } from 'lucide-react'
import Sheet from './Sheet'
import Button from './Button'
import { toast } from './Toast'
import { copyText, isNative } from '@/lib/native'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'

export default function WalletLinkSheet({ open, onClose, onLinked }: { open: boolean; onClose: () => void; onLinked: () => void }) {
  const [uri, setUri] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [waiting, setWaiting] = useState(false)
  const cancelRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    setUri(null); setQr(null); setError(null); setWaiting(true)
    ;(async () => {
      try {
        const { beginLinkWallet, openInWallet } = await import('@/lib/walletConnect')
        const h = await beginLinkWallet()
        if (!alive) { h.cancel(); return }
        cancelRef.current = h.cancel
        setUri(h.uri)
        QRCode.toDataURL(h.uri, { width: 480, margin: 1, color: { dark: '#0b0f0c', light: '#ffffff' } }).then((d) => { if (alive) setQr(d) }).catch(() => {})
        // On phones the connection string goes straight to the wallet app, skipping the scan
        if (isNative || /iPhone|Android/i.test(navigator.userAgent)) openInWallet(h.uri)
        await h.done
        if (!alive) return
        toast.success(t('钱包已关联'))
        onLinked()
        onClose()
      } catch (e) {
        if (!alive) return
        const msg = errorText(e, t('连接失败'))
        if (msg === 'CANCELLED') onClose()
        else setError(msg)
      } finally {
        if (alive) setWaiting(false)
      }
    })()
    return () => { alive = false; cancelRef.current?.() }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet open={open} onClose={onClose} title={t('关联钱包')}>
      <p className="text-xs text-muted">
        {t('用持有 NFT 的钱包扫码并确认，仅读取地址，不会发起交易。')}
      </p>

      {error && <div className="mt-4 rounded-xl bg-down/10 px-3 py-3 text-sm text-down" role="alert">{error}</div>}

      {!error && (
        <div className="mt-5">
          {qr
            ? <img src={qr} alt={t('WalletConnect 二维码')} className="mx-auto h-56 w-56 rounded-2xl bg-white p-2" />
            : <div className="mx-auto flex h-56 w-56 items-center justify-center rounded-2xl bg-card2 text-sm text-muted" role="status">{waiting ? t('正在生成连接…') : '　'}</div>}

          {uri && (
            <div className="mt-4 space-y-2">
              <Button variant="secondary" size="md" className="w-full" onClick={() => copyText(uri).then(() => toast.success(t('连接串已复制'))).catch(() => toast.error(t('复制失败')))}>
                <Copy size={16} />{t('复制连接串')}
              </Button>
              <Button variant="secondary" size="md" className="w-full" onClick={async () => { const { openInWallet } = await import('@/lib/walletConnect'); openInWallet(uri) }}>
                <Smartphone size={16} />{t('在钱包 App 中打开')}
              </Button>
              <p className="text-center text-xs text-muted">{t('等待钱包确认连接并签名…')}</p>
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}
