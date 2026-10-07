// Web top bar, right side (2026-09-29 goat: tapping notifications / profile on desktop still opened mobile pages):
// · Bell: opens a dropdown attached to the button (380px, All / Interactions / System); "view all" at the bottom goes to the desktop notifications page — no more jumping to the mobile page;
// · Wallet capsule: opens a menu (my assets / my profile / settings / disconnect) — no more jumping to the mobile home.
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bell, ChevronDown, Copy, LogOut, Settings as SettingsIcon, Smartphone, UserRound, Wallet, Zap } from 'lucide-react'
import { ENERGY_GIFTS } from '@/lib/energy'
import Avatar from '@/components/Avatar'
import { useWallet } from '@/store/wallet'
import { useSocial } from '@/store/social'
import { shortId } from '@/lib/format'
import { t } from '@/lib/i18n'
import { connectOx4, connectWallet, disconnectWallet } from './walletGate'
import catUrl from './cat-tight.svg'
import { NotifPanel, type NotifTab } from './notifs'
import { copyAddr, midShort, usePop } from './ui'

/** Bell + notification dropdown */
export function BellMenu({ unread }: { unread: number }) {
  const pop = usePop()
  const [tab, setTab] = useState<NotifTab>('all')
  return (
    <div className="desk-pop-wrap" ref={pop.ref}>
      <button type="button" className="desk-icon desk-bell" onClick={pop.toggle} aria-label={unread > 0 ? t('通知，{n} 条未读', { n: unread }) : t('通知')} aria-haspopup="dialog" aria-expanded={pop.open}>
        <Bell size={18} />
        {unread > 0 && <span className="desk-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {pop.open && <NotifPanel tab={tab} setTab={setTab} onClose={() => pop.setOpen(false)} />}
    </div>
  )
}

/** Wallet capsule + menu */
export function WalletMenu() {
  const pop = usePop()
  const nav = useNavigate()
  const { pathname } = useLocation()
  const { evmAddress, address, kind, external } = useWallet()
  const me = useSocial((s) => s.me)
  // Which wallet is connected (2026-09-30): 0x4 Wallet uses the cat head; external wallets use their own announced icon (generic wallet icon when none)
  const walletName = kind === 'external' ? external?.name || t('钱包') : t('0x4 Wallet')
  const walletIcon = kind === 'external'
    ? (external?.icon ? <img src={external.icon} alt="" className="desk-wallet-ic" /> : <span className="desk-wallet-ic is-blank"><Wallet size={11} /></span>)
    : <img src={catUrl} alt="" className="desk-wallet-ic is-ox4" />
  const myAddr = evmAddress || address || ''
  // The profile address = the social identity (same destination as tapping the avatar on the mobile "Me" page)
  const profileAddr = me?.address || address || ''
  const name = me?.nickname || (myAddr ? shortId(myAddr) : t('钱包'))
  const go = (path: string) => { pop.setOpen(false); nav(path) }
  return (
    <div className="desk-pop-wrap" ref={pop.ref}>
      <button type="button" className={`desk-me ${pathname === '/portfolio' ? 'on' : ''}`} onClick={pop.toggle} aria-haspopup="menu" aria-expanded={pop.open} aria-label={t('钱包菜单')}>
        {myAddr && <span className="desk-me-av"><Avatar address={me?.address || myAddr} src={me?.avatar || null} name={me?.nickname || null} size={26} /><span className="desk-me-wallet" title={walletName}>{walletIcon}</span></span>}
        <span className="desk-me-addr">{name}</span>
        <ChevronDown size={14} className="desk-me-chev" aria-hidden="true" />
      </button>
      {pop.open && (
        <div className="desk-pop desk-menu" role="menu" aria-label={t('钱包菜单')}>
          <div className="desk-menu-id">
            {myAddr && <Avatar address={me?.address || myAddr} src={me?.avatar || null} name={me?.nickname || null} size={36} />}
            <span className="wc-grow">
              <b>{name}</b>
              <small className="desk-menu-wallet">{walletIcon}{walletName}</small>
              <button type="button" className="desk-menu-addr" onClick={() => copyAddr(myAddr)} aria-label={t('复制钱包地址')}>{midShort(myAddr)}<Copy size={12} aria-hidden="true" /></button>
            </span>
          </div>
          {/* With an external wallet: an unobtrusive entry to switch to 0x4 Wallet and unlock perps, DMs, and other exclusives */}
          {kind === 'external' && <button type="button" role="menuitem" className="desk-menu-item desk-menu-ox4" onClick={() => { pop.setOpen(false); void connectOx4() }}><img src={catUrl} alt="" className="desk-wallet-ic is-ox4" />{t('换用 0x4 Wallet，解锁全部功能')}</button>}
          <button type="button" role="menuitem" className="desk-menu-item" aria-current={pathname === '/portfolio' ? 'page' : undefined} onClick={() => go('/portfolio')}><Wallet size={16} />{t('我的资产')}</button>
          {/* Energy & earnings (2026-10-04 review: previously only streamers could reach it from their own live room; post-stream earnings and viewers' top-up records had no entry) */}
          {ENERGY_GIFTS && <button type="button" role="menuitem" className="desk-menu-item" aria-current={pathname === '/energy' ? 'page' : undefined} onClick={() => go('/energy')}><Zap size={16} />{t('能量与收益')}</button>}
          <button type="button" role="menuitem" className="desk-menu-item" disabled={!profileAddr} onClick={() => go(`/u/${profileAddr}`)}><UserRound size={16} />{t('我的主页')}</button>
          <button type="button" role="menuitem" className="desk-menu-item" aria-current={pathname === '/settings' ? 'page' : undefined} onClick={() => go('/settings')}><SettingsIcon size={16} />{t('设置')}</button>
          <div className="desk-menu-sep" role="separator" />
          <button type="button" role="menuitem" className="desk-menu-item is-danger" onClick={() => { pop.setOpen(false); void disconnectWallet(); nav('/discover', { replace: true }) }}><LogOut size={16} />{t('断开钱包')}</button>
        </div>
      )}
    </div>
  )
}

/**
 * Account menu for mobile-app QR login (no wallet connected on the computer, 2026-10-01): my profile / connect wallet (needed for trading and gifting) / log out.
 * The capsule's small icon is a phone, meaning "signed in via QR".
 */
export function AppLoginMenu() {
  const pop = usePop()
  const nav = useNavigate()
  const me = useSocial((s) => s.me)
  if (!me) return null
  const name = me.nickname || shortId(me.address)
  const go = (path: string) => { pop.setOpen(false); nav(path) }
  return (
    <div className="desk-pop-wrap" ref={pop.ref}>
      <button type="button" className="desk-me" onClick={pop.toggle} aria-haspopup="menu" aria-expanded={pop.open} aria-label={t('账号菜单')} data-testid="app-login-menu">
        <span className="desk-me-av"><Avatar address={me.address} src={me.avatar || null} name={me.nickname || null} size={26} /><span className="desk-me-wallet" title={t('手机 App 扫码登录')}><span className="desk-wallet-ic is-blank"><Smartphone size={11} /></span></span></span>
        <span className="desk-me-addr">{name}</span>
        <ChevronDown size={14} className="desk-me-chev" aria-hidden="true" />
      </button>
      {pop.open && (
        <div className="desk-pop desk-menu" role="menu" aria-label={t('账号菜单')}>
          <div className="desk-menu-id">
            <Avatar address={me.address} src={me.avatar || null} name={me.nickname || null} size={36} />
            <span className="wc-grow">
              <b>{name}</b>
              <small className="desk-menu-wallet"><Smartphone size={12} aria-hidden="true" />{t('手机 App 扫码登录')}</small>
            </span>
          </div>
          <button type="button" role="menuitem" className="desk-menu-item" onClick={() => go(`/u/${me.address}`)}><UserRound size={16} />{t('我的主页')}</button>
          <button type="button" role="menuitem" className="desk-menu-item" onClick={() => { pop.setOpen(false); connectWallet() }}><Wallet size={16} />{t('连接钱包，交易和送礼')}</button>
          <div className="desk-menu-sep" role="separator" />
          <button type="button" role="menuitem" className="desk-menu-item is-danger" onClick={() => { pop.setOpen(false); useSocial.getState().logout(true); nav('/live', { replace: true }) }} data-testid="app-logout"><LogOut size={16} />{t('退出登录')}</button>
        </div>
      )}
    </div>
  )
}
