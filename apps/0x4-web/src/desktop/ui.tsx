// 网页版内容页共用的小零件（样式在 desktop/desk-content.css）：空状态、弹出层开关、复制地址。
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { FileText, LoaderCircle, RefreshCw, WifiOff, type LucideIcon } from 'lucide-react'
import { useTermsGate } from '@/lib/safety'
import { toast } from '@/components/Toast'
import { useSocial } from '@/store/social'
import { isWalletConnected, useWallet } from '@/store/wallet'
import { copyText } from '@/lib/native'
import { t } from '@/lib/i18n'

/** 空状态 / 失败 / 未连接：图标 20 + 一句话 + 一个操作，居中在所属面板里（规范：一页里同一个状态只说一次） */
export function Empty({ icon: Icon, text, action, row = false, tall = false, className = '' }: { icon?: LucideIcon; text: ReactNode; action?: ReactNode; row?: boolean; tall?: boolean; className?: string }) {
  return (
    <div className={`wc-empty ${row ? 'is-row' : ''} ${tall ? 'is-tall' : ''} ${className}`} role="status">
      {Icon && <Icon size={20} strokeWidth={1.75} aria-hidden="true" />}
      <span>{text}</span>
      {action}
    </div>
  )
}

/** 顶栏下拉（通知、钱包菜单）：点外面 / Esc / 换页面就收起 */
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

/** 复制地址并提示 */
export function copyAddr(text: string) {
  if (!text) return
  copyText(text).then(() => toast.success(t('地址已复制')), () => toast.error(t('复制失败')))
}

/** 地址缩写：前 6 后 4（EVM / Solana / 比特币通用，表格和菜单里用） */
export const midShort = (a: string) => (a && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)

/**
 * 连了钱包、但社区（社交层）还没登录上时的一句话（2026-09-29：网页版登录失败后不自动重试，停在 status = 'error'，原因在 error）。
 * · 登录中（logging / idle）：转圈 + 「正在登录社区」；
 * · 失败（error）：原因（例如「你取消了登录签名」「登录已过期」）+「重新登录」（useSocial.login）。
 * 规范：一页里只放一处（页面顶部状态条，或者最需要它的那个面板里），其它地方只置灰、不再重复说。
 * 没连钱包或已经登录上时返回 null。bar = 页面顶部的细条样式；否则是面板里的空状态样式。
 */
export function SocialLogin({ bar = false, row = true, tall = false }: { bar?: boolean; row?: boolean; tall?: boolean }) {
  const connected = useWallet(isWalletConnected)
  const { status, error, login, needTerms } = useSocial()
  if (!connected || status === 'ready') return null
  // 还没同意条款：不是「正在登录」，说清楚并给入口
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
 * 还没做电脑端专门设计的页面（动态详情、小精灵详情、帮助与客服、代币授权、奖励）：先放进居中一栏的面板里，
 * 不再铺满整个屏幕宽（2026-09-29 过渡做法，页面内部仍是手机的排版）。chat = 整屏聊天模式里的页面（动态详情），高度撑满一屏。
 */
export function DeskColumn({ children, chat = false }: { children: ReactNode; chat?: boolean }) {
  if (chat) return <div className="wc-chatshell is-single"><section className="wc-panel wc-chatpane">{children}</section></div>
  return <div className="wc-page"><div className="wc-panel wc-colpage">{children}</div></div>
}
