// 网页版（VITE_SURFACE=web）钱包相关的界面：
// · Need：需要钱包的页面（我的资产、合约、闪兑、群聊、私信、会议、设置……）没连钱包时换成占位；
// · WalletGateHost：点「连接钱包」或任何要签名的操作时弹出的连接面板（2026-09-30 goat：外部钱包也能连）——
//   最上面大卡片是 0x4 Wallet（推荐，全部功能），下面是浏览器里发现的其它钱包，最后是手机钱包扫码；
//   以及「获取 0x4 Wallet」（插件还没上架时写「即将上线」）。
// 文案给普通用户看：字少，不出现技术名词。手机 App 用不到这里（路由守卫保证那边一定有钱包）。
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

/** 占位：说明这一页要连钱包，给一个「连接钱包」按钮；app = 这一页用手机 App 扫码登录也行（会议、直播、群聊等，2026-10-01） */
export function WalletRequired({ compact = false, app = false }: { compact?: boolean; app?: boolean }) {
  const connecting = useWalletGate((s) => s.connecting)
  const showAppQr = useWalletGate((s) => s.showAppQr)
  return (
    <div className={`desk-need ${compact ? 'is-compact' : ''}`} role="status">
      <span className="desk-need-ic" aria-hidden="true"><Wallet size={22} strokeWidth={1.75} /></span>
      <h2 className="desk-need-title">{app ? t('登录 0x4') : t('连接钱包')}</h2>
      <p className="desk-need-text">{app ? t('连接钱包，或者用手机扫码登录。') : t('连接后就能交易、发动态和聊天。')}</p>
      {/* 电脑端按钮规范（docs/WEB_DESIGN.md）：高 44、圆角 8、珍珠渐变黑字，不用手机的胶囊发光按钮 */}
      <button type="button" className="wc-btn is-primary is-lg desk-need-btn" disabled={connecting} aria-busy={connecting} onClick={connectWallet}>{connecting ? t('正在连接') : t('连接钱包')}</button>
      {app && <button type="button" className="wc-btn is-lg desk-need-btn" onClick={showAppQr} data-testid="need-app-qr"><Smartphone size={16} />{t('扫码登录')}</button>}
    </div>
  )
}

/**
 * 需要钱包的页面：网页版没连钱包时换成占位；手机 App 直接渲染。
 * app：这一页手机 App 扫码登录（没有钱包）也能用（会议、直播间、群聊、通知……，2026-10-01 goat：meet.420.meme 下线，会议只留网页版）
 */
export function Need({ children, app = false }: { children: React.ReactNode; app?: boolean }) {
  const ok = useWallet(isWalletConnected)
  const qrIn = useSocial((s) => s.qrMode && s.status === 'ready')
  if (!WEB_SURFACE || ok || (app && qrIn)) return <>{children}</>
  return <WalletRequired app={app} />
}

/** 连接面板 + 「获取 0x4 Wallet」卡片（深色，Esc / 点空白处关闭） */
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

/** 「获取 0x4 Wallet」：插件还没上架时的小卡片 */
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

/** 选钱包：0x4 Wallet（推荐）→ 浏览器里的其它钱包 → 手机钱包扫码 */
function ConnectPanel({ onClose }: { onClose: () => void }) {
  const wallets = useWalletDiscovery((s) => s.wallets)
  const connecting = useWalletGate((s) => s.connecting)
  const connectingName = useWalletGate((s) => s.connectingName)
  const [hasOx4, setHasOx4] = useState(() => !!getOx4())
  const [qr, setQr] = useState<{ img: string | null; cancel: () => void } | null>(null)
  // 「扫码登录」那一页（从占位页按钮进来时直接打开）；里面切换 0x4 App / 其他钱包
  const [scan, setScan] = useState<ScanMode | null>(() => (useWalletGate.getState().appQr ? 'app' : null))
  useEffect(() => { if (!hasOx4) void waitForOx4(800).then((p) => setHasOx4(!!p)) }, [hasOx4])
  const cancelRef = useRef<(() => void) | null>(null)
  useEffect(() => () => cancelRef.current?.(), [])

  // 手机钱包扫码：动态加载连接模块，出二维码，手机上确认后挂上
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
  // 切到「其他钱包」就发起连接；切回 0x4 App 或离开就撤掉
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

      {/* 0x4 Wallet：永远第一个、最大，标「推荐」 */}
      <button type="button" className={`cw-ox4 ${wallets.length ? '' : 'is-solo'}`} onClick={() => void connectOx4()}>
        <span className="cw-ox4-glow" aria-hidden="true" />
        <span className="cw-cat" aria-hidden="true"><img src={catUrl} alt="" width={52} height={38} /></span>
        <span className="cw-ox4-main">
          {/* 2026-09-30 goat：名字一行不折行，下面那句说明去掉，「推荐」放到名字下面 */}
          <b>{t('0x4 Wallet')}</b>
          <em>{t('推荐')}</em>
        </span>
        <span className="cw-ox4-act">{hasOx4 ? t('连接') : t('获取')}</span>
      </button>

      {/* 正在等某个钱包确认：说清楚在等谁，可以取消；直接点别的钱包也行（旧请求作废） */}
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
        {/* 扫码登录（2026-10-03 goat：原来「0x4 手机 App 扫码登录」「其他钱包扫码登录」两行合成一行，卡片里再切换）：
            0x4 App 扫 = 只能开会、看直播、聊天；其他钱包扫 = 连那个钱包，能交易 */}
        <button type="button" className="cw-item" onClick={() => setMode('app')} data-testid="cw-app-qr">
          <span className="cw-item-ic is-blank" aria-hidden="true"><QrCode size={16} /></span>
          <span className="cw-item-name">{t('扫码登录')}</span>
          <ChevronRight size={16} className="cw-item-chev" aria-hidden="true" />
        </button>
      </div>
      {/* 法律文件和下载中心：手机浏览器和「空间」外观的底部没有这几个链接，访客在这里也能找到（2026-10-04 走查） */}
      <LegalFooter className="mt-4" />
    </div>
  )
}
