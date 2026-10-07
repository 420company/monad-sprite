// 网页版顶栏右侧（2026-09-29 goat：电脑端点通知 / 个人中心还是手机页面）：
// · 铃铛：点开是贴着按钮的下拉面板（380 宽，全部 / 互动 / 系统），底部「查看全部」进电脑端通知页，不再直接跳手机页；
// · 钱包胶囊：点开菜单（我的资产 / 我的主页 / 设置 / 断开钱包），不再直接跳手机首页。
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

/** 铃铛 + 通知下拉 */
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

/** 钱包胶囊 + 菜单 */
export function WalletMenu() {
  const pop = usePop()
  const nav = useNavigate()
  const { pathname } = useLocation()
  const { evmAddress, address, kind, external } = useWallet()
  const me = useSocial((s) => s.me)
  // 连的是哪个钱包（2026-09-30）：0x4 Wallet 用猫头，外部钱包用它自己公告的图标（没有就用通用钱包图标）
  const walletName = kind === 'external' ? external?.name || t('钱包') : t('0x4 Wallet')
  const walletIcon = kind === 'external'
    ? (external?.icon ? <img src={external.icon} alt="" className="desk-wallet-ic" /> : <span className="desk-wallet-ic is-blank"><Wallet size={11} /></span>)
    : <img src={catUrl} alt="" className="desk-wallet-ic is-ox4" />
  const myAddr = evmAddress || address || ''
  // 主页地址 = 社交身份（和手机「我」页点头像去的是同一个）
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
          {/* 用外部钱包时：一个不打扰的入口，换成 0x4 Wallet 解锁合约、私信等专属功能 */}
          {kind === 'external' && <button type="button" role="menuitem" className="desk-menu-item desk-menu-ox4" onClick={() => { pop.setOpen(false); void connectOx4() }}><img src={catUrl} alt="" className="desk-wallet-ic is-ox4" />{t('换用 0x4 Wallet，解锁全部功能')}</button>}
          <button type="button" role="menuitem" className="desk-menu-item" aria-current={pathname === '/portfolio' ? 'page' : undefined} onClick={() => go('/portfolio')}><Wallet size={16} />{t('我的资产')}</button>
          {/* 能量与收益（2026-10-04 走查：以前只有主播在自己直播间里能点到；下播后的收益、观众的充值记录都没入口） */}
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
 * 手机 App 扫码登录（电脑上没连钱包，2026-10-01）时的账号菜单：我的主页 / 连接钱包（交易、送礼要它）/ 退出登录。
 * 胶囊上的小图标是手机，表示「扫码登录的」。
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
