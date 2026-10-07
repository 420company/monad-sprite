// Shared small widgets for web content pages (styles in desktop/desk-content.css): empty states, popover toggles, copy-address.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { FileText, LoaderCircle, RefreshCw, WifiOff, type LucideIcon } from 'lucide-react'
import { useTermsGate } from '@/lib/safety'
import { toast } from '@/components/Toast'
import { useSocial } from '@/store/social'
import { isWalletConnected, useWallet } from '@/store/wallet'
import { copyText } from '@/lib/native'
import { t } from '@/lib/i18n'

/** Empty / failed / unconnected: 20px icon + one line + one action, centered in its panel (convention: one state is stated only once per page) */
export function Empty({ icon: Icon, text, action, row = false, tall = false, className = '' }: { icon?: LucideIcon; text: ReactNode; action?: ReactNode; row?: boolean; tall?: boolean; className?: string }) {
  return (
    <div className={`wc-empty ${row ? 'is-row' : ''} ${tall ? 'is-tall' : ''} ${className}`} role="status">
      {Icon && <Icon size={20} strokeWidth={1.75} aria-hidden="true" />}
      <span>{text}</span>
      {action}
    </div>
  )
}

/** Top-bar dropdowns (notifications, wallet menu): dismiss on outside tap / Esc / page change */
export function usePop() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()
  useEffect(() => { setOpen(false) }, [pathname])
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key) }
  }, [open])
  return { open, setOpen, ref, toggle: () => setOpen((v) => !v) }
}

/** Copy the address with a toast */
export function copyAddr(text: string) {
  if (!text) return
  copyText(text).then(() => toast.success(t('地址已复制')), () => toast.error(t('复制失败')))
}

/** Address abbreviation: first 6 + last 4 (works for EVM / Solana / Bitcoin; used in tables and menus) */
export const midShort = (a: string) => (a && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)

/**
 * One-liner for "wallet connected but community (social layer) not logged in" (2026-09-29: after a failed web login, don't auto-retry; stay at status = 'error' with the reason in error).
 * - Logging in (logging / idle): spinner + "Signing in to community";
 * - Failed (error): the reason (e.g. "You cancelled the login signature" / "Login expired") + "Sign in again" (useSocial.login).
 * Convention: only one place per page (the status strip at the top of the page, or the panel that needs it most); everywhere else just grays out without repeating it.
 * Returns null when no wallet is connected or already logged in. bar = slim strip style for the top of the page; otherwise an empty-state style inside a panel.
 */
export function SocialLogin({ bar = false, row = true, tall = false }: { bar?: boolean; row?: boolean; tall?: boolean }) {
  const connected = useWallet(isWalletConnected)
  const { status, error, login, needTerms } = useSocial()
  if (!connected || status === 'ready') return null
  // Terms not yet agreed: not "logging in" — say so plainly and give the entry
  if (needTerms) {
    const agree = <button type="button" className="wc-btn is-sm is-primary" onClick={() => useTermsGate.getState().show(true)}>{t('查看并同意')}</button>
    if (bar) return <div className="wc-note" role="status"><span>{t('同意服务条款后才能使用社交功能')}</span>{agree}</div>
    return <Empty row={row} tall={tall} icon={FileText} text={t('同意服务条款后才能使用社交功能')} action={agree} />
  }
  const failed = status === 'error'
  const text = failed ? (error ? t('社区登录失败：{reason}', { reason: error }) : t('社区登录失败')) : t('正在登录社区…')
  const action = failed ? <button type="button" className="wc-btn is-sm is-primary" onClick={() => void login()}><RefreshCw size={13} />{t('重新登录')}</button> : null
  if (bar) return <div className={`wc-note ${failed ? 'is-warn' : ''}`} role="status">{failed ? <WifiOff size={15} aria-hidden="true" /> : <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />}<span>{text}</span>{action}</div>
  return <Empty row={row} tall={tall} icon={failed ? WifiOff : LoaderCircle} text={text} action={action} className={failed ? '' : 'is-loading'} />
}

/**
 * Pages with no dedicated desktop design yet (post detail, sprite detail, help & support, token approvals, rewards): put them in a centered single-column panel,
 * no longer stretched full-screen-width (2026-09-29 interim approach; the page interior is still the phone layout). chat = pages in full-screen chat mode (post detail), stretched to full screen height.
 */
export function DeskColumn({ children, chat = false }: { children: ReactNode; chat?: boolean }) {
  if (chat) return <div className="wc-chatshell is-single"><section className="wc-panel wc-chatpane">{children}</section></div>
  return <div className="wc-page"><div className="wc-panel wc-colpage">{children}</div></div>
}
