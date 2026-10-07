// Web "Scan login" card (2026-10-01 goat: meet.420.meme retired, meetings stay web-only; computers without the extension can log in too).
// 2026-10-03 goat: "0x4 mobile app scan login" and "other wallet scan login" merged into one "Scan login", switched at the card top:
// 0x4 App (scanned by our mobile app, logs in the social identity) / Other wallets (scanned by another mobile wallet, connects that wallet — content passed in via WalletRequired).
// QR appears → phone scans (in-app scan or phone camera both work) → shows "please confirm on your phone" → confirmed, then log in with the web token. Expired / rejected can be re-issued.
// Scan login only covers social, meetings, livestreams; transfers, trading, gifting need a connected wallet (stated at the card bottom).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { ArrowLeft, RefreshCw, X } from 'lucide-react'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'
import { toast } from '@/components/Toast'
import { useSocial } from '@/store/social'
import { beginQrLogin, type QrLoginStatus } from './qrLogin'

type View = { k: 'loading' } | { k: 'qr'; img: string; url: string; status: QrLoginStatus } | { k: 'failed'; text: string }

export type ScanMode = 'app' | 'wc'

/** Card shell: back / close, the "Scan login" title, the top 0x4 App / other-wallet switch (hidden when no other wallet is configured) */
export function ScanLoginCard({ mode, onMode, hasWc, onBack, onClose, children }: { mode: ScanMode; onMode: (m: ScanMode) => void; hasWc: boolean; onBack: () => void; onClose: () => void; children: ReactNode }) {
  return (
    <div className="desk-gate-card cw-card" role="dialog" aria-modal="true" aria-labelledby="cw-app-title" data-testid="qr-login" data-mode={mode}>
      <button type="button" className="desk-gate-x cw-back" onClick={onBack} aria-label={t('返回')}><ArrowLeft size={18} /></button>
      <button type="button" className="desk-gate-x" onClick={onClose} aria-label={t('关闭')}><X size={18} /></button>
      <h2 id="cw-app-title" className="cw-title" style={{ paddingInline: 40 }}>{t('扫码登录')}</h2>
      {hasWc && (
        <div className="wc-seg cw-scan-seg" role="tablist" aria-label={t('用什么扫')}>
          <button type="button" role="tab" aria-selected={mode === 'app'} onClick={() => onMode('app')} data-testid="scan-mode-app">{t('0x4 Wallet')}</button>
          <button type="button" role="tab" aria-selected={mode === 'wc'} onClick={() => onMode('wc')} data-testid="scan-mode-wc">{t('其他钱包')}</button>
        </div>
      )}
      {children}
    </div>
  )
}

/** 0x4 App scan content: QR code + status */
export function QrLoginBody({ onDone }: { onDone: () => void }) {
  const [view, setView] = useState<View>({ k: 'loading' })
  const [round, setRound] = useState(0)
  const cancelRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let alive = true
    setView({ k: 'loading' })
    void (async () => {
      try {
        const h = await beginQrLogin((s) => { if (alive) setView((v) => (v.k === 'qr' ? { ...v, status: s } : v)) })
        if (!alive) { h.cancel(); return }
        cancelRef.current = h.cancel
        const img = await QRCode.toDataURL(h.url, { width: 480, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b0f0c', light: '#ffffff' } })
        if (!alive) { h.cancel(); return }
        setView({ k: 'qr', img, url: h.url, status: 'pending' })
        const r = await h.done
        if (!alive) return
        if (r.status === 'approved' && r.token) {
          const ok = await useSocial.getState().loginWithQr(r.token, r.trusted)
          if (!alive) return
          if (ok) { toast.success(t('登录成功')); onDone(); return }
          setView({ k: 'failed', text: t('登录失败，请重新扫码') })
          return
        }
        setView({ k: 'failed', text: r.status === 'denied' ? t('已在手机上取消') : t('二维码已过期') })
      } catch (e) {
        if (alive) setView({ k: 'failed', text: errorText(e, t('二维码加载失败')) || t('二维码加载失败') })
      }
    })()
    return () => { alive = false; cancelRef.current?.(); cancelRef.current = null }
  }, [round]) // eslint-disable-line react-hooks/exhaustive-deps

  const scanned = view.k === 'qr' && view.status === 'scanned'
  return (
    <>
      <div className="cw-qr" aria-busy={view.k === 'loading'}>
        {/* data-qr = the QR's content (same as on the image, already visible on screen; walkthrough scripts use it to play the phone) */}
        {view.k === 'qr' && <img src={view.img} alt={t('登录二维码')} data-qr={view.url} style={scanned ? { opacity: 0.18 } : undefined} />}
        {view.k === 'loading' && <span className="tx-spin" aria-hidden="true" />}
        {view.k === 'failed' && (
          <button type="button" className="wc-btn is-primary" onClick={() => setRound((n) => n + 1)} data-testid="qr-login-retry"><RefreshCw size={15} />{t('重新获取')}</button>
        )}
      </div>
      <p className="cw-sub" role="status" data-testid="qr-login-status">
        {view.k === 'failed' ? view.text : scanned ? t('已扫码，请在手机上确认') : t('用手机上的 0x4 Wallet 扫一扫')}
      </p>
    </>
  )
}
