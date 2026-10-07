// 手机相机扫电脑上的登录码打开的页面（2026-09-27）：app.420.meme/#/pc-login?c=<码>。
// 不需要找 App 里的扫码按钮：系统相机扫到网址直接打开这里，解锁钱包后弹出和 App 内扫码一样的确认（登录 Cyber Eden / 0x4 Meet / 管理后台）。
import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Laptop } from 'lucide-react'
import { MeetScanNative } from '@/components/MeetScan'
import { useSocial } from '@/store/social'
import { t } from '@/lib/i18n'

export default function PcLogin() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const status = useSocial((s) => s.status)
  const code = params.get('c') || ''
  // 解锁前记下的「解锁后回到这里」用过了，清掉（见 App.tsx takeAfterUnlock）
  useEffect(() => { try { sessionStorage.removeItem('0x4.afterUnlock') } catch { /* 隐私模式 */ } }, [])
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1rem)' }}>
      <Laptop size={32} className="text-muted" aria-hidden="true" />
      <div className="text-lg font-semibold">{t('登录电脑端')}</div>
      <p className="max-w-72 text-sm text-muted">{status === 'ready' ? t('请在弹出的窗口里确认。') : t('正在连接你的账号…')}</p>
      <MeetScanNative variant="none" initialRaw={code} onDone={() => nav('/', { replace: true })} />
    </div>
  )
}
