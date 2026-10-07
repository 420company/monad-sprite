// Web (VITE_SURFACE=web) wallet-related UI:
// · Need: pages that need a wallet (my assets, perps, swap, group chat, DMs, meetings, settings…) swap to a placeholder when no wallet is connected;
// · WalletGateHost: the connect panel that pops when tapping "Connect wallet" or any operation needing a signature (2026-09-30 goat: external wallets can connect too) —
//   the top big card is 0x4 Wallet (recommended, full features), below it other wallets found in the browser, and finally phone-wallet QR scan;
//   plus "Get 0x4 Wallet" (reads "coming soon" while the extension isn't listed yet).
// Copy is for ordinary users: short, no technical terms. The mobile app never reaches here (the route guard guarantees a wallet there).
import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { ChevronRight, QrCode, Smartphone, Wallet, X } from 'lucide-react'
import { isWalletConnected, useWallet } from '@/store/wallet'
import { WEB_SURFACE } from '@/lib/surface'
import { WALLETCONNECT_ID } from '@/lib/env'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'
import { toast } from '@/components/Toast'
import { getOx4, waitForOx4 } from '@/lib/vault/extension'
import { safeIcon, useWalletDiscovery } from '@/lib/vault/external'
import { attachWalletConnect, cancelConnect, connectExternal, connectOx4, connectWallet, useWalletGate } from './walletGate'
import catUrl from './cat-tight.svg'
import { QrLoginBody, ScanLoginCard, type ScanMode } from './QrLoginCard'
import { useSocial } from '@/store/social'
import LegalFooter from '@/components/LegalFooter'

/** Placeholder: explains the page needs a wallet, with a "Connect wallet" button; app = this page also works with a phone-app QR login (meetings, live rooms, group chat…, 2026-10-01) */
export function WalletRequired({ compact = false, app = false }: { compact?: boolean; app?: boolean }) {
  const connecting = useWalletGate((s) => s.connecting)
  const showAppQr = useWalletGate((s) => s.showAppQr)
  return (
    <div className={`desk-need ${compact ? 'is-compact' : ''}`} role="status">
      <span className="desk-need-ic" aria-hidden="true"><Wallet size={22} strokeWidth={1.75} /></span>
      <h2 className="desk-need-title">{app ? t('登录 0x4') : t('连接钱包')}</h2>
      <p className="desk-need-text">{app ? t('连接钱包，或者用手机扫码登录。') : t('连接后就能交易、发动态和聊天。')}</p>
      {/* Desktop button spec (docs/WEB_DESIGN.md): 44 tall, radius 8, pearl gradient with dark text — not the mobile capsule glow button */}
      <button type="button" className="wc-btn is-primary is-lg desk-need-btn" disabled={connecting} aria-busy={connecting} onClick={connectWallet}>{connecting ? t('正在连接') : t('连接钱包')}</button>
      {app && <button type="button" className="wc-btn is-lg desk-need-btn" onClick={showAppQr} data-testid="need-app-qr"><Smartphone size={16} />{t('扫码登录')}</button>}
    </div>
  )
}

/**
 * Pages needing a wallet: web swaps to a placeholder when no wallet is connected; the mobile app renders directly.
 * app: this page also works with a phone-app QR login (no wallet) (meetings, live rooms, group chat, notifications…, 2026-10-01 goat: meet.420.meme retired, meetings are web-only)
 */
export function Need({ children, app = false }: { children: React.ReactNode; app?: boolean }) {
  const ok = useWallet(isWalletConnected)
  const qrIn = useSocial((s) => s.qrMode && s.status === 'ready')
  if (!WEB_SURFACE || ok || (app && qrIn)) return <>{children}</>
  return <WalletRequired app={app} />
}

/** Connect panel + "Get 0x4 Wallet" card (dark, closes on Esc / tapping outside) */
export function WalletGateHost() {
  const open = useWalletGate((s) => s.open)
  const getOx4Open = useWalletGate((s) => s.getOx4)
  const hide = useWalletGate((s) => s.hide)
  useEffect(() => {
    if (!open && !getOx4Open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide() }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [open, getOx4Open, hide])
  if (getOx4Open) return <Backdrop onClose={hide}><ComingSoon onClose={hide} /></Backdrop>
  if (!open) return null
  return <Backdrop onClose={hide}><ConnectPanel onClose={hide} /></Backdrop>
}

function Backdrop({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return <div className="desk-gate" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>{children}</div>
}

/** "Get 0x4 Wallet": the small card shown while the extension isn't listed yet */
function ComingSoon({ onClose }: { onClose: () => void }) {
  return (
    <div className="desk-gate-card cw-soon" role="dialog" aria-modal="true" aria-labelledby="cw-soon-title">
      <button type="button" className="desk-gate-x" onClick={onClose} aria-label={t('关闭')}><X size={18} /></button>
      <span className="cw-cat" aria-hidden="true"><img src={catUrl} alt="" width={64} height={46} /></span>
      <h2 id="cw-soon-title" className="desk-gate-title">{t('0x4 Wallet')}</h2>
      <p className="cw-soon-tag">{t('即将上线')}</p>
      <button type="button" className="wc-btn is-primary is-lg desk-gate-btn" onClick={onClose}>{t('知道了')}</button>
    </div>
  )
}

/** Pick a wallet: 0x4 Wallet (recommended) → other in-browser wallets → phone-wallet QR scan */
function ConnectPanel({ onClose }: { onClose: () => void }) {
  const wallets = useWalletDiscovery((s) => s.wallets)
  const connecting = useWalletGate((s) => s.connecting)
  const connectingName = useWalletGate((s) => s.connectingName)
  const [hasOx4, setHasOx4] = useState(() => !!getOx4())
  const [qr, setQr] = useState<{ img: string | null; cancel: () => void } | null>(null)
  // The "QR login" page (opened directly when entering from a placeholder-page button); switches between 0x4 App / other wallets inside
  const [scan, setScan] = useState<ScanMode | null>(() => (useWalletGate.getState().appQr ? 'app' : null))
  useEffect(() => { if (!hasOx4) void waitForOx4(800).then((p) => setHasOx4(!!p)) }, [hasOx4])
  const cancelRef = useRef<(() => void) | null>(null)
  useEffect(() => () => cancelRef.current?.(), [])

  // Phone-wallet QR scan: dynamically loads the connect module, renders a QR code, attaches after confirmation on the phone
  const startQr = async () => {
    cancelRef.current?.(); cancelRef.current = null
    setQr({ img: null, cancel: () => {} })
    try {
      const { beginWalletConnect } = await import('@/lib/walletConnectLogin')
      const h = await beginWalletConnect()
      cancelRef.current = h.cancel
      const img = await QRCode.toDataURL(h.uri, { width: 480, margin: 1, color: { dark: '#0b0f0c', light: '#ffffff' } })
      setQr({ img, cancel: h.cancel })
      const c = await h.done
      cancelRef.current = null
      await attachWalletConnect(c)
    } catch (e) {
      const msg = errorText(e, t('连接失败'))
      if (msg) toast.error(msg)
      setQr(null)
    }
  }
  const stopQr = () => { qr?.cancel(); cancelRef.current = null; setQr(null) }
  // Switching to "other wallets" starts a connection; switching back to 0x4 App or leaving tears it down
  const setMode = (m: ScanMode | null) => {
    if (m === 'wc') { setScan('wc'); void startQr(); return }
    stopQr()
    setScan(m)
    if (m === null) useWalletGate.setState({ appQr: false })
  }

  if (scan) {
    return (
      <ScanLoginCard mode={scan} onMode={setMode} hasWc={!!WALLETCONNECT_ID} onBack={() => setMode(null)} onClose={() => { stopQr(); onClose() }}>
        {scan === 'app' ? <QrLoginBody onDone={onClose} /> : (
          <>
            <div className="cw-qr" aria-busy={!qr?.img}>{qr?.img ? <img src={qr.img} alt={t('连接二维码')} /> : <span className="tx-spin" aria-hidden="true" />}</div>
            <p className="cw-sub">{t('用手机上的其他钱包扫一扫，在手机上确认')}</p>
          </>
        )}
      </ScanLoginCard>
    )
  }

  return (
    <div className="desk-gate-card cw-card" role="dialog" aria-modal="true" aria-labelledby="cw-title">
      <button type="button" className="desk-gate-x" onClick={onClose} aria-label={t('关闭')}><X size={18} /></button>
      <h2 id="cw-title" className="cw-title">{t('连接钱包')}</h2>

      {/* 0x4 Wallet: always first and largest, marked "recommended" */}
      <button type="button" className={`cw-ox4 ${wallets.length ? '' : 'is-solo'}`} onClick={() => void connectOx4()}>
        <span className="cw-ox4-glow" aria-hidden="true" />
        <span className="cw-cat" aria-hidden="true"><img src={catUrl} alt="" width={52} height={38} /></span>
        <span className="cw-ox4-main">
          {/* 2026-09-30 goat: the name stays on one line, the description line below is dropped, "recommended" moves under the name */}
          <b>{t('0x4 Wallet')}</b>
          <em>{t('推荐')}</em>
        </span>
        <span className="cw-ox4-act">{hasOx4 ? t('连接') : t('获取')}</span>
      </button>

      {/* Waiting on a wallet's confirmation: say clearly who's being waited on, allow cancelling; tapping another wallet directly also works (old request voided) */}
      {connecting && connectingName && <div className="cw-waiting" role="status"><span className="tx-spin" aria-hidden="true" /><span>{t('请在 {name} 中确认', { name: connectingName })}</span><button type="button" onClick={cancelConnect}>{t('取消')}</button></div>}
      {wallets.length > 0 && <p className="cw-sec">{t('其它钱包')}</p>}
      <div className="cw-list">
        {wallets.map((w) => {
          const icon = safeIcon(w.info.icon)
          return (
            <button key={w.info.uuid || w.info.rdns} type="button" className="cw-item" onClick={() => void connectExternal(w)}>
              {icon ? <img src={icon} alt="" className="cw-item-ic" /> : <span className="cw-item-ic is-blank" aria-hidden="true"><Wallet size={16} /></span>}
              <span className="cw-item-name">{w.info.name}</span>
              <ChevronRight size={16} className="cw-item-chev" aria-hidden="true" />
            </button>
          )
        })}
        {/* QR login (2026-10-03 goat: the old "0x4 mobile app QR login" / "other wallet QR login" rows merged into one, switching inside the card):
            0x4 App scan = meetings, watching live, chatting only; other-wallet scan = connects that wallet, can trade */}
        <button type="button" className="cw-item" onClick={() => setMode('app')} data-testid="cw-app-qr">
          <span className="cw-item-ic is-blank" aria-hidden="true"><QrCode size={16} /></span>
          <span className="cw-item-name">{t('扫码登录')}</span>
          <ChevronRight size={16} className="cw-item-chev" aria-hidden="true" />
        </button>
      </div>
      {/* Legal docs and download center: phone browsers and the "space" appearance lack these links at the bottom, so guests can still find them here (2026-10-04 walkthrough) */}
      <LegalFooter className="mt-4" />
    </div>
  )
}
